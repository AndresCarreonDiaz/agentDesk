# Contract

The one thing all three parts share. Every part codes against this file. If you need to change it, ask the team first, change it in its own commit, and add a line to the changelog at the bottom.

Parts: **Store** ([parts/store.md](parts/store.md)), **Door** ([parts/door.md](parts/door.md)), **Loop** ([parts/loop.md](parts/loop.md)).

## 1. Code layout

One TypeScript repo. Everything a developer installs lives in **one package, `src/agentdesk/`**: the tap, the door, the loop and the panel. The demo store is just a host that installs it with one line. Each part owns one folder. Shared types live in `src/agentdesk/contract/` and mirror this file.

```
src/
  agentdesk/         THE DROP-IN PACKAGE (what developers install)
    index.ts         agentdesk(): reads env, connects, bootstraps, mounts everything   (Door)
    contract/        types.ts (the documents below), db.ts (Atlas client + names)      (shared)
    door/            tap, discovery, POST /agent, /mcp, desk brain, intent match, rules (Door)
    loop/            episode close, reflector, capability stages, metrics, Raindrop   (Loop)
    panel/           developer panel, served at /agentdesk                             (Store)
  store/             demo store that installs agentdesk with one line; visitor agents (Store)
fixtures/            hand-written documents for testing a part before the others are live
```

A part imports another part only through `src/agentdesk/contract/` or through HTTP. No reaching into another part's folder. The one exception: each part's folder exports a single start function (for example `startLoop(ctx)`) that `agentdesk()` calls.

### Install: what a developer does

The whole point of the product. Installing must feel like a toggle.

```
npm i agentdesk
```

```
# .env  (MONGODB_URI is usually there already: the site runs on MongoDB)
MONGODB_URI=...          # the developer's own Atlas cluster (today: the hackathon sandbox)
GEMINI_API_KEY=...       # or ANTHROPIC_API_KEY / OPENAI_API_KEY: the desk thinks with the developer's own LLM key
VOYAGE_API_KEY=...       # optional: embeddings for intent match; without it, Gemini makes them
```

The minimum install is **two keys**: `MONGODB_URI` and `GEMINI_API_KEY`.

```ts
app.use(agentdesk())
```

On first start, `agentdesk()`:

1. Connects with `MONGODB_URI` and uses **its own database** `agentdesk` (override with `AGENTDESK_DB`). It never reads or writes the app's own collections.
2. Creates the collections below and the Atlas Vector Search indexes if they are missing.
3. Creates an admin token in `settings` and prints the panel link (`/agentdesk?token=...`) to the server log once.
4. Mounts the tap, discovery, `/agent`, `/mcp` and the panel, and starts the Loop in the same process.

### Thinking and embeddings: one helper each, shared by every part

- **LLM:** the first key found, in this order: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. Team default today: Gemini, model `gemini-3.8-flash` (override with `AGENTDESK_MODEL`). Every part calls the model only through `src/agentdesk/contract/llm.ts`.
- **Embeddings:** Voyage (`voyage-3.5`, 1024 dimensions) when `VOYAGE_API_KEY` is set, otherwise Gemini (`gemini-embedding-001`, 768 dimensions, normalised). The choice is **locked at first start** in `settings.embedding`, because vectors from two different models cannot be compared, and the vector indexes are built with those dimensions. Every part embeds only through `src/agentdesk/contract/embed.ts`, never by calling a provider directly.
- Door writes both helpers first; they live in `contract/` because Loop and the panel use them too.

All options are optional: `agentdesk({ db, siteId, panelPath })`. There is no AgentDesk account and no AgentDesk server: the desk's memory lives in the developer's own cluster, and its thinking runs on the developer's own LLM key.

**While building today:** everyone uses the sandbox `MONGODB_URI` with their own `AGENTDESK_DB` (for example `agentdesk_ricardo`) so nobody overwrites anyone else. The demo uses `agentdesk`.

## 2. IDs and the session join

- `sessionId`: one agent visit. The Door mints it on the agent's first call (`/agent` or `/mcp`) and returns it in the `x-agentdesk-session` response header.
- The visitor agent sends `x-agentdesk-session` on every later call, and sets the cookie `agentdesk_session` before it falls back to clicking the website. The tap reads the header first, then the cookie.
- `episodeId`: one per `sessionId`, created by the Door at the same moment. `episodeId` and `sessionId` map one to one.
- `requestId`: minted by the tap for every HTTP request it records.
- These three IDs are the only join keys. Format: `ses_`, `ep_`, `req_` prefix plus a random id.
- `siteId`: one install is one site. It comes from `agentdesk({ siteId })` or `AGENTDESK_SITE_ID`, and defaults to the database name. The second demo site uses its own database, so what one site learns never leaks into the other.

## 3. Collections

All documents carry `siteId` (which host platform) and `createdAt`.

### `requests` (written by the tap, part of Door, inside the package)

```ts
{
  requestId: string;
  sessionId: string | null;      // null = human traffic, not an agent visit
  episodeId: string | null;
  source: "fallback" | "capability" | "direct";
  // fallback   = agent clicking the human website
  // capability = the Door replaying a capability's mapped request
  // direct     = anything else
  method: string; path: string;
  query: Record<string, string>;
  bodyShape: Record<string, string>;   // field -> type, no values
  body: unknown;                        // redacted: no passwords, cards, tokens
  status: number;
  durationMs: number;
  timestamp: Date;
}
```

### `episodes` (created by Door, closed by Loop)

```ts
{
  episodeId: string; sessionId: string;
  agentFamily: string;                  // "dots" | "muse" | "claude" | "script:<name>" ...
  goal: string | null;                  // what the agent said it wanted
  intents: string[];                    // intent names matched by the Door
  turns: { role: "agent" | "desk"; text: string; capability?: string; at: Date }[];
  requestIds: string[];                 // filled by Loop at close, from `requests`
  outcome: "open" | "success" | "abandoned" | "error" | "blocked";
  goalSuccess: boolean | null;          // reported by the visitor agent, see section 5
  doneNote: string | null;              // the agent's own words at /agent/done ("I wanted X and couldn't")
                                        // a hypothesis, not evidence: Loop checks it against the tapped requests
  siteSuccess: boolean | null;          // the site's own evidence, set by Loop at close (section 4, "Success oracle")
  steps: number;                        // agent calls + fallback requests
  durationMs: number;
  priorFailureId: string | null;        // last failed episode with the same intent, linked by Loop at close
  reflection: {
    failure: "unknown_site" | "unknown_steps" | "capability_failed" | "wrong_answer" | "blocked" | null;
    why: string;                        // plain language, shown in the panel
    diff: string | null;                // what the success did that the prior failure did not (section 4b)
    learned: { kind: "knowledge" | "capability" | "rule"; id: string }[];
  } | null;
}
```

### `capabilities` (stages by Loop, approve/block by the panel, read by Door)

```ts
{
  capabilityId: string;
  name: string;                         // tool name, e.g. "add_to_cart"
  description: string;
  kind: "read" | "write";               // write = changes state or spends
  inputSchema: object;                  // JSON Schema
  mappedRequests: { method: string; path: string; bodyTemplate: unknown }[];
                                        // in order; most actions have one, a quote form may need 2-3
                                        // a later request may use a value from an earlier response: "{{steps[0].body.quoteId}}"
                                        // agent input: "{{sku}}" (what buildCapability writes) or "{{input.sku}}"; a whole-string
                                        // template keeps the input's type (qty stays a number)
  stage: "observed" | "proposed" | "verified" | "approved" | "blocked";
  sourceEpisodeId: string;
  sourceRequestId: string;
  verifiedByEpisodeId: string | null;
  stats: { calls: number; successes: number };
  examples: { input: unknown; requestId: string }[];
  embedding: number[];                  // from contract/embed.ts, for intent match
  updatedAt: Date;
}
```

### `knowledge` (written by Loop and by panel corrections)

```ts
{ knowledgeId: string; text: string; source: "site_read" | "episode" | "failure" | "developer";
  // failure = a lesson from a failed episode: "for <intent>, use <action>; do not <what failed>"
  sourceRef: string | null; intent: string | null; confidence: number; embedding: number[] }
```

### `intents` (written by Door)

```ts
{ name: string; examples: string[]; embedding: number[]; capabilityIds: string[] }
```

### `rules` (written by the panel, proposed by Loop, enforced by Door)

```ts
{ ruleId: string; text: string;       // "agents may not apply discount codes"
  compiled: { action: "block" | "require_review"; capabilities?: string[];
              match?: { method?: string; path?: string; bodyField?: string } };
  source: "developer" | "reflector";  // reflector = proposed from failures by Loop
  status: "proposed" | "active" | "rejected";
  evidence: string[];                 // episodeIds behind a reflector proposal
  enabled: boolean }                  // true only when status is "active"
```

Door enforces only `active` rules, and on **both paths**: the `do` tool and the tap. A fallback request that matches an active rule (same `match`) is refused by the tap with 403 and logged, so an agent cannot click around a guardrail.

### `feedback` (written by the panel)

```ts
{ feedbackId: string; type: "correction" | "approve" | "block";
  target: { collection: string; id: string }; text: string | null }
```

### `settings` (written by `agentdesk()` on first start)

```ts
{ _id: "settings"; siteId: string; adminTokenHash: string; installedAt: Date;
  embedding: { provider: "voyage" | "gemini"; model: string; dims: number } }   // locked at first start
```

## 4. Capability lifecycle

```
observed -> proposed -> verified -> approved
    ^                       |    \-> blocked
    +---- demoted ----------+
```

| Stage | Set by | Rule |
|---|---|---|
| `observed` | Loop | Seen in a successful fallback request. Not offered to agents. |
| `proposed` | Loop | Offered to agents with a "new" note. |
| `verified` | Loop | An episode called it with `goalSuccess: true` **and** `siteSuccess: true`. The agent's word alone does not count, and an HTTP 200 alone does not count. Set `verifiedByEpisodeId`. |
| demoted | Loop | A `verified` capability whose calls fail in 2 episodes in a row goes back to `proposed`, and the reflector repairs it (section 4b). |
| `approved` / `blocked` | Panel | The developer's decision always wins. |

What the Door offers to agents:

| kind | Offered at stages |
|---|---|
| `read` | `proposed`, `verified`, `approved` |
| `write` | `approved` only |

Never offered: `observed`, `blocked`, or anything an active rule blocks.

### Success oracle: the site's evidence, not the agent's word

The agent's `goalSuccess` and `doneNote` are hypotheses. At close, Loop sets `episode.siteSuccess` from the tapped requests of that session:

Writes are requests other than GET, HEAD and OPTIONS. Group them by method + path and take the **last attempt** of each group. An agent that gets a 400, fixes its request and gets a 201 has succeeded.

- `true`: at least one write, and the last attempt of every write group returned 2xx.
- `false`: the last attempt of some write group returned 4xx or 5xx (including a rule refusal, 403).
- `null`: read-only visit; nothing on the site to check. Reads never count, even a GET 500.

Optional, for a site with a stronger signal: `agentdesk({ success: (requests) => boolean })`. Never required: the install stays one line.

## 4b. Learning from failures (the recursive part)

The reflector runs on **every** closed episode, failed ones first. This is what makes the harness change its own tool access, context and guardrails, not only collect tools.

1. **Link:** at close, Loop sets `priorFailureId` to the last failed episode with the same intent.
2. **Diff:** when an episode succeeds and has a `priorFailureId`, the reflector compares the two request sequences and writes `reflection.diff` ("the success sent `qty` as a number; the failure sent a string", "the success called `POST /quote` before `POST /quote/:id/submit`"). The diff becomes one of:
   - a **capability fix**: new `inputSchema` or description, or an added step in `mappedRequests`;
   - a **new capability** from the success's request sequence;
   - a **knowledge** item with `source: "failure"`: "for <intent>, use <action>; do not <what failed>".
3. **Context from failures:** `about` and `ask` include the top `failure` lessons for the matched intent, so the next agent starts from what went wrong last time.
4. **Proposed guardrails:** when the same write fails or is refused in 2 or more episodes, or a `doneNote` names an action the site refused, the reflector writes a `rules` document with `source: "reflector"`, `status: "proposed"`, the compiled match, and the `evidence` episode ids. The panel shows it with one-click approve or reject. It is never enforced before approval.
5. **Multi-request actions:** a capability is built from the **sequence** of write requests in one successful episode, in order, not from the last request only.

Metric for the panel and Raindrop: **failures before the first success**, per intent.

### How agents see capabilities: fixed tools, capabilities as data

Agents always see the **same five tools**, on `/mcp` and on `POST /agent`. The tool list never changes. MCP clients cache the tool list and many ignore tool-list-changed, so a capability learned mid-visit would be invisible as a new tool. Learned capabilities come back as **data** from `list_actions` instead.

| Tool | What it does |
|---|---|
| `about` | What this site is and what it offers, from `knowledge`, plus the top `failure` lessons. Always ends with: "Call `list_actions` before `do`; actions are learned and change over time." An empty desk says "I don't know yet" (and that gap is what the Loop learns from). |
| `ask` | Answers a question from `knowledge`. Refuses to guess. |
| `list_actions` | The capabilities offered right now (table above): `name`, `description`, `kind`, `inputSchema`, and a "new" note for `proposed`. |
| `do` | `{ action, input }`: runs one offered capability by replaying its `mappedRequests` in order through the host app. Blocked, unapproved writes and rule matches are refused with the reason. |
| `done` | `{ goalSuccess, note? }`: the agent says how the visit ended, in its own words. Same as `POST /agent/done`. |

## 5. Who writes what

The Store part owns the panel code (inside the package) and the demo store, which writes nothing to these collections: it only installs `agentdesk()`.

| Collection | Door (incl. tap) | Loop | Panel |
|---|---|---|---|
| `requests` | writes (tap) | reads | reads |
| `episodes` | creates, appends turns, saves `goalSuccess` and `doneNote` | closes: `requestIds`, `outcome`, `siteSuccess`, `steps`, `durationMs`, `priorFailureId`, `reflection` | reads |
| `capabilities` | reads, increments `stats` | creates, sets other stages | sets `approved` / `blocked` only |
| `knowledge` | reads | writes | writes corrections |
| `intents` | writes | reads | reads |
| `rules` | reads, enforces `active` rules in `do` and in the tap | writes `proposed` rules only | writes developer rules; sets `active` / `rejected` |
| `feedback` | – | reads | writes |
| `settings` | writes on first start | – | reads (admin token) |

`goalSuccess`: the visitor agent reports it with the `done` tool or `POST /agent/done {sessionId, goalSuccess, note?}` (the Door saves it). The visitor agent never sets a capability stage.

**When an episode closes:** on `done`, or after **60 seconds** with no agent call and no tapped request for that `sessionId`. A visit closed by the timeout gets `outcome: "abandoned"` and `goalSuccess: null`.

## 6. Honest learning curve

- Every visit uses the same visitor script. Only the desk changes between visits.
- Closing check: a new goal, with the website fallback blocked. It must succeed with learned capabilities only.
- The curve plots success rate (`goalSuccess` and `siteSuccess` both true), `steps` and `durationMs` against visit number, plus failures before the first success per intent, from `episodes`.

## Changelog

- v1: first version.
- v2: one drop-in package (`src/agentdesk/`) holds tap, door, loop and panel; the tap moves from Store to Door. Install = `MONGODB_URI` + LLM key + `app.use(agentdesk())`, with the desk's own `agentdesk` database and a `settings` collection. Five fixed agent tools with capabilities as data (no dynamic MCP tools). `doneNote` on episodes, 60 second abandon timeout, `siteId` defined.
- v3: committee review of v2 (see [REVIEW.md](REVIEW.md)). Learning from failures (section 4b): `priorFailureId`, `reflection.diff`, `failure` knowledge, reflector-proposed rules (`rules.source`, `rules.status`, `evidence`). Success oracle `siteSuccess`; `verified` needs it. Demotion after 2 failed episodes. `mappedRequests[]` sequence for multi-request actions. Active rules are enforced in the tap too, so fallback clicks cannot bypass them. `about` tells agents to call `list_actions` before `do`.
- v4: Gemini accepted as the LLM (team default `gemini-2.5-flash`); `VOYAGE_API_KEY` optional with Gemini embeddings as fallback, provider locked in `settings.embedding`. Shared `contract/llm.ts` and `contract/embed.ts` are the only way to call a model or embed. Minimum install is two keys.
- v3.1: `siteSuccess` uses the last attempt per method + path, so a fixed retry counts as success (committee red-team of the Loop oracle). The deterministic Loop core is graded by the frozen oracle in `verify/` (see `verify/README.md`).
- v4.1: default model is `gemini-3.8-flash`; Google closed `gemini-2.5-flash` to new keys.
- v4.2: template syntax for agent input in `mappedRequests`: `"{{sku}}"` or `"{{input.sku}}"` (the Door accepts both; the Loop writes the bare form).
