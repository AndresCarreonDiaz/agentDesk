# verify/ : frozen Loop oracle

Checks the deterministic core of the Loop, `src/agentdesk/loop/core.ts`: `closeEpisode`, `buildCapability`,
`diffEpisodes`, `nextStage`, `proposeRules` (CONTRACT.md sections 3, 4, 4b). Pure functions only: no Atlas, no LLM.
It runs a golden table (`verify/loop/cases/*.json`) and, if present, a private holdout set outside the repo
(`$AGENTDESK_HOLDOUT`, default `~/.kliri/loops/agentdesk-loop/holdout`). Holdout failures print only `FAIL holdout:<name>`.

`verify/` is FROZEN. Workers must not edit it. Fix `core.ts`, never the oracle.

Run: `verify/oracle.sh <workdir>` (needs Node 26). It exits nonzero on any failure and ends with `oracle: <passed>/<total> passed`.
