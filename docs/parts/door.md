# Part: Door

The drop-in itself: the `agentdesk()` install, the tap, discovery, the five agent tools on `POST /agent` and `/mcp`, the desk brain, intent matching and rule enforcement.

## Owns

`src/agentdesk/index.ts` and `src/agentdesk/door/`

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 1 to 5.

- Writes `requests` (the tap) and `settings` (first start).
- Creates `episodes` (with `sessionId`) and appends turns. Saves `goalSuccess` and `doneNote` from `done`.
- Writes `intents`. Increments capability `stats`.
- Reads `capabilities`, `knowledge` (including `failure` lessons for `about` and `ask`), `rules`.

## Gives others

- **The install:** `app.use(agentdesk())`. Reads `MONGODB_URI`, the LLM key (Gemini by default) and the optional `VOYAGE_API_KEY` from env, uses its own `agentdesk` database, locks the embedding provider in `settings`, creates collections and vector indexes, prints the panel link once, mounts everything, and starts the Loop and the panel.
- **The tap:** records every request to the host app. Reads the session from the `x-agentdesk-session` header, then the `agentdesk_session` cookie. Sets `source`. Redacts passwords, cards and tokens.
- **Discovery:** `/.well-known/agentdesk`, an `llms.txt` entry, and a `<link>` tag snippet for the host's HTML.
- **`about` always ends with** "Call `list_actions` before `do`; actions are learned and change over time." Real agents may not know to call it.
- **Five fixed tools** (CONTRACT section 4): `about`, `ask`, `list_actions`, `do`, `done`. Same tools on `/mcp` and on `POST /agent {sessionId?, message}` (which returns `{sessionId, reply, capabilityCalls?}` and the `x-agentdesk-session` header). The tool list never changes; learned capabilities are data from `list_actions`.
- **`do`:** replays the capability's `mappedRequests` in order through the host app (a later step can use a value from an earlier response) with `source: "capability"` and the agent's session, so the tap records it and the cart lands in that agent's cart.
- **Rule enforcement:** a blocked capability, an unapproved write or an `active` rule match is refused, even if the model asks for it. The refusal says which rule or stage blocked it. `proposed` rules are not enforced.
- **Guardrails in the tap too:** a fallback request from an agent session that matches an `active` rule's `match` gets 403 with the rule text and is logged as a denial. Without this, an agent can click around the guardrail on the website.
- **Teaching errors** (Bubblio lesson): `GET /mcp` explains how to connect; a malformed call returns an example of a correct one.

## Needs from others

- Loop: capabilities in stage `proposed` or later. Until then, use `fixtures/capability-add-to-cart.json`.
- Store: the demo store running, so the install line has a host.

## Order

1. Shared helpers `contract/llm.ts` and `contract/embed.ts` (Loop needs them early). `agentdesk()` boots: env, own database, collections, `settings`, panel link printed. Tap writes `requests`. **Hand off to Loop** (real requests).
2. Discovery and `about` / `ask` from `knowledge` (empty desk says "I don't know yet"). Session and episode created on first call; `done` works. **Hand off to Store's visitor agents.**
3. Voyage intent match finds the fixture capability from a free-text request; `list_actions` returns it.
4. `do` runs a capability (all its `mappedRequests`) and returns its result. Rules and stages block it, in `do` and in the tap.
5. `/mcp` serves the same five tools. (Cut line: keep `POST /agent` only if late.)

## Run and test

- Install: `npm install`, then copy `.env.example` to `.env` (set your own `AGENTDESK_DB`).
- Test (no database): `npm test`
- Check the model and embeddings with your keys: `npm run smoke:llm`
- Check the tap end to end against Atlas: `npm run smoke:door`
- Rehearse a real visit against a running store: `BASE_URL=http://localhost:3000 npm run smoke:visit` (HTTP door, website fallback, `done`, then MCP, then what landed in Atlas).
- Use it in a host: `import { agentdesk } from "./src/agentdesk/index.js"` then `app.use(agentdesk())` **before** your own routes and body parser.

## Status

- **Order step 1 built:** `agentdesk()` boot (turns itself off without keys, never breaks the host), shared `contract/` (types, config, db bootstrap with collections, indexes and vector indexes, settings and admin token, `llm.ts`, `embed.ts`, `search.ts` with in-process fallback), the tap (records host traffic, session join, redaction, active rules refused with 403). 14 tests pass; Gemini text, JSON and embeddings checked live.
- **Order steps 2 and 4 built (PR door/tools):** `POST /agent` with the five tools (plain-language `message` routed by the desk brain, or `{ tool, input }`, or `POST /agent/<tool>`), `POST /agent/done`, episodes created on the first call with the `x-agentdesk-session` header, turns appended, discovery at `/.well-known/agentdesk`, teaching 405 on `GET /agent`. `do` replays `mappedRequests` in order with `{{input.x}}` and `{{steps[0].body.y}}` templates, refuses unapproved writes, blocked capabilities and active rules before sending anything, and teaches missing input with an example. 21 tests pass.
- **Checked live on the Atlas sandbox with Harbor Goods (2:13 PM):** `npm run smoke:visit` against `npm run start`. Empty desk says "I don't know yet" on both doors; the brain routes "add a blue mug" to `list_actions` and saves it as the goal; the fallback clicks (`GET /api/products?q=mug`, `POST /api/cart/items` 201) are tapped and joined to the same episode with `bodyShape {sku: string, qty: number}`; `done` saves `goalSuccess` and `doneNote`; MCP records the client name as `agentFamily`. Episodes stay `open` until the Loop closes them.
- **Order step 5 built:** `/mcp` serves the same five tools over MCP (Streamable HTTP, JSON responses, stateless). On `initialize` it hands out an AgentDesk `ses_` id as `Mcp-Session-Id`, so MCP calls, the episode and the tap share one session, and restarts lose nothing. The client's own name (for example `claude-code`) becomes `agentFamily`. Connect any MCP client to `<site>/mcp`. 23 tests pass, including a real MCP client.
- **Autopilot (CONTRACT v5):** `list_actions` and `do` offer learned writes at `proposed` / `verified` when `settings.autopilot` is on, except money (`isSensitive`); every unreviewed run is written to `audit`. 45 tests pass.
- **Paused (CONTRACT v5.1):** 2 failed `do` runs in a row pause a capability: `list_actions` and `about` stop offering it, `do` refuses with `paused_failing`, and the pause is audited once. A success resets the streak; a Loop update or the panel's approve brings it back. 58 tests pass.
- Next: step 3 (intent match writes `intents`).
