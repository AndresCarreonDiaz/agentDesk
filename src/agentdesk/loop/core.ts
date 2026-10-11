// Deterministic core of the Loop: pure, synchronous, no I/O. See docs/CONTRACT.md sections 3, 4, 4b.

type Time = string | Date;
type Shape = Record<string, string>;
type Stage = "observed" | "proposed" | "verified" | "approved" | "blocked";

export interface LoopRequest {
  requestId: string;
  sessionId: string;
  episodeId?: string | null;
  source: string;
  method: string;
  path: string;
  bodyShape?: Shape | null;
  status: number;
  timestamp: Time;
}

export interface LoopEpisode {
  episodeId: string;
  sessionId: string;
  intents: string[];
  turns: { role: string; at: Time }[];
  goalSuccess: boolean | null;
  siteSuccess?: boolean | null;
  createdAt: Time;
}

export interface Close {
  requestIds: string[];
  siteSuccess: boolean | null;
  steps: number;
  durationMs: number;
  priorFailureId: string | null;
  outcome: "success" | "error" | "abandoned";
}

export interface CapabilityDraft {
  kind: "write";
  stage: "observed";
  sourceEpisodeId: string;
  sourceRequestId: string;
  mappedRequests: { method: string; path: string; bodyTemplate: Record<string, string> }[];
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string }>;
    required: string[];
  };
}

export type Change =
  | { kind: "type"; method: string; path: string; field: string; failed: string; success: string }
  | { kind: "missing_field"; method: string; path: string; field: string; success: string }
  | { kind: "extra_field"; method: string; path: string; field: string; failed: string }
  | { kind: "missing_step"; method: string; path: string };

export interface Outcome {
  goalSuccess: boolean | null;
  siteSuccess: boolean | null;
}

export interface RuleDraft {
  source: "reflector";
  status: "proposed";
  enabled: false;
  compiled: { action: "require_review"; match: { method: string; path: string } };
  evidence: string[];
  text: string;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ms(t: Time): number {
  return t instanceof Date ? t.getTime() : new Date(t).getTime();
}

function isWrite(r: LoopRequest): boolean {
  return !READ_METHODS.has(String(r.method).toUpperCase());
}

function byTime(rs: readonly LoopRequest[]): LoopRequest[] {
  return rs
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ms(a.r.timestamp) - ms(b.r.timestamp) || a.i - b.i)
    .map((x) => x.r);
}

function keyOf(r: LoopRequest): string {
  return `${String(r.method).toUpperCase()} ${r.path}`;
}

function failed(o: Outcome): boolean {
  return o.goalSuccess === false || o.siteSuccess === false;
}

export function closeEpisode(
  episode: LoopEpisode,
  requests: readonly LoopRequest[],
  history: readonly LoopEpisode[],
): Close {
  const mine = byTime(requests.filter((r) => r.sessionId === episode.sessionId));

  const lastWrites = new Map<string, LoopRequest>();
  for (const r of mine) if (isWrite(r)) lastWrites.set(keyOf(r), r);
  let siteSuccess: boolean | null = null;
  if (lastWrites.size > 0) {
    siteSuccess = [...lastWrites.values()].every((r) => r.status < 400);
  }

  const agentTurns = episode.turns.filter((t) => t.role === "agent").length;
  const taps = mine.filter((r) => r.source === "fallback" || r.source === "capability").length;

  const points = [...episode.turns.map((t) => ms(t.at)), ...mine.map((r) => ms(r.timestamp))];
  const durationMs = points.length < 2 ? 0 : Math.max(...points) - Math.min(...points);

  const created = ms(episode.createdAt);
  let prior: LoopEpisode | null = null;
  for (const h of history) {
    if (ms(h.createdAt) >= created) continue;
    if (!h.intents.some((i) => episode.intents.includes(i))) continue;
    if (!failed(h as Outcome)) continue;
    if (prior === null || ms(h.createdAt) > ms(prior.createdAt)) prior = h;
  }

  let outcome: Close["outcome"];
  if (episode.goalSuccess === true && siteSuccess !== false) outcome = "success";
  else if (episode.goalSuccess === null) outcome = "abandoned";
  else outcome = "error";

  return {
    requestIds: mine.map((r) => r.requestId),
    siteSuccess,
    steps: agentTurns + taps,
    durationMs,
    priorFailureId: prior ? prior.episodeId : null,
    outcome,
  };
}

export function buildCapability(
  episode: LoopEpisode,
  requests: readonly LoopRequest[],
): CapabilityDraft | null {
  const writes = byTime(requests).filter(
    (r) =>
      r.sessionId === episode.sessionId &&
      r.source === "fallback" &&
      isWrite(r) &&
      r.status >= 200 &&
      r.status < 300,
  );
  if (writes.length === 0) return null;

  const properties: Record<string, { type: string }> = {};
  const mappedRequests = writes.map((r) => {
    const bodyTemplate: Record<string, string> = {};
    for (const [field, type] of Object.entries(r.bodyShape ?? {})) {
      bodyTemplate[field] = `{{${field}}}`;
      if (!(field in properties)) properties[field] = { type };
    }
    return { method: String(r.method).toUpperCase(), path: r.path, bodyTemplate };
  });

  return {
    kind: "write",
    stage: "observed",
    sourceEpisodeId: episode.episodeId,
    sourceRequestId: writes[0].requestId,
    mappedRequests,
    inputSchema: { type: "object", properties, required: Object.keys(properties) },
  };
}

export function diffEpisodes(
  failedRequests: readonly LoopRequest[],
  successRequests: readonly LoopRequest[],
): { changes: Change[] } {
  const failedShapes = new Map<string, Shape>();
  for (const r of byTime(failedRequests)) {
    if (!isWrite(r)) continue;
    const merged = failedShapes.get(keyOf(r)) ?? {};
    failedShapes.set(keyOf(r), { ...merged, ...(r.bodyShape ?? {}) });
  }

  const successShapes = new Map<string, { method: string; path: string; shape: Shape; ok: boolean }>();
  for (const r of byTime(successRequests)) {
    if (!isWrite(r)) continue;
    const prev = successShapes.get(keyOf(r));
    successShapes.set(keyOf(r), {
      method: String(r.method).toUpperCase(),
      path: r.path,
      shape: { ...(prev?.shape ?? {}), ...(r.bodyShape ?? {}) },
      ok: (prev?.ok ?? false) || (r.status >= 200 && r.status < 300),
    });
  }

  const changes: Change[] = [];
  for (const [key, s] of successShapes) {
    const f = failedShapes.get(key);
    const { method, path } = s;
    if (f === undefined) {
      if (s.ok) changes.push({ kind: "missing_step", method, path });
      continue;
    }
    for (const [field, success] of Object.entries(s.shape)) {
      if (!(field in f)) changes.push({ kind: "missing_field", method, path, field, success });
      else if (f[field] !== success) {
        changes.push({ kind: "type", method, path, field, failed: f[field], success });
      }
    }
    for (const [field, fType] of Object.entries(f)) {
      if (!(field in s.shape)) changes.push({ kind: "extra_field", method, path, field, failed: fType });
    }
  }
  return { changes };
}

export function nextStage(stage: Stage, outcomes: readonly Outcome[]): Stage {
  if (stage === "approved" || stage === "blocked") return stage;
  if (stage === "observed") return "proposed";
  const last = outcomes[outcomes.length - 1];
  if (stage === "proposed") {
    return last !== undefined && last.goalSuccess === true && last.siteSuccess === true
      ? "verified"
      : "proposed";
  }
  if (stage === "verified") {
    const lastTwo = outcomes.slice(-2);
    return lastTwo.length === 2 && lastTwo.every(failed) ? "proposed" : "verified";
  }
  return stage;
}

export function proposeRules(
  episodes: readonly { episodeId: string; sessionId?: string }[],
  requests: readonly LoopRequest[],
): RuleDraft[] {
  const bySession = new Map<string, string>();
  for (const e of episodes) if (e.sessionId) bySession.set(e.sessionId, e.episodeId);

  const groups = new Map<string, { method: string; path: string; ids: string[] }>();
  for (const r of byTime(requests)) {
    if (!isWrite(r) || r.status < 400) continue;
    const id = r.episodeId ?? bySession.get(r.sessionId);
    if (!id) continue;
    const key = keyOf(r);
    const g = groups.get(key) ?? { method: String(r.method).toUpperCase(), path: r.path, ids: [] };
    if (!g.ids.includes(id)) g.ids.push(id);
    groups.set(key, g);
  }

  const drafts: RuleDraft[] = [];
  for (const g of groups.values()) {
    if (g.ids.length < 2) continue;
    drafts.push({
      source: "reflector",
      status: "proposed",
      enabled: false,
      compiled: { action: "require_review", match: { method: g.method, path: g.path } },
      evidence: g.ids,
      text: `Review ${g.method} ${g.path}: it failed in ${g.ids.length} episodes.`,
    });
  }
  return drafts;
}
