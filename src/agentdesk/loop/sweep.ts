import type { AgentDeskContext } from "../contract/context.js";
import type { EpisodeDoc } from "../contract/types.js";
import { processEpisode, type ProcessResult } from "./process.js";

// Finds the episodes that are ready to close and processes them (CONTRACT section 5, "When an episode closes").

const IDLE_MS = 60_000;
const SWEEP_EVERY_MS = 3_000;
const MAX_ATTEMPTS = 5;

const ms = (t: Date | string): number => (t instanceof Date ? t.getTime() : new Date(t).getTime());

const sweeping = new WeakSet<AgentDeskContext>();
const started = new WeakSet<AgentDeskContext>();
const failedAttempts = new Map<string, number>();

/** Closes every open episode that is done (the agent called `done`) or idle for more than 60 seconds. */
export async function sweepOnce(ctx: AgentDeskContext, now: number = Date.now()): Promise<(ProcessResult & { episodeId: string })[]> {
  // One database is one site (CONTRACT section 2), so no site filter: each episode is processed under its own siteId.
  const open = await ctx.cols.episodes.find({ outcome: "open" }).toArray();
  if (open.length === 0) return [];

  const lastRequestAt = new Map<string, number>();
  const requests = await ctx.cols.requests
    .find({ sessionId: { $in: open.map((e) => e.sessionId) } }, { projection: { sessionId: 1, timestamp: 1 } })
    .toArray();
  for (const r of requests) {
    if (!r.sessionId) continue;
    lastRequestAt.set(r.sessionId, Math.max(lastRequestAt.get(r.sessionId) ?? 0, ms(r.timestamp)));
  }

  const due = open
    .filter((e) => isDone(e) || now - lastActivity(e, lastRequestAt.get(e.sessionId)) > IDLE_MS)
    .filter((e) => (failedAttempts.get(e.episodeId) ?? 0) < MAX_ATTEMPTS)
    .sort((a, b) => ms(a.createdAt) - ms(b.createdAt));

  const results: (ProcessResult & { episodeId: string })[] = [];
  for (const episode of due) {
    try {
      // An episode with no `done` that went idle stays goalSuccess null; the core closes it as "abandoned".
      results.push({ episodeId: episode.episodeId, ...(await processEpisode(ctx, episode.episodeId)) });
      failedAttempts.delete(episode.episodeId);
    } catch (err) {
      const attempts = (failedAttempts.get(episode.episodeId) ?? 0) + 1;
      failedAttempts.set(episode.episodeId, attempts);
      ctx.log.error(
        `loop: could not process ${episode.episodeId} (attempt ${attempts}/${MAX_ATTEMPTS}${attempts >= MAX_ATTEMPTS ? ", giving up until restart" : ""})`,
        err,
      );
    }
  }
  return results;
}

function isDone(e: EpisodeDoc): boolean {
  return e.goalSuccess !== null && e.goalSuccess !== undefined;
}

function lastActivity(e: EpisodeDoc, lastRequest: number | undefined): number {
  const turnTimes = (e.turns ?? []).map((t) => ms(t.at));
  return Math.max(ms(e.createdAt), lastRequest ?? 0, ...turnTimes);
}

/** Runs the sweep every 3 seconds in the background. Never throws into the host app. */
export async function startLoop(ctx: AgentDeskContext): Promise<void> {
  if (started.has(ctx)) return;
  started.add(ctx);

  const tick = async (): Promise<void> => {
    if (sweeping.has(ctx)) return;
    sweeping.add(ctx);
    try {
      await sweepOnce(ctx);
    } catch (err) {
      ctx.log.error("loop: sweep failed, will try again", err);
    } finally {
      sweeping.delete(ctx);
    }
  };

  setInterval(() => void tick(), SWEEP_EVERY_MS).unref();
  ctx.log.info(`loop: watching for finished visits every ${SWEEP_EVERY_MS / 1000}s`);
  void tick();
}
