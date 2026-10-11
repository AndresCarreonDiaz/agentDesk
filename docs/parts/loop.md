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

- Run: nothing to start. `agentdesk()` calls `startLoop(ctx)` on boot, and the Loop sweeps every 3 seconds. An open episode closes when the agent called `done`, or after 60 seconds with no turn and no tapped request (then `outcome: "abandoned"`, `goalSuccess: null`).
- Use from code (`src/agentdesk/loop/index.ts`):
  - `processEpisode(ctx, episodeId)`: reflects on one episode; safe to run twice. Returns `{ closed, siteSuccess, capabilityIds, knowledgeIds, ruleIds, signals, raindrop }`.
  - `sweepOnce(ctx)`: closes every open episode that is done or idle.
  - `loopMetrics(ctx)`: `{ visits: [{ n, episodeId, success, steps, seconds }], failuresBeforeFirstSuccess: { [intent]: n } }`.
- Raindrop: set `RAINDROP_WRITE_KEY` and each processed episode sends one `agent_visit` event (5 second timeout, never throws). Without the key it is `skipped`.
- Test, deterministic core (no Atlas, no LLM): `verify/oracle.sh .` must print `oracle: 86/86 passed`; `npx tsx scripts/loop-demo.ts` shows the core on the fixtures.
- Test, types: `npx tsc --noEmit`.
- Test, wired Loop: set `AGENTDESK_DB=agentdesk_<yourname>` (and `AGENTDESK_SITE_ID=demo-store` for the fixtures), build a context with `createContext()` from `contract/context.ts`, insert the two fixture episodes and their requests (`fixtures/episode-cart-prior-fail.json`, then `fixtures/episode-cart-fail.json`), call `processEpisode` on each, and read the collections. Expect: the failed episode closes with `siteSuccess: false`; the second gets `priorFailureId`, `reflection.diff` "POST /cart/items: qty was string, success sent number", one `proposed` `add_to_cart` capability and one `failure` lesson; running it again changes nothing. Clean up with `deleteMany` (the sandbox user cannot drop databases).

## Status

Live: the Loop is wired to real data (CONTRACT sections 3 to 6).

- Closes episodes: `requestIds`, `siteSuccess`, `steps`, `durationMs`, `priorFailureId`, `outcome` (Door's `blocked` is kept), and a `reflection` with the failure kind, a plain `why`, the `diff` and what was `learned`.
- A successful fallback write sequence becomes one capability per method + path sequence: LLM name and description when the model works, a deterministic name (for example `add_to_cart`) when it does not; embedded when the embedder works; staged `observed` then `proposed`.
- Capabilities an episode called get `stats` updated and move to `verified` (goal and site both true) or back to `proposed` (2 failed episodes in a row). `approved` and `blocked` never change.
- A failure fixed by a later success writes a `failure` lesson (deduped by episode and by text).
- Repeated failing writes become `proposed` `require_review` rules, once per route.
- Raindrop: one event per processed episode (Order step 8 basics). Experiments are not built.
- Metrics: `loopMetrics` gives the learning curve and failures before the first success (Order step 7).
- Site reading: when a visit ends with `unknown_site` (or the agent says the desk could not tell what the site offers) and the site has no `site_read` knowledge, `readSite` fetches `/`, up to 6 same-origin links, `/llms.txt` and `/sitemap.xml` (GET only, `AGENTDESK_SITE_URL` or `localhost:$PORT`), and writes 3 to 10 `site_read` facts once per site.
- Playbook (Order step 9): the `playbooks` collection holds how the reflector teaches. When an agent was shown a field-style failure lesson and repeated that mistake on the route, the Loop opens a trial version (`lessonStyle: "example"`, a full working body) and the next visit that writes to that route keeps it (every example field sent, 2xx) or reverts it. `getPlaybook(ctx)` reads it; `processEpisode` returns `signals` (`action_learned`, `action_verified`, `guardrail_proposed`, `lesson_style_changed`, `lesson_style_kept`, `lesson_style_reverted`), also sent to Raindrop linked to the visit event; `loopMetrics` counts an intent-less visit under its first write route "METHOD /path".
- Not built: capability repair from the diff (`inputSchema` or `mappedRequests` edits), the optional `agentdesk({ success })` oracle.
- Known overlap: Door already counts `stats.calls` when `do` runs a capability; the Loop adds one call per processed episode on top, with `successes` judged by `siteSuccess`.

**Explorer (`explore.ts`, built by Door with Ricardo):** after a visit the desk failed (`unknown_site` / `unknown_steps`, or a desk "I don't know yet" turn), the Loop reads the host's own pages (`/llms.txt`, home, sitemap, one page per kind) and learns facts (`knowledge`, source `site_read`) and actions from HTML forms (`capabilities` at `proposed`, `sourceRequestId: "explore:<page>"`, bare `{{field}}` templates, named with `nameCapability`). At most once every 2 minutes per site; the tap does not record these reads. Hook: one line after `classify()` in `process.ts`.
