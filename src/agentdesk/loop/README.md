# Loop core

`core.ts` holds the pure, synchronous functions of the Loop (CONTRACT sections 3, 4, 4b). No I/O, no LLM.

- `closeEpisode(episode, requests, history)`: requestIds, siteSuccess, steps, durationMs, priorFailureId, outcome.
- `buildCapability(episode, requests)`: an `observed` write capability from successful fallback writes, or `null`.
- `diffEpisodes(failedRequests, successRequests)`: `{ changes }` of type, missing_field, extra_field, missing_step.
- `nextStage(stage, outcomes)`: observed to proposed, proposed to verified, verified demoted; approved/blocked fixed.
- `proposeRules(episodes, requests)`: `proposed`, disabled `require_review` rules for writes failing in 2+ episodes.

## Wiring

- `process.ts`: `processEpisode(ctx, episodeId)`, the idempotent reflector that uses the core and writes the collections.
- `sweep.ts`: `sweepOnce(ctx)` and `startLoop(ctx)` (every 3 s, unref'd, never throws into the host).
- `metrics.ts`: `loopMetrics(ctx)`.
- `naming.ts`: LLM capability names and `why` sentences with deterministic fallbacks; readable diff and lesson text.
- `raindrop.ts`: one `agent_visit` event per processed episode.
