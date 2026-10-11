# Review of contract v2 (11 Oct, about 1 PM)

We ran the design past a panel of five AI reviewers (Morfa Companions: Judge & Trim, The Revolutionary, Ideator, The Architect, Bug Hunter), with the full hackathon rules and judging criteria. Contract v3 is the result. Treat the scores as a ranking, not as odds.

## Scores (average of 5, out of 10)

| Version | Impact | Creativity | Difficulty | Demo | Statement 1 | Raindrop RSI |
|---|---|---|---|---|---|---|
| Original idea | 6.6 | 7.4 | 8.4 | 8.6 | 7.2 | 6.6 |
| Contract v2 | 7.0 | 7.2 | 8.3 | 8.8 | 6.6 | 6.4 |
| v2 + learning from failures (target, now v3) | 7.5 | 8.3 | 9.0 | 9.2 | 9.1 | 8.9 |

"v2 is a better product and a worse thesis." (Judge & Trim)

## What v2 got right

- Five fixed tools, capabilities as data: the best decision in v2 (all five).
- Toggle install and the desk's own database: raise Impact and Demo.

## What held it back

The reflector learned only from successes, and the developer wrote every rule. Judges will ask "where does the harness improve itself?" Statement 1 asks for a harness that changes its own rules, context, guardrails and tool access.

## What v3 adds (CONTRACT section 4b), in build order

1. **Learning from failures** (all five, first): diff a failed episode against the later success on the same intent; the diff becomes a capability fix, a new capability, or a `failure` lesson. New metric: failures before the first success.
2. **Reflector-proposed guardrails** (three of five): repeated failures or refusals become a proposed rule with evidence; the developer approves in one click.
3. **Context from failures**: `about` and `ask` include the top lesson from the last failure.
4. **Self-improving reflector playbook**: cut unless time remains (four of five).

## Risks found in v2, and the v3 fix

| Risk (who found it) | v3 fix |
|---|---|
| `verified` trusted the agent's own `goalSuccess` (Bug Hunter) | `siteSuccess` from tapped writes; `verified` needs both |
| `doneNote` is the agent's opinion, maybe invented (Revolutionary) | Treated as a hypothesis, checked against tapped requests |
| Agents can click around a rule on the website (Ideator) | Active rules enforced in the tap too (403) |
| Some actions need several requests, e.g. a quote form (Judge & Trim) | `mappedRequests[]` sequence |
| Real agents may not call `list_actions` (Architect) | `about` tells them to |
