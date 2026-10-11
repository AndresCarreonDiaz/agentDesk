// The Loop (docs/parts/loop.md). agentdesk() calls startLoop(ctx) on boot.
// core.ts holds the pure decisions; process.ts is the reflector for one episode.

export { startLoop, sweepOnce } from "./sweep.js";
export { processEpisode, type ProcessResult } from "./process.js";
export { loopMetrics, type LoopMetrics } from "./metrics.js";
