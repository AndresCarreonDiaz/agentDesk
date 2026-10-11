import type { AgentDeskContext } from "../contract/context.js";
import type { Change } from "./core.js";

// Words for the panel and for agents: capability names, one-line descriptions, the `why` of a reflection.
// The LLM writes them when it can; a deterministic version always exists, so the Loop never fails on the model.

const LLM_TIMEOUT_MS = 20_000;
const EMBED_TIMEOUT_MS = 20_000;
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Embeds a document, or returns [] when the embedder fails (a capability without a vector still works). */
export async function embedOrEmpty(ctx: AgentDeskContext, text: string): Promise<number[]> {
  try {
    return await withTimeout(ctx.embedder.embedOne(text, "document"), EMBED_TIMEOUT_MS, "embedding");
  } catch (err) {
    ctx.log.warn(`loop: embedding failed, storing without a vector (${(err as Error).message})`);
    return [];
  }
}

// ---------- capability names ----------

const ADD_TARGETS = new Set(["items", "item", "lines", "line", "products", "product", "entries", "entry"]);
const VERBS: Record<string, string> = { POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" };

function isParamSegment(segment: string): boolean {
  return segment.startsWith(":") || segment.startsWith("{") || /^\d+$/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment) || /^[a-z]+_[a-z0-9]{6,}$/i.test(segment);
}

/** Path segments that name things, without ids and template parameters. */
export function pathWords(path: string): string[] {
  return path
    .split("?")[0]
    .split("/")
    .filter((s) => s && !isParamSegment(s))
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter(Boolean);
}

/** add_to_cart for POST /cart/items; create_quote for POST /quote; submit_quote for POST /quote/:id/submit. */
export function deterministicName(method: string, path: string): string {
  const words = pathWords(path);
  const verb = VERBS[method.toUpperCase()] ?? method.toLowerCase();
  if (words.length === 0) return verb;
  const last = words[words.length - 1];
  if (method.toUpperCase() === "POST" && words.length >= 2 && ADD_TARGETS.has(last)) return `add_to_${words[0]}`;
  if (method.toUpperCase() === "POST" && words.length >= 2) return `${last}_${words.slice(0, -1).join("_")}`;
  return `${verb}_${words.join("_")}`;
}

export function deterministicDescription(steps: { method: string; path: string }[], name: string): string {
  const route = steps.map((s) => `${s.method} ${s.path}`).join(" then ");
  return `${name.replace(/_/g, " ")}: runs ${route} on the site.`;
}

export interface CapabilityWords {
  name: string;
  description: string;
}

export async function nameCapability(
  ctx: AgentDeskContext,
  facts: {
    steps: { method: string; path: string; bodyTemplate: unknown }[];
    inputFields: string[];
    goal: string | null;
    intents: string[];
  },
): Promise<CapabilityWords> {
  const last = facts.steps[facts.steps.length - 1];
  const fallback: CapabilityWords = {
    name: deterministicName(last.method, last.path),
    description: "",
  };
  fallback.description = deterministicDescription(facts.steps, fallback.name);

  try {
    const answer = await withTimeout(
      ctx.llm.json<{ name?: unknown; description?: unknown }>(
        {
          system:
            "You name actions that an AI agent can run on a website. Answer with JSON: " +
            '{"name": snake_case verb phrase such as add_to_cart, "description": one plain sentence an agent can read}.',
          prompt: [
            `Goal the agent had: ${facts.goal ?? "unknown"}`,
            `Intents: ${facts.intents.join(", ") || "none"}`,
            `Requests, in order: ${facts.steps.map((s) => `${s.method} ${s.path}`).join(" -> ")}`,
            `Input fields: ${facts.inputFields.join(", ") || "none"}`,
          ].join("\n"),
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
        {
          type: "object",
          properties: { name: { type: "string" }, description: { type: "string" } },
          required: ["name", "description"],
        },
      ),
      LLM_TIMEOUT_MS,
      "capability naming",
    );
    const name = typeof answer.name === "string" ? answer.name.trim() : "";
    const description = typeof answer.description === "string" ? answer.description.trim().replace(/\s+/g, " ") : "";
    return {
      name: SNAKE_CASE.test(name) && name.length <= 60 ? name : fallback.name,
      description: description && description.length <= 300 ? description : fallback.description,
    };
  } catch (err) {
    ctx.log.warn(`loop: capability naming fell back to a deterministic name (${(err as Error).message})`);
    return fallback;
  }
}

// ---------- readable diff and lesson ----------

/** "POST /cart/items: qty was string, success sent number" */
export function describeChanges(changes: readonly Change[]): string | null {
  if (changes.length === 0) return null;
  return changes
    .map((c) => {
      switch (c.kind) {
        case "type":
          return `${c.method} ${c.path}: ${c.field} was ${c.failed}, success sent ${c.success}`;
        case "missing_field":
          return `${c.method} ${c.path}: ${c.field} was missing, success sent ${c.success}`;
        case "extra_field":
          return `${c.method} ${c.path}: failure sent ${c.field} (${c.failed}), success did not`;
        case "missing_step":
          return `success also called ${c.method} ${c.path}, which the failure never did`;
      }
    })
    .join("; ");
}

/** "POST /cart/items: send qty as number, not string" */
export function lessonFromChanges(changes: readonly Change[]): string {
  return changes
    .map((c) => {
      switch (c.kind) {
        case "type":
          return `${c.method} ${c.path}: send ${c.field} as ${c.success}, not ${c.failed}`;
        case "missing_field":
          return `${c.method} ${c.path}: include ${c.field} (${c.success})`;
        case "extra_field":
          return `${c.method} ${c.path}: do not send ${c.field}`;
        case "missing_step":
          return `call ${c.method} ${c.path} as part of the task`;
      }
    })
    .join("; ");
}
