import type { AgentDeskContext } from "../contract/context.js";
import type { EpisodeDoc, KnowledgeDoc, RequestDoc } from "../contract/types.js";
import { diffEpisodes, type Change } from "./core.js";
import { embedOrEmpty, lessonFromChanges } from "./naming.js";

// The reflector's second loop: how it teaches (docs/parts/loop.md, "playbook").
// A playbook version holds one parameter, the style of a failure lesson. When an agent was shown a lesson
// and still repeated the mistake, the Loop tries the other style for one visit and keeps it only if the
// next visit to that route follows it. One site is one database, so the collection needs no site filter.

export type LessonStyle = "field" | "example";

export interface PlaybookDoc {
  version: number;
  siteId: string;
  params: { lessonStyle: LessonStyle };
  status: "active" | "trial" | "kept" | "reverted";
  parentVersion: number | null;
  reason: string;
  trigger: { method: string; path: string; field: string; episodeId: string } | null;
  result: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export type PlaybookSignal = "lesson_style_changed" | "lesson_style_kept" | "lesson_style_reverted";

type SessionRequest = RequestDoc & { sessionId: string };

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const EXAMPLE_MARKER = "send a body like ";
// A lesson shows up in `about` and `ask`: keep an example short enough to read in one glance.
const MAX_EXAMPLE_CHARS = 1000;

const ms = (t: Date | string): number => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const isWrite = (r: { method: string }): boolean => !READ_METHODS.has(r.method.toUpperCase());
const cleanPath = (path: string): string => path.split("?")[0];
const routeKey = (r: { method: string; path: string }): string => `${r.method.toUpperCase()} ${cleanPath(r.path)}`;
const squash = (s: string): string => s.replace(/\s+/g, " ").trim();
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasSession = <T extends RequestDoc>(r: T): r is T & { sessionId: string } => typeof r.sessionId === "string";
const is2xx = (status: number): boolean => status >= 200 && status < 300;

// ---------- reading the playbook ----------

function playbooks(ctx: AgentDeskContext) {
  return ctx.db.collection<PlaybookDoc>("playbooks");
}

/** The trial if one is open, else the latest active or kept version, else the default (version 0, field lessons). */
export async function getPlaybook(ctx: AgentDeskContext): Promise<PlaybookDoc> {
  const col = playbooks(ctx);
  const sort = { version: -1 } as const;
  const trial = await col.findOne({ status: "trial" }, { sort, projection: { _id: 0 } });
  if (trial) return trial as PlaybookDoc;
  const live = await col.findOne({ status: { $in: ["active", "kept"] } }, { sort, projection: { _id: 0 } });
  if (live) return live as PlaybookDoc;
  return {
    version: 0,
    siteId: ctx.config.siteId,
    params: { lessonStyle: "field" },
    status: "active",
    parentVersion: null,
    reason: "Default playbook: lessons name the field.",
    trigger: null,
    result: null,
    createdAt: new Date(0),
    decidedAt: null,
  };
}

// ---------- lesson text, in either style (pure) ----------

/**
 * "field": today's lesson ("POST /api/cart/items: include sku (string)").
 * "example": a working body for each route whose body was wrong ("POST /api/cart/items: send a body like {...}").
 * A route with no example body, and a missing step, keep the field wording.
 */
export function renderLesson(
  style: LessonStyle,
  changes: readonly Change[],
  exampleFor: (method: string, path: string) => Record<string, unknown> | null,
): string {
  if (style === "field") return lessonFromChanges(changes);
  const written = new Set<string>();
  const parts: string[] = [];
  for (const c of changes) {
    const example = c.kind === "missing_step" ? null : exampleFor(c.method, c.path);
    if (!example) {
      parts.push(lessonFromChanges([c]));
      continue;
    }
    const key = routeKey(c);
    if (written.has(key)) continue;
    written.add(key);
    parts.push(`${c.method} ${c.path}: ${EXAMPLE_MARKER}${JSON.stringify(example)}`);
  }
  return parts.join("; ");
}

/** The wording after "METHOD /path: " for each clause of the lesson that is about that route. */
function routeClauses(text: string, method: string, path: string): string[] {
  const marker = new RegExp(`${escapeRegex(`${method} ${path}`)}: `, "i");
  return text.split("; ").flatMap((piece) => {
    const m = marker.exec(piece);
    return m ? [piece.slice(m.index + m[0].length)] : [];
  });
}

/**
 * The field a field-style lesson names for this route, when the failed request repeats that mistake:
 * the field is still missing, still has the type the lesson corrects, or is still sent when it should not be.
 */
export function repeatedMistake(
  lessonText: string,
  method: string,
  path: string,
  bodyShape: Record<string, string> | null | undefined,
): string | null {
  const shape = bodyShape ?? {};
  for (const clause of routeClauses(lessonText, method, path)) {
    let m = /^include (.+) \((.+)\)$/.exec(clause);
    if (m && !(m[1] in shape)) return m[1];
    m = /^send (.+) as (.+), not (.+)$/.exec(clause);
    if (m && shape[m[1]] === m[3]) return m[1];
    m = /^do not send (.+)$/.exec(clause);
    if (m && m[1] in shape) return m[1];
  }
  return null;
}

/** The example body inside an example-style lesson for this route, or null. */
export function exampleInLesson(text: string, method: string, path: string): Record<string, unknown> | null {
  const marker = new RegExp(`${escapeRegex(`${method} ${path}`)}: ${escapeRegex(EXAMPLE_MARKER)}`, "i");
  const m = marker.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  if (text[start] !== "{") return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      try {
        const value: unknown = JSON.parse(text.slice(start, i + 1));
        return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

// ---------- example bodies and lesson rewriting ----------

/** The earliest accepted (2xx) agent write to this route that carried an object body: a request that worked. */
async function exampleBody(ctx: AgentDeskContext, method: string, path: string): Promise<Record<string, unknown> | null> {
  const rows = await ctx.cols.requests
    .find({ siteId: ctx.config.siteId, path: cleanPath(path), status: { $gte: 200, $lt: 300 } })
    .toArray();
  const hit = rows
    .filter((r) => typeof r.sessionId === "string" && routeKey(r) === `${method.toUpperCase()} ${cleanPath(path)}`)
    .sort((a, b) => ms(a.timestamp) - ms(b.timestamp))
    .find((r) => r.body && typeof r.body === "object" && !Array.isArray(r.body) && Object.keys(r.body).length > 0);
  if (!hit) return null;
  const body = hit.body as Record<string, unknown>;
  return JSON.stringify(body).length <= MAX_EXAMPLE_CHARS ? body : null;
}

/** The lesson wording for these changes in the given style, looking up example bodies when it needs them. */
export async function lessonWording(ctx: AgentDeskContext, style: LessonStyle, changes: readonly Change[]): Promise<string> {
  const examples = new Map<string, Record<string, unknown> | null>();
  if (style === "example") {
    for (const c of changes) {
      if (c.kind === "missing_step" || examples.has(routeKey(c))) continue;
      examples.set(routeKey(c), await exampleBody(ctx, c.method, c.path));
    }
  }
  return renderLesson(style, changes, (method, path) => examples.get(routeKey({ method, path })) ?? null);
}

/**
 * What a failure lesson would say in another style, derived the way it was first written: from the diff between
 * the failed visit and the visit that fixed it. Null when that evidence is gone.
 */
async function lessonInStyle(ctx: AgentDeskContext, lesson: KnowledgeDoc, style: LessonStyle): Promise<string | null> {
  if (!lesson.sourceRef) return null;
  const fixed = await ctx.cols.episodes.findOne({ episodeId: lesson.sourceRef });
  if (!fixed?.priorFailureId) return null;
  const failed = await ctx.cols.episodes.findOne({ episodeId: fixed.priorFailureId });
  if (!failed) return null;
  const sessions = [failed.sessionId, fixed.sessionId];
  const rows = (await ctx.cols.requests.find({ sessionId: { $in: sessions } }).toArray()).filter(hasSession);
  const { changes } = diffEpisodes(
    rows.filter((r) => r.sessionId === failed.sessionId),
    rows.filter((r) => r.sessionId === fixed.sessionId),
  );
  if (changes.length === 0) return null;
  return `for ${lesson.intent ?? fixed.goal ?? "this task"}: ${await lessonWording(ctx, style, changes)}`;
}

async function failureLessons(ctx: AgentDeskContext): Promise<KnowledgeDoc[]> {
  return ctx.cols.knowledge
    .find({ siteId: ctx.config.siteId, source: "failure" }, { projection: { embedding: 0 } })
    .sort({ createdAt: -1 })
    .toArray() as Promise<KnowledgeDoc[]>;
}

async function writeLessonText(ctx: AgentDeskContext, lesson: KnowledgeDoc, text: string): Promise<void> {
  if (lesson.text === text) return;
  await ctx.cols.knowledge.updateOne(
    { knowledgeId: lesson.knowledgeId },
    { $set: { text, embedding: await embedOrEmpty(ctx, text) } },
  );
}

/** Rewrites the lessons picked by `pick` in the given style, in place. Returns how many changed. */
async function restyleLessons(
  ctx: AgentDeskContext,
  lessons: readonly KnowledgeDoc[],
  pick: (lesson: KnowledgeDoc) => boolean,
  style: LessonStyle,
): Promise<number> {
  let changed = 0;
  for (const lesson of lessons.filter(pick)) {
    const text = await lessonInStyle(ctx, lesson, style);
    if (text && text !== lesson.text) {
      await writeLessonText(ctx, lesson, text);
      changed += 1;
    }
  }
  return changed;
}

// ---------- the second loop ----------

export interface PlaybookStep {
  episode: EpisodeDoc;
  /** This episode's own requests (its session). */
  requests: readonly SessionRequest[];
  /** The visit reached its goal and the site accepted it. */
  succeeded: boolean;
  /** False when the episode was reflected on before: a playbook is never decided or opened by a re-run. */
  firstPass: boolean;
}

/**
 * Decides an open trial with this episode, or opens one. Returns the signals for what happened.
 * An episode that decided a trial never opens the next one.
 */
export async function advancePlaybook(ctx: AgentDeskContext, step: PlaybookStep): Promise<PlaybookSignal[]> {
  if (!step.firstPass) return [];
  const col = playbooks(ctx);
  const writes = step.requests.filter(isWrite).sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
  if (writes.length === 0) return [];

  const trial = await col.findOne({ status: "trial" }, { sort: { version: -1 } });
  if (!trial) return openTrial(ctx, step, writes);
  if (trial.trigger?.episodeId === step.episode.episodeId) {
    // A run that opened this trial but stopped before the lessons were rewritten: finish that, never decide it.
    const { method, path } = trial.trigger;
    await restyleLessons(ctx, await failureLessons(ctx), (l) => routeClauses(l.text, method, path).length > 0, "example");
    return [];
  }
  return decideTrial(ctx, trial, step, writes);
}

async function decideTrial(
  ctx: AgentDeskContext,
  trial: PlaybookDoc,
  step: PlaybookStep,
  writes: readonly SessionRequest[],
): Promise<PlaybookSignal[]> {
  if (!trial.trigger) return [];
  const { method, path } = trial.trigger;
  const route = routeKey({ method, path });
  // The first write is the agent's own attempt after reading the lesson; a later retry says nothing about it.
  const attempt = writes.find((w) => routeKey(w) === route);
  if (!attempt) return [];

  const lessons = await failureLessons(ctx);
  const shown = lessons.map((l) => exampleInLesson(l.text, method, path)).find((e) => e !== null) ?? (await exampleBody(ctx, method, path));
  const expected = shown ? Object.keys(shown) : [];
  const sent = Object.keys(attempt.bodyShape ?? {});
  const missing = expected.filter((f) => !sent.includes(f));
  const accepted = is2xx(attempt.status);
  const label = `${method} ${path}`;
  const id = step.episode.episodeId;

  if (expected.length > 0 && missing.length === 0 && accepted) {
    await playbooks(ctx).updateOne(
      { version: trial.version, status: "trial" },
      {
        $set: {
          status: "kept",
          decidedAt: new Date(),
          result: `Kept: episode ${id} sent ${label} with every field of the example (${expected.join(", ")}) and the site answered ${attempt.status}.`,
        },
      },
    );
    return ["lesson_style_kept"];
  }

  const why = [
    expected.length === 0 ? "the example body could not be read" : null,
    missing.length > 0 ? `the request lacked ${missing.join(", ")}` : null,
    accepted ? null : `the site answered ${attempt.status}`,
  ]
    .filter(Boolean)
    .join(" and ");
  // Lessons first, status second: a run that stops in between is finished by the next one.
  await restyleLessons(ctx, lessons, (l) => l.text.includes(EXAMPLE_MARKER), "field");
  await playbooks(ctx).updateOne(
    { version: trial.version, status: "trial" },
    {
      $set: {
        status: "reverted",
        decidedAt: new Date(),
        result: `Reverted: episode ${id} wrote ${label} after the example lesson, but ${why}. Lessons are back to naming the field.`,
      },
    },
  );
  return ["lesson_style_reverted"];
}

async function openTrial(ctx: AgentDeskContext, step: PlaybookStep, writes: readonly SessionRequest[]): Promise<PlaybookSignal[]> {
  if (step.succeeded) return [];
  const failedWrites = writes.filter((w) => w.status >= 400);
  if (failedWrites.length === 0) return [];

  const col = playbooks(ctx);
  const episodeId = step.episode.episodeId;
  const current = await getPlaybook(ctx);
  if (current.params.lessonStyle !== "field") return [];

  // This episode already opened a version (and it has since been decided).
  if (await col.findOne({ "trigger.episodeId": episodeId }, { projection: { version: 1 } })) return [];
  const lessons = await failureLessons(ctx);

  // The desk's own turns are what the agent was shown.
  const shownTexts = (step.episode.turns ?? []).filter((t) => t.role === "desk").map((t) => squash(t.text));
  const wasShown = (lesson: KnowledgeDoc): boolean => shownTexts.some((t) => t.includes(squash(lesson.text)));

  for (const write of failedWrites) {
    for (const lesson of lessons) {
      const field = repeatedMistake(lesson.text, write.method, write.path, write.bodyShape);
      if (!field || !wasShown(lesson)) continue;
      const rewritten = await lessonInStyle(ctx, lesson, "example");
      if (!rewritten || rewritten === lesson.text) continue;

      const latest = await col.findOne({}, { sort: { version: -1 }, projection: { version: 1 } });
      const method = write.method.toUpperCase();
      const path = cleanPath(write.path);
      const doc: PlaybookDoc = {
        version: (latest?.version ?? 0) + 1,
        siteId: ctx.config.siteId,
        params: { lessonStyle: "example" },
        status: "trial",
        parentVersion: current.version,
        reason: `${method} ${path}: the lesson was shown to the agent, but the request still did not follow it (${field}). Trying a full example body instead of naming the field.`,
        trigger: { method, path, field, episodeId },
        result: null,
        createdAt: new Date(),
        decidedAt: null,
      };
      await col.insertOne({ ...doc });
      await restyleLessons(ctx, lessons, (l) => routeClauses(l.text, method, path).length > 0, "example");
      return ["lesson_style_changed"];
    }
  }
  return [];
}
