import type { AgentDeskContext } from "../contract/context.js";

// The learning curve for the panel (CONTRACT section 6), from closed episodes.

export interface LoopMetrics {
  visits: { n: number; episodeId: string; success: boolean; steps: number; seconds: number }[];
  /** Per intent: how many closed visits failed before the first one that succeeded. */
  failuresBeforeFirstSuccess: Record<string, number>;
}

const ms = (t: Date | string): number => (t instanceof Date ? t.getTime() : new Date(t).getTime());

export async function loopMetrics(ctx: AgentDeskContext): Promise<LoopMetrics> {
  const closed = (await ctx.cols.episodes.find({ outcome: { $ne: "open" } }).toArray()).sort(
    (a, b) => ms(a.createdAt) - ms(b.createdAt),
  );

  const failuresBeforeFirstSuccess: Record<string, number> = {};
  const solved = new Set<string>();
  const visits = closed.map((e, i) => {
    const success = e.goalSuccess === true && e.siteSuccess !== false;
    for (const intent of e.intents ?? []) {
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
