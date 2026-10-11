# Loop core

`core.ts` holds the pure, synchronous functions of the Loop (CONTRACT sections 3, 4, 4b). No I/O, no LLM.

- `closeEpisode(episode, requests, history)`: requestIds, siteSuccess, steps, durationMs, priorFailureId, outcome.
- `buildCapability(episode, requests)`: an `observed` write capability from successful fallback writes, or `null`.
- `diffEpisodes(failedRequests, successRequests)`: `{ changes }` of type, missing_field, extra_field, missing_step.
- `nextStage(stage, outcomes)`: observed to proposed, proposed to verified, verified demoted; approved/blocked fixed.
- `proposeRules(episodes, requests)`: `proposed`, disabled `require_review` rules for writes failing in 2+ episodes.
