import type { AgentDeskContext } from "../contract/context.js";
import { cosine } from "../contract/embed.js";
import { vectorSearch } from "../contract/search.js";
import { isOffered, type CapabilityDoc, type EpisodeDoc, type RuleDoc } from "../contract/types.js";
import { replay, fillPath, fillTemplate, type StepResult } from "./replay.js";
import { activeRules, matchesRequest } from "./rules.js";

// The five fixed agent tools (CONTRACT section 4). Same behaviour on POST /agent and /mcp.
// Learned capabilities are data returned by list_actions, never new tools.

export const TOOL_NAMES = ["about", "ask", "list_actions", "do", "done"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const LIST_ACTIONS_HINT = "Call list_actions before do; actions are learned and change over time.";
const ASK_MIN_SCORE = 0.55;

export interface ToolResult {
  /** Plain text for the agent. */
  reply: string;
  /** Structured data, when there is any. */
  data?: unknown;
  /** True when the desk could not help: the gap the Loop learns from. */
  unknown?: boolean;
  /** Set when `do` ran a capability. */
  capability?: string;
}

// ---------- about ----------

export async function about(ctx: AgentDeskContext): Promise<ToolResult> {
  const siteId = ctx.config.siteId;
  const [facts, lessons, offered] = await Promise.all([
    ctx.cols.knowledge
      .find({ siteId, source: { $in: ["site_read", "developer", "episode"] } }, { projection: { embedding: 0 } })
      .sort({ confidence: -1, createdAt: -1 })
      .limit(8)
      .toArray(),
    ctx.cols.knowledge.find({ siteId, source: "failure" }, { projection: { embedding: 0 } }).sort({ createdAt: -1 }).limit(3).toArray(),
    offeredCapabilities(ctx),
  ]);

  if (facts.length === 0 && offered.length === 0) {
    return {
      reply: `I don't know yet what this site offers: I am new here and I learn from visits like yours. You can still use the website directly. ${LIST_ACTIONS_HINT}`,
      unknown: true,
      data: { facts: [], lessons: [], actions: [] },
    };
  }

  const lines: string[] = [];
  if (facts.length) lines.push(...facts.map((f) => `- ${f.text}`));
  if (offered.length) lines.push(`Actions you can run here: ${offered.map((c) => c.name).join(", ")}.`);
  if (lessons.length) lines.push("Lessons from earlier visits:", ...lessons.map((l) => `- ${l.text}`));
  lines.push(LIST_ACTIONS_HINT);
  return {
    reply: lines.join("\n"),
    data: { facts: facts.map((f) => f.text), lessons: lessons.map((l) => l.text), actions: offered.map((c) => c.name) },
  };
}

// ---------- ask ----------

export async function ask(ctx: AgentDeskContext, question: string): Promise<ToolResult> {
  const q = question.trim();
  if (!q) return { reply: "Ask me a question in plain words, for example: what do you sell?", unknown: true };

  const vector = await ctx.embedder.embedOne(q, "query");
  const hits = await vectorSearch(ctx.cols.knowledge, vector, { siteId: ctx.config.siteId, k: 6, minScore: ASK_MIN_SCORE });
  if (hits.length === 0) {
    return { reply: "I don't know yet. I am still learning about this site, and I have noted your question.", unknown: true };
  }

  const facts = hits.map((h, i) => `[${i + 1}] (${h.source}) ${h.text}`).join("\n");
  const answer = await ctx.llm.text({
    system:
      "You are the front desk of a website, answering a visiting AI agent. Answer ONLY from the numbered facts. " +
      "Facts marked (failure) are lessons from earlier failed visits: pass them on when relevant. " +
      "If the facts do not answer the question, reply exactly: UNKNOWN. Be short and concrete.",
    prompt: `Facts:\n${facts}\n\nQuestion: ${q}`,
    temperature: 0,
  });
  if (answer.trim().toUpperCase().startsWith("UNKNOWN")) {
    return { reply: "I don't know yet. I am still learning about this site, and I have noted your question.", unknown: true };
  }
  return { reply: answer.trim(), data: { sources: hits.map((h) => h.knowledgeId) } };
}

// ---------- list_actions ----------

export interface OfferedAction {
  name: string;
  description: string;
  kind: CapabilityDoc["kind"];
  inputSchema: object;
  note?: string;
}

/** Offered = stage allows it (CONTRACT section 4) and no active rule blocks it. */
export async function offeredCapabilities(ctx: AgentDeskContext): Promise<CapabilityDoc[]> {
  const [caps, rules] = await Promise.all([
    ctx.cols.capabilities.find({ siteId: ctx.config.siteId, stage: { $in: ["proposed", "verified", "approved"] } }).toArray(),
    activeRules(ctx),
  ]);
  return caps.filter((c) => isOffered(c) && !blockingRuleFor(c, rules));
}

export async function listActions(ctx: AgentDeskContext, query?: string): Promise<ToolResult> {
  let caps = await offeredCapabilities(ctx);
  if (caps.length === 0) {
    return {
      reply: "No actions learned yet. Use the website directly this time; I watch how it is done and learn it for the next visitor.",
      unknown: true,
      data: { actions: [] },
    };
  }
  if (query?.trim() && caps.length > 1) {
    const v = await ctx.embedder.embedOne(query, "query");
    caps = caps
      .map((c) => ({ c, s: c.embedding?.length === v.length ? cosine(v, c.embedding) : 0 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }
  const actions: OfferedAction[] = caps.map((c) => ({
    name: c.name,
    description: c.description,
    kind: c.kind,
    inputSchema: c.inputSchema,
    ...(c.stage === "proposed" ? { note: "new: learned recently, not verified yet" } : {}),
  }));
  return {
    reply: `Actions you can run with do: ${actions.map((a) => `${a.name} (${a.description})`).join("; ")}.`,
    data: { actions },
  };
}

// ---------- do ----------

export async function doAction(
  ctx: AgentDeskContext,
  episode: Pick<EpisodeDoc, "sessionId">,
  baseUrl: string,
  action: string,
  input: Record<string, unknown> = {},
): Promise<ToolResult> {
  const siteId = ctx.config.siteId;
  const cap = await ctx.cols.capabilities.findOne({ siteId, name: action }, { sort: { updatedAt: -1 } });
  if (!cap || cap.stage === "observed") {
    return { reply: `There is no action named "${action}". Call list_actions to see what you can run.`, unknown: true, data: { ok: false, error: "unknown_action" } };
  }
  if (cap.stage === "blocked") {
    return refusal(cap, `The site owner has blocked ${cap.name} for agents.`, "blocked");
  }
  if (!isOffered(cap)) {
    return refusal(cap, `${cap.name} changes something on the site, so it needs the site owner's approval before agents can run it. Use the website for now.`, "needs_approval");
  }

  const rules = await activeRules(ctx);
  const byName = blockingRuleFor(cap, rules);
  if (byName) return refusal(cap, `The site owner does not allow agents to do this: ${byName.text}`, "blocked_by_rule", byName);

  const missing = missingRequired(cap.inputSchema, input);
  if (missing.length) {
    return {
      reply: `${cap.name} needs: ${missing.join(", ")}. Example: do ${JSON.stringify({ action: cap.name, input: exampleInput(cap) })}`,
      capability: cap.name,
      data: { ok: false, error: "missing_input", missing, inputSchema: cap.inputSchema },
    };
  }

  // Check rules against what will actually be sent, before sending anything.
  for (const step of cap.mappedRequests) {
    const rc = { input, steps: [] };
    const facts = { method: step.method, path: fillPath(step.path, rc), body: fillTemplate(step.bodyTemplate, rc) };
    const rule = rules.find((r) => matchesRequest(r.compiled.match, facts));
    if (rule) return refusal(cap, `The site owner does not allow agents to do this: ${rule.text}`, "blocked_by_rule", rule);
  }

  let steps: StepResult[];
  try {
    steps = await replay(baseUrl, episode.sessionId, cap.mappedRequests, input);
  } catch (err) {
    await bumpStats(ctx, cap, false);
    return { reply: `${cap.name} could not reach the site: ${(err as Error).message}`, capability: cap.name, data: { ok: false, error: "replay_failed" } };
  }
  const ok = steps.length === cap.mappedRequests.length && steps.every((s) => s.status < 400);
  await bumpStats(ctx, cap, ok);
  const last = steps[steps.length - 1];
  return {
    reply: ok
      ? `Done: ${cap.name}. ${summarize(last?.body)}`
      : `${cap.name} failed: the site answered ${last?.status} on ${last?.method} ${last?.path}. ${summarize(last?.body)}`,
    capability: cap.name,
    data: { ok, result: last?.body, steps: steps.map(({ method, path, status }) => ({ method, path, status })) },
  };
}

function refusal(cap: CapabilityDoc, reply: string, error: string, rule?: RuleDoc): ToolResult {
  return { reply, capability: cap.name, data: { ok: false, error, ...(rule ? { ruleId: rule.ruleId, rule: rule.text } : {}) } };
}

function blockingRuleFor(cap: CapabilityDoc, rules: RuleDoc[]): RuleDoc | undefined {
  return rules.find((r) => r.compiled.capabilities?.some((n) => n === cap.name || n === cap.capabilityId));
}

async function bumpStats(ctx: AgentDeskContext, cap: CapabilityDoc, ok: boolean): Promise<void> {
  await ctx.cols.capabilities
    .updateOne({ capabilityId: cap.capabilityId }, { $inc: { "stats.calls": 1, "stats.successes": ok ? 1 : 0 } })
    .catch((err) => ctx.log.error("do: could not update stats", err));
}

function missingRequired(schema: object, input: Record<string, unknown>): string[] {
  const required = (schema as { required?: unknown }).required;
  if (!Array.isArray(required)) return [];
  return required.filter((k): k is string => typeof k === "string" && (input[k] === undefined || input[k] === null || input[k] === ""));
}

function exampleInput(cap: CapabilityDoc): unknown {
  return cap.examples?.[0]?.input ?? Object.fromEntries(
    Object.keys((cap.inputSchema as { properties?: object }).properties ?? {}).map((k) => [k, "..."]),
  );
}

function summarize(body: unknown): string {
  if (body === null || body === undefined || body === "") return "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > 400 ? `${text.slice(0, 400)}...` : text;
}

