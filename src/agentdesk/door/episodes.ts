import type { IncomingHttpHeaders } from "node:http";
import type { AgentDeskContext } from "../contract/context.js";
import { newId } from "../contract/ids.js";
import type { EpisodeDoc, Turn } from "../contract/types.js";
import { rememberEpisode } from "./sessions.js";

// Door creates episodes, appends turns and saves the agent's own verdict (CONTRACT section 5).
// Loop closes them.

const SESSION_ID = /^ses_[a-f0-9]{8,64}$/;

/** The episode for this session, created on the agent's first call. */
export async function openEpisode(
  ctx: AgentDeskContext,
  sessionId: string | null | undefined,
  headers: IncomingHttpHeaders,
): Promise<EpisodeDoc> {
  if (sessionId && SESSION_ID.test(sessionId)) {
    const existing = await ctx.cols.episodes.findOne({ sessionId, siteId: ctx.config.siteId });
    if (existing) {
      rememberEpisode(sessionId, existing.episodeId, ctx);
      return existing;
    }
  }

  const now = new Date();
  const episode: EpisodeDoc = {
    siteId: ctx.config.siteId,
    createdAt: now,
    episodeId: newId("ep"),
    // An unknown but well-formed id is kept, so a visitor that minted its own still joins its fallback clicks.
    sessionId: sessionId && SESSION_ID.test(sessionId) ? sessionId : newId("ses"),
    agentFamily: agentFamily(headers),
    goal: null,
    intents: [],
    turns: [],
    requestIds: [],
    outcome: "open",
    goalSuccess: null,
    doneNote: null,
    siteSuccess: null,
    steps: 0,
    durationMs: 0,
    priorFailureId: null,
    reflection: null,
  };
  await ctx.cols.episodes.insertOne(episode);
  rememberEpisode(episode.sessionId, episode.episodeId, ctx);
  return episode;
}

export async function appendTurns(
  ctx: AgentDeskContext,
  episodeId: string,
  turns: Turn[],
  extra: { goal?: string | null; intents?: string[] } = {},
): Promise<void> {
  const update: Record<string, unknown> = { $push: { turns: { $each: turns } } };
  const set: Record<string, unknown> = {};
  if (extra.goal) set.goal = extra.goal;
  if (Object.keys(set).length) update.$set = set;
  if (extra.intents?.length) update.$addToSet = { intents: { $each: extra.intents } };
  // Only while open: a closed episode belongs to the Loop.
  await ctx.cols.episodes.updateOne({ episodeId, outcome: "open" }, update);
}

/** `done`: the agent's own verdict. A hypothesis; Loop checks it against the site's evidence. */
export async function markDone(
  ctx: AgentDeskContext,
  sessionId: string,
  goalSuccess: boolean,
  note: string | null,
): Promise<EpisodeDoc | null> {
  const episode = await ctx.cols.episodes.findOneAndUpdate(
    { sessionId, siteId: ctx.config.siteId },
    {
      $set: { goalSuccess, doneNote: note?.slice(0, 1000) ?? null },
      $push: { turns: { role: "agent", text: `done: ${goalSuccess ? "goal reached" : "goal not reached"}${note ? `. ${note}` : ""}`, at: new Date() } },
    },
    { returnDocument: "after" },
  );
  return episode ?? null;
}

/** "dots" | "muse" | "claude" | "script:<name>" ..., from an explicit header or the user agent. */
export function agentFamily(headers: IncomingHttpHeaders): string {
  const explicit = headers["x-agentdesk-agent"];
  const named = Array.isArray(explicit) ? explicit[0] : explicit;
  if (named && /^[\w:.-]{1,60}$/.test(named)) return named.toLowerCase();
  const ua = String(headers["user-agent"] ?? "").toLowerCase();
  for (const family of ["dots", "muse", "claude", "chatgpt", "openai", "gemini", "perplexity"]) {
    if (ua.includes(family)) return family;
  }
  return ua ? "unknown" : "script:anonymous";
}
