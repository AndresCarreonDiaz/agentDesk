import type { AgentDeskContext } from "../contract/context.js";
import { newId } from "../contract/ids.js";
import type {
  CapabilityDoc,
  EpisodeDoc,
  FailureKind,
  KnowledgeDoc,
  Reflection,
  RequestDoc,
  RuleDoc,
} from "../contract/types.js";
import {
  buildCapability,
  closeEpisode,
  diffEpisodes,
  nextStage,
  proposeRules,
  type CapabilityDraft,
  type Close,
  type LoopEpisode,
  type LoopRequest,
} from "./core.js";
import { describeChanges, embedOrEmpty, lessonFromChanges, nameCapability, withTimeout } from "./naming.js";
import { sendVisitEvent, type RaindropStatus } from "./raindrop.js";
import { readSite } from "./siteread.js";

// The reflector for one episode (docs/parts/loop.md). The pure decisions live in core.ts;
// this file loads the data, calls the core, and writes the results. Safe to run twice.

export interface ProcessResult {
  closed: boolean;
  siteSuccess: boolean | null;
  capabilityIds: string[];
  knowledgeIds: string[];
  ruleIds: string[];
  raindrop: RaindropStatus;
}

type Learned = Reflection["learned"][number];
type SessionRequest = RequestDoc & { sessionId: string };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RECENT_EPISODES_FOR_RULES = 100;
const MAX_EXAMPLES = 5;
// Door replies to a refused or incomplete `do` with one of these. The turn names the capability,
// but nothing ran, so it is not a call.
const NOT_EXECUTED = /needs the site owner's approval|has blocked|does not allow agents|There is no action named|needs: /i;
const DESK_DOES_NOT_KNOW = /don'?t know|no actions learned|no action named/i;
// The agent's own closing words when the empty desk could not say what the site offers.
const DESK_COULD_NOT_TELL =
  /(could ?n[o']?t|can ?not|can'?t|did ?n[o']?t|does ?n[o']?t|don'?t|do not|unable)[^.]{0,40}(tell|know|say|what (the |this )?(site|store|shop|website))/i;

const ms = (t: Date | string): number => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const isWrite = (r: { method: string }): boolean => !READ_METHODS.has(r.method.toUpperCase());
const hasSession = <T extends RequestDoc>(r: T): r is T & { sessionId: string } => typeof r.sessionId === "string";

export async function processEpisode(ctx: AgentDeskContext, episodeId: string): Promise<ProcessResult> {
  const stored = await ctx.cols.episodes.findOne({ episodeId });
  if (!stored) {
    ctx.log.warn(`loop: episode ${episodeId} not found`);
    return { closed: false, siteSuccess: null, capabilityIds: [], knowledgeIds: [], ruleIds: [], raindrop: "skipped" };
  }
  const siteId = stored.siteId;
  // The reflection is written last, so a missing one means this episode was never fully processed.
  const firstPass = stored.reflection === null || stored.reflection === undefined;

  // ---- close ----
  const sessionRequests = (await ctx.cols.requests.find({ sessionId: stored.sessionId }).toArray()).filter(hasSession);
  const siteEpisodes = await ctx.cols.episodes.find({ siteId, episodeId: { $ne: episodeId } }).toArray();
  const close = closeEpisode(stored as LoopEpisode, sessionRequests, siteEpisodes as LoopEpisode[]);
  const outcome: EpisodeDoc["outcome"] = stored.outcome === "blocked" ? "blocked" : close.outcome;
  const episode: EpisodeDoc = { ...stored, ...close, outcome };
  const learned: Learned[] = [];

  // Live visits carry no intents yet, so core cannot pair them with a failure. Pair by site and write route.
  const priorFailureId =
    close.priorFailureId ??
    (episode.intents.length === 0 ? await findPriorFailureByRoute(ctx, episode, sessionRequests, siteEpisodes) : null);

  // ---- new capability from a successful fallback sequence ----
  if (close.siteSuccess === true) {
    const draft = buildCapability(episode as LoopEpisode, sessionRequests);
    if (draft) {
      const id = await upsertCapability(ctx, episode, draft, sessionRequests);
      if (id) learned.push({ kind: "capability", id });
    }
  }

  // ---- lesson from a failure that this visit fixed ----
  let diff: string | null = null;
  const succeeded = outcome === "success" && close.siteSuccess !== false;
  if (priorFailureId && succeeded) {
    const prior = siteEpisodes.find((e) => e.episodeId === priorFailureId);
    if (prior) {
      const priorRequests = (await ctx.cols.requests.find({ sessionId: prior.sessionId }).toArray()).filter(hasSession);
      const { changes } = diffEpisodes(priorRequests, sessionRequests);
      diff = describeChanges(changes);
      if (changes.length > 0) {
        const intent = episode.intents.find((i) => prior.intents.includes(i)) ?? episode.intents[0] ?? null;
        const text = `for ${intent ?? episode.goal ?? "this task"}: ${lessonFromChanges(changes)}`;
        learned.push({ kind: "knowledge", id: await upsertFailureLesson(ctx, episode, intent, text) });
      }
    }
  }

  // ---- capabilities this visit called ----
  const capabilities = await ctx.cols.capabilities.find({ siteId }, { projection: { embedding: 0 } }).toArray();
  const called = capabilities.filter((cap) => callsCapability(episode, sessionRequests, cap));
  const stageChanges = await updateCalledCapabilities(ctx, episode, called, siteEpisodes, close);
  for (const id of stageChanges) learned.push({ kind: "capability", id });

  // ---- proposed guardrails ----
  for (const id of await proposeNewRules(ctx, siteId, episodeId, episode)) learned.push({ kind: "rule", id });

  // ---- reflection ----
  const failure = classify(episode, sessionRequests, called.length > 0);
  const previous = stored.reflection;

  // ---- the desk could not say what the site offers: read the site once ----
  let siteRead = 0;
  if (failure === "unknown_site" || (episode.doneNote && DESK_COULD_NOT_TELL.test(episode.doneNote))) {
    try {
      const ids = await readSite(ctx);
      siteRead = ids.length;
      for (const id of ids) learned.push({ kind: "knowledge", id });
    } catch (err) {
      ctx.log.warn(`loop: site reading failed (${(err as Error).message})`);
    }
  }

  const merged = mergeLearned(previous?.learned ?? [], learned);
  let why = previous?.why || (await explain(ctx, episode, failure, sessionRequests, called, diff));
  if (siteRead > 0 && !previous?.why) {
    why += ` The desk then read the site's pages and learned ${siteRead} fact${siteRead === 1 ? "" : "s"} about what it offers.`;
  }
  const reflection: Reflection = { failure, why, diff: diff ?? previous?.diff ?? null, learned: merged };

  await ctx.cols.episodes.updateOne(
    { episodeId },
    {
      $set: {
        requestIds: close.requestIds,
        siteSuccess: close.siteSuccess,
        steps: close.steps,
        durationMs: close.durationMs,
        priorFailureId,
        outcome,
        reflection,
      },
    },
  );

  const raindrop: RaindropStatus = firstPass
    ? await sendVisitEvent(ctx, {
        episodeId,
        agentFamily: episode.agentFamily,
        goal: episode.goal,
        doneNote: episode.doneNote,
        outcome,
        goalSuccess: episode.goalSuccess,
        siteSuccess: close.siteSuccess,
        steps: close.steps,
        durationMs: close.durationMs,
        capabilities: called.map((c) => c.name),
        failureKind: failure,
      })
    : "skipped";

  return {
    closed: true,
    siteSuccess: close.siteSuccess,
    capabilityIds: merged.filter((l) => l.kind === "capability").map((l) => l.id),
    knowledgeIds: merged.filter((l) => l.kind === "knowledge").map((l) => l.id),
    ruleIds: merged.filter((l) => l.kind === "rule").map((l) => l.id),
    raindrop,
  };
}

// ---------- capabilities ----------

function normalizeSegment(segment: string): string {
  if (segment.startsWith(":") || segment.startsWith("{")) return ":param";
  if (/^\d+$/.test(segment) || /^[0-9a-f]{8,}$/i.test(segment) || /^[a-z]+_[a-z0-9]{6,}$/i.test(segment)) return ":param";
  return segment;
}

/** method + path sequence, with ids folded, so two visits to the same action share one capability. */
function signature(steps: readonly { method: string; path: string }[]): string {
  return steps
    .map((s) => `${s.method.toUpperCase()} ${s.path.split("?")[0].split("/").map(normalizeSegment).join("/")}`)
    .join(" -> ");
}

async function upsertCapability(
  ctx: AgentDeskContext,
  episode: EpisodeDoc,
  draft: CapabilityDraft,
  requests: readonly SessionRequest[],
): Promise<string | null> {
  const siteId = episode.siteId;
  const sig = signature(draft.mappedRequests);
  const known = await ctx.cols.capabilities.find({ siteId }, { projection: { embedding: 0 } }).toArray();
  const existing = known.find((c) => signature(c.mappedRequests) === sig);
  const source = requests.find((r) => r.requestId === draft.sourceRequestId);
  const now = new Date();

  if (existing) {
    const set: Record<string, unknown> = {};
    let changed = false;
    const update: Record<string, unknown> = {};
    if (existing.stage === "observed") {
      set.stage = nextStage("observed", []);
      changed = true;
    }
    if (!existing.examples.some((e) => e.requestId === draft.sourceRequestId)) {
      update.$push = {
        examples: { $each: [{ input: source?.body ?? null, requestId: draft.sourceRequestId }], $slice: -MAX_EXAMPLES },
      };
      changed = true;
    }
    if (!changed) return null;
    set.updatedAt = now;
    await ctx.cols.capabilities.updateOne({ capabilityId: existing.capabilityId }, { ...update, $set: set });
    return existing.capabilityId;
  }

  const words = await nameCapability(ctx, {
    steps: draft.mappedRequests,
    inputFields: Object.keys(draft.inputSchema.properties),
    goal: episode.goal,
    intents: episode.intents,
  });
  const taken = new Set(known.map((c) => c.name));
  let name = words.name;
  for (let n = 2; taken.has(name); n++) name = `${words.name}_${n}`;

  const doc: CapabilityDoc = {
    siteId,
    createdAt: now,
    capabilityId: newId("cap"),
    name,
    description: words.description,
    kind: draft.kind,
    inputSchema: draft.inputSchema,
    mappedRequests: draft.mappedRequests,
    stage: nextStage(draft.stage, []),
    sourceEpisodeId: draft.sourceEpisodeId,
    sourceRequestId: draft.sourceRequestId,
    verifiedByEpisodeId: null,
    stats: { calls: 0, successes: 0 },
    examples: [{ input: source?.body ?? null, requestId: draft.sourceRequestId }],
    embedding: await embedOrEmpty(ctx, `${name}: ${words.description}`),
    updatedAt: now,
  };
  await ctx.cols.capabilities.insertOne(doc);
  return doc.capabilityId;
}

function pathMatches(pattern: string, actual: string): boolean {
  const toRegex = (p: string) =>
    p
      .split("?")[0]
      .split("/")
      .map((seg) => (seg.startsWith(":") || seg.includes("{{") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      .join("/");
  return new RegExp(`^${toRegex(pattern)}/?$`).test(actual.split("?")[0]);
}

/** A capability was called when the Door replayed one of its requests, or the desk turn that ran it names it. */
function callsCapability(episode: EpisodeDoc, requests: readonly SessionRequest[], cap: Pick<CapabilityDoc, "name" | "capabilityId" | "mappedRequests">): boolean {
  const byRequest = requests.some(
    (r) =>
      r.source === "capability" &&
      cap.mappedRequests.some((m) => m.method.toUpperCase() === r.method.toUpperCase() && pathMatches(m.path, r.path)),
  );
  if (byRequest) return true;
  return (episode.turns ?? []).some(
    (t) => t.role === "desk" && (t.capability === cap.name || t.capability === cap.capabilityId) && !NOT_EXECUTED.test(t.text),
  );
}

/** Stages for the capabilities this episode called. The Door owns `stats`. Returns the ids whose stage changed. */
async function updateCalledCapabilities(
  ctx: AgentDeskContext,
  episode: EpisodeDoc,
  called: CapabilityDoc[],
  siteEpisodes: EpisodeDoc[],
  close: Close,
): Promise<string[]> {
  if (called.length === 0) return [];

  // Every closed episode of the site, plus this one, oldest first: the evidence nextStage reads.
  const closed = siteEpisodes.filter((e) => e.outcome !== "open");
  const capabilityRequests = (
    await ctx.cols.requests
      .find({ siteId: episode.siteId, source: "capability", sessionId: { $in: closed.map((e) => e.sessionId) } })
      .toArray()
  ).filter(hasSession);
  const timeline = [
    ...closed.map((e) => ({
      episodeId: e.episodeId,
      createdAt: e.createdAt,
      goalSuccess: e.goalSuccess,
      siteSuccess: e.siteSuccess,
      turns: e.turns ?? [],
      requests: capabilityRequests.filter((r) => r.sessionId === e.sessionId),
    })),
    {
      episodeId: episode.episodeId,
      createdAt: episode.createdAt,
      goalSuccess: episode.goalSuccess,
      siteSuccess: close.siteSuccess,
      turns: episode.turns ?? [],
      requests: [] as SessionRequest[],
    },
  ].sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

  const changed: string[] = [];
  for (const cap of called) {
    const history = timeline.filter((e) =>
      e.episodeId === episode.episodeId
        ? true
        : callsCapability({ ...episode, turns: e.turns as EpisodeDoc["turns"] }, e.requests, cap),
    );
    const next = nextStage(cap.stage, history);
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (next !== cap.stage) {
      set.stage = next;
      set.verifiedByEpisodeId = next === "verified" ? history[history.length - 1].episodeId : null;
      changed.push(cap.capabilityId);
    }
    await ctx.cols.capabilities.updateOne({ capabilityId: cap.capabilityId }, { $set: set });
  }
  return changed;
}

/** Latest earlier failed episode of the site with a failed write (>= 400) to a route this episode also wrote to. */
async function findPriorFailureByRoute(
  ctx: AgentDeskContext,
  episode: EpisodeDoc,
  mine: readonly SessionRequest[],
  siteEpisodes: readonly EpisodeDoc[],
): Promise<string | null> {
  const routeKey = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path.split("?")[0]}`;
  const routes = new Set(mine.filter(isWrite).map(routeKey));
  if (routes.size === 0) return null;
  const created = ms(episode.createdAt);
  const candidates = siteEpisodes
    .filter((e) => ms(e.createdAt) < created && (e.goalSuccess === false || e.siteSuccess === false))
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  if (candidates.length === 0) return null;
  const theirs = (
    await ctx.cols.requests.find({ sessionId: { $in: candidates.map((e) => e.sessionId) } }).toArray()
  ).filter(hasSession);
  for (const cand of candidates) {
    const hit = theirs.some(
      (r) => r.sessionId === cand.sessionId && isWrite(r) && r.status >= 400 && routes.has(routeKey(r)),
    );
    if (hit) return cand.episodeId;
  }
  return null;
}

// ---------- knowledge ----------

async function upsertFailureLesson(
  ctx: AgentDeskContext,
  episode: EpisodeDoc,
  intent: string | null,
  text: string,
): Promise<string> {
  const filter = { siteId: episode.siteId, source: "failure" as const, sourceRef: episode.episodeId };
  const existing = await ctx.cols.knowledge.findOne(filter, { projection: { embedding: 0 } });
  if (existing) {
    if (existing.text !== text || existing.intent !== intent) {
      await ctx.cols.knowledge.updateOne(
        { knowledgeId: existing.knowledgeId },
        { $set: { text, intent, embedding: await embedOrEmpty(ctx, text) } },
      );
    }
    return existing.knowledgeId;
  }
  // The same lesson learned again from a later visit is one lesson, not two entries in `about`.
  const sameLesson = await ctx.cols.knowledge.findOne(
    { siteId: episode.siteId, source: "failure", intent, text },
    { projection: { knowledgeId: 1 } },
  );
  if (sameLesson) return sameLesson.knowledgeId;
  const doc: KnowledgeDoc = {
    siteId: episode.siteId,
    createdAt: new Date(),
    knowledgeId: newId("kn"),
    text,
    source: "failure",
    sourceRef: episode.episodeId,
    intent,
    confidence: 0.7,
    embedding: await embedOrEmpty(ctx, text),
  };
  await ctx.cols.knowledge.insertOne(doc);
  return doc.knowledgeId;
}

// ---------- rules ----------

async function proposeNewRules(
  ctx: AgentDeskContext,
  siteId: string,
  episodeId: string,
  current: EpisodeDoc,
): Promise<string[]> {
  const others = await ctx.cols.episodes
    .find({ siteId, episodeId: { $ne: episodeId } }, { projection: { episodeId: 1, sessionId: 1, createdAt: 1 } })
    .toArray();
  const recent = [...others, current]
    .sort((a, b) => ms(b.createdAt) - ms(a.createdAt))
    .slice(0, RECENT_EPISODES_FOR_RULES);
  const requests = (
    await ctx.cols.requests.find({ siteId, sessionId: { $in: recent.map((e) => e.sessionId) } }).toArray()
  ).filter(hasSession);

  // Only propose a guardrail for a write the site never accepts. A write that also succeeds
  // (e.g. add to cart after a bad qty) is a fixable agent mistake, not something to block.
  const accepted = new Set(
    requests.filter((r) => r.status >= 200 && r.status < 300).map((r) => `${r.method.toUpperCase()} ${r.path}`),
  );
  const drafts = proposeRules(recent, requests as LoopRequest[]).filter(
    (d) => !accepted.has(`${(d.compiled.match?.method ?? "").toUpperCase()} ${d.compiled.match?.path ?? ""}`),
  );
  if (drafts.length === 0) return [];

  const existing = await ctx.cols.rules.find({ siteId }).toArray();
  const taken = new Set(existing.map((r) => matchKey(r.compiled.match)));
  const created: string[] = [];
  for (const draft of drafts) {
    const key = matchKey(draft.compiled.match);
    if (taken.has(key)) continue;
    taken.add(key);
    const doc: RuleDoc = { ...draft, ruleId: newId("rule"), siteId, createdAt: new Date() };
    await ctx.cols.rules.insertOne(doc);
    created.push(doc.ruleId);
  }
  return created;
}

function matchKey(match: RuleDoc["compiled"]["match"]): string {
  return `${(match?.method ?? "").toUpperCase()} ${match?.path ?? ""} ${match?.bodyField ?? ""}`;
}

// ---------- reflection ----------

function classify(episode: EpisodeDoc, requests: readonly SessionRequest[], calledCapability: boolean): FailureKind | null {
  if (requests.length === 0) return episode.goalSuccess === false ? "unknown_site" : null;
  if (episode.goalSuccess === true && episode.siteSuccess !== false) return null;
  if (episode.outcome === "blocked" || requests.some((r) => isWrite(r) && r.status === 403)) return "blocked";
  if (calledCapability) return "capability_failed";
  if (episode.siteSuccess === false) return "unknown_steps";
  const deskDidNotKnow = (episode.turns ?? []).some((t) => t.role === "desk" && DESK_DOES_NOT_KNOW.test(t.text));
  if (episode.goalSuccess === false) return deskDidNotKnow ? "unknown_site" : "wrong_answer";
  return deskDidNotKnow ? "unknown_site" : "unknown_steps";
}

function routeLine(r: Pick<RequestDoc, "method" | "path" | "status">): string {
  return `${r.method.toUpperCase()} ${r.path} returned ${r.status}`;
}

function deterministicWhy(
  episode: EpisodeDoc,
  failure: FailureKind | null,
  requests: readonly SessionRequest[],
  called: CapabilityDoc[],
  diff: string | null,
): string {
  const writes = requests.filter(isWrite);
  const lastFailedWrite = [...writes].reverse().find((r) => r.status >= 400);
  const lastWrite = writes[writes.length - 1];
  const names = called.map((c) => c.name).join(", ");
  let why: string;
  switch (failure) {
    case null:
      why = names
        ? `The visit succeeded using ${names}.`
        : lastWrite
          ? `The visit succeeded on the website: ${routeLine(lastWrite)}.`
          : "The visit reached its goal.";
      if (diff) why += ` What changed from the earlier failure: ${diff}.`;
      break;
    case "unknown_site":
      why = "The desk did not know this site yet, so the agent had nothing to work from.";
      break;
    case "unknown_steps":
      why = lastFailedWrite
        ? `The desk did not know the steps; the agent tried the website and ${routeLine(lastFailedWrite)}.`
        : "The desk did not know the steps, and the agent left without finishing.";
      break;
    case "capability_failed":
      why = lastFailedWrite
        ? `${names || "A learned action"} ran but ${routeLine(lastFailedWrite)}.`
        : `${names || "A learned action"} ran but the visit did not reach its goal.`;
      break;
    case "wrong_answer":
      why = "The desk answered, but the agent reported that its goal was not reached.";
      break;
    case "blocked":
      why = "The site refused the action, so the agent could not finish.";
      break;
  }
  if (failure !== null && episode.doneNote) why += ` The agent said: "${episode.doneNote.slice(0, 200)}"`;
  return why;
}

async function explain(
  ctx: AgentDeskContext,
  episode: EpisodeDoc,
  failure: FailureKind | null,
  requests: readonly SessionRequest[],
  called: CapabilityDoc[],
  diff: string | null,
): Promise<string> {
  if (requests.length === 0) return "No requests reached the site during this visit.";
  const fallback = deterministicWhy(episode, failure, requests, called, diff);
  // A visit that went fine has nothing to explain beyond the deterministic line.
  if (failure === null && !diff) return fallback;
  try {
    const answer = await withTimeout(
      ctx.llm.text({
        system:
          "You explain why an AI agent's visit to a website went the way it did, for the site's developer. " +
          "State only what the facts below show: never guess at causes, intentions or details they do not give. " +
          "Answer with exactly one plain sentence, under 220 characters, no markdown.",
        prompt: [
          `Goal: ${episode.goal ?? "unknown"}`,
          `Agent's own words at the end: ${episode.doneNote ?? "none"}`,
          `Failure kind: ${failure ?? "none (the visit succeeded)"}`,
          `Site requests (method, path, status, body shape): ${requests
            .map((r) => `${routeLine(r)}, body fields ${JSON.stringify(r.bodyShape ?? {})}`)
            .join("; ")}`,
          `Learned actions called: ${called.map((c) => c.name).join(", ") || "none"}`,
          `Difference from the earlier failed visit: ${diff ?? "none"}`,
        ].join("\n"),
        temperature: 0.1,
        maxOutputTokens: 1024,
      }),
      20_000,
      "reflection",
    );
    const sentence = answer.trim().replace(/\s+/g, " ");
    // A reflection is a sentence: reject a fragment or an essay and keep the deterministic line.
    const words = sentence.split(" ").length;
    return words >= 5 && sentence.length <= 400 ? sentence : fallback;
  } catch (err) {
    ctx.log.warn(`loop: reflection fell back to a deterministic explanation (${(err as Error).message})`);
    return fallback;
  }
}

function mergeLearned(previous: Learned[], fresh: Learned[]): Learned[] {
  const seen = new Set<string>();
  return [...previous, ...fresh].filter((l) => {
    const key = `${l.kind}:${l.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
