import type { AgentDeskContext } from "../contract/context.js";

// The learning curve for the panel (CONTRACT section 6), from closed episodes.

export interface LoopMetrics {
  visits: { n: number; episodeId: string; success: boolean; steps: number; seconds: number }[];
  /** Per intent (or, for a visit with no intents, per write route "METHOD /path"): how many closed visits failed before the first one that succeeded. */
  failuresBeforeFirstSuccess: Record<string, number>;
}

const ms = (t: Date | string): number => (t instanceof Date ? t.getTime() : new Date(t).getTime());
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function loopMetrics(ctx: AgentDeskContext): Promise<LoopMetrics> {
  const closed = (await ctx.cols.episodes.find({ outcome: { $ne: "open" } }).toArray()).sort(
    (a, b) => ms(a.createdAt) - ms(b.createdAt),
  );

  // Live visits carry no intents: such a visit is counted under its first write, "METHOD /path".
  const noIntent = closed.filter((e) => (e.intents ?? []).length === 0).map((e) => e.sessionId);
  const firstWrite = new Map<string, string>();
  if (noIntent.length > 0) {
    const writes = (await ctx.cols.requests.find({ sessionId: { $in: noIntent } }).toArray())
      .filter((r) => !READ_METHODS.has(r.method.toUpperCase()))
      .sort((a, b) => ms(a.timestamp) - ms(b.timestamp));
    for (const r of writes) {
      if (r.sessionId && !firstWrite.has(r.sessionId)) firstWrite.set(r.sessionId, `${r.method.toUpperCase()} ${r.path.split("?")[0]}`);
    }
  }

  const failuresBeforeFirstSuccess: Record<string, number> = {};
  const solved = new Set<string>();
  const visits = closed.map((e, i) => {
    const success = e.goalSuccess === true && e.siteSuccess !== false;
    const route = firstWrite.get(e.sessionId);
    const keys = (e.intents ?? []).length > 0 ? e.intents : route ? [route] : [];
    for (const intent of keys) {
      if (solved.has(intent)) continue;
      failuresBeforeFirstSuccess[intent] ??= 0;
      if (success) solved.add(intent);
      else failuresBeforeFirstSuccess[intent] += 1;
    }
    return {
      n: i + 1,
      episodeId: e.episodeId,
      success,
      steps: e.steps ?? 0,
      seconds: Math.round(((e.durationMs ?? 0) / 1000) * 10) / 10,
    };
  });

  return { visits, failuresBeforeFirstSuccess };
}
