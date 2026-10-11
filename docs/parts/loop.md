# Part: Loop

The recursive part: closing episodes, the reflector, capability stages, metrics and Raindrop.

## Owns

`src/agentdesk/loop/`. It runs in the same process as the host app: `agentdesk()` calls `startLoop(ctx)` on boot, so the developer installs and runs nothing extra. It thinks with the developer's own LLM key.

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 3 to 6.

- Closes `episodes`: `requestIds`, `outcome`, `steps`, `durationMs`, `reflection`.
- Creates `capabilities` and sets every stage except `approved` / `blocked`.
- Writes `knowledge`.
- Reads `requests`, `rules`, `feedback`.

## Gives others

- **Episode close:** after `done` (`/agent/done`) or after 60 seconds with no agent call and no tapped request for the session (then `outcome: "abandoned"`). Join `requests` by `sessionId`, compute steps and duration, set outcome.
- **Reflector:** reads the agent's own `doneNote` first ("I wanted X and couldn't" is a free lesson). Classifies the failure (`unknown_site`, `unknown_steps`, `capability_failed`, `wrong_answer`, `blocked`) and learns: site facts into `knowledge`, a successful fallback request into an `observed` then `proposed` capability, a failed call into a fixed description or schema. Writes a plain `why` for the panel.
- **Verification:** moves a capability to `verified` only when an episode with `goalSuccess: true` called it.
- **Metrics:** success rate, steps and seconds per visit number, from `episodes`.
- **Raindrop:** one event per visit with tool spans and signals (success, abandon, policy denial, correction). See [RAINDROP.md](../RAINDROP.md). Free tier stops at 1,000 events per month, so do not send one event per HTTP request.

## Needs from others

- Door: real `requests` from the tap (inside the package). Until then, use `fixtures/episode-cart-fail.json`.
- Door: episodes with turns and `goalSuccess`. Until then, fixtures.

## Order

1. Fixture episode closes and the reflector produces a classified `reflection`.
2. Fixture fallback request becomes a `proposed` capability. **Hand off to Door.**
3. A capability moves to `verified` from a successful fixture episode.
4. Real episodes from Store and Door close and learn.
5. Metrics endpoint for the panel's learning curve.
6. Raindrop basic signals. (Cut line: Experiments first.)

## Run and test

- Run: _fill in_
- Test: _fill in_

## Status

Not started.
