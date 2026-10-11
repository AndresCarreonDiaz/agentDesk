# Part: Loop

The recursive part: closing episodes, the reflector, capability stages, metrics and Raindrop.

## Owns

`src/agentdesk/loop/`. It runs in the same process as the host app: `agentdesk()` calls `startLoop(ctx)` on boot, so the developer installs and runs nothing extra. It thinks with the developer's own LLM key.

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 3 to 6.

- Closes `episodes`: `requestIds`, `outcome`, `siteSuccess`, `steps`, `durationMs`, `priorFailureId`, `reflection`.
- Creates `capabilities` and sets every stage except `approved` / `blocked`.
- Writes `knowledge` (including `failure` lessons) and `proposed` rules.
- Reads `requests`, `rules`, `feedback`.

## Gives others

- **Episode close:** after `done` (`/agent/done`) or after 60 seconds with no agent call and no tapped request for the session (then `outcome: "abandoned"`). Join `requests` by `sessionId`, compute steps and duration, set outcome.
- **Success oracle:** sets `siteSuccess` from the tapped write requests (CONTRACT section 4). `goalSuccess` and `doneNote` are hypotheses to check against it, not evidence.
- **Reflector:** reads the agent's own `doneNote` first ("I wanted X and couldn't" is a free lesson), then checks it against the tapped requests. Classifies the failure (`unknown_site`, `unknown_steps`, `capability_failed`, `wrong_answer`, `blocked`) and learns: site facts into `knowledge`, a successful fallback request into an `observed` then `proposed` capability, a failed call into a fixed description or schema. Writes a plain `why` for the panel.
- **Learning from failures (CONTRACT section 4b), the core of the recursive claim:** link `priorFailureId`, diff the failed and successful request sequences into `reflection.diff`, and turn the diff into a capability fix, a new capability (from the whole write sequence), or a `failure` lesson. Propose a rule when the same write fails or is refused in 2+ episodes.
- **Verification:** moves a capability to `verified` only when an episode called it with `goalSuccess: true` and `siteSuccess: true`. Demotes it to `proposed` after 2 failed episodes in a row.
- **Metrics:** success rate, steps and seconds per visit number, and failures before the first success per intent, from `episodes`.
- **Raindrop:** one event per visit with tool spans and signals (success, abandon, policy denial, correction). See [RAINDROP.md](../RAINDROP.md). Free tier stops at 1,000 events per month, so do not send one event per HTTP request.

## Needs from others

- Door: real `requests` from the tap (inside the package). Until then, use `fixtures/episode-cart-fail.json`.
- Door: episodes with turns and `goalSuccess`. Until then, fixtures.
- For section 4b: `fixtures/episode-cart-prior-fail.json` (fails: `qty` sent as a string, 400) then `fixtures/episode-cart-fail.json` (succeeds). The diff must find "qty must be a number".

## Order

1. Fixture episode closes: `siteSuccess`, steps, duration and a classified `reflection`.
2. Fixture fallback request sequence becomes a `proposed` capability. **Hand off to Door.**
3. Failure diff: the prior-fail fixture plus the success fixture give `reflection.diff` and a schema fix or `failure` lesson.
4. A capability moves to `verified` (goalSuccess and siteSuccess), and is demoted after 2 failures.
5. Proposed rule from repeated failures, with evidence. **Hand off to the panel** (one-click approve).
6. Real episodes from Store and Door close and learn.
7. Metrics for the panel: learning curve and failures before the first success.
8. Raindrop basic signals. (Cut line: Experiments first.)
9. Stretch, only if time: the reflector's own playbook as a versioned document, kept only if the next episodes improve (the committee's item e).

## Run and test

- Run: _fill in_
- Test: _fill in_

## Status

Not started.
