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
ANTHROPIC_API_KEY=...    # or OPENAI_API_KEY: the desk thinks with the developer's own LLM key
VOYAGE_API_KEY=...       # embeddings for intent match (today; the goal is zero extra keys)
```

```ts
app.use(agentdesk())
```

On first start, `agentdesk()`:

1. Connects with `MONGODB_URI` and uses **its own database** `agentdesk` (override with `AGENTDESK_DB`). It never reads or writes the app's own collections.
2. Creates the collections below and the Atlas Vector Search indexes if they are missing.
3. Creates an admin token in `settings` and prints the panel link (`/agentdesk?token=...`) to the server log once.
4. Mounts the tap, discovery, `/agent`, `/mcp` and the panel, and starts the Loop in the same process.

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
  steps: number;                        // agent calls + fallback requests
  durationMs: number;
  reflection: {
    failure: "unknown_site" | "unknown_steps" | "capability_failed" | "wrong_answer" | "blocked" | null;
    why: string;                        // plain language, shown in the panel
    learned: { kind: "knowledge" | "capability"; id: string }[];
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
  mappedRequest: { method: string; path: string; bodyTemplate: unknown };
  stage: "observed" | "proposed" | "verified" | "approved" | "blocked";
  sourceEpisodeId: string;
  sourceRequestId: string;
  verifiedByEpisodeId: string | null;
  stats: { calls: number; successes: number };
  examples: { input: unknown; requestId: string }[];
  embedding: number[];                  // Voyage, for intent match
  updatedAt: Date;
}
```

### `knowledge` (written by Loop and by panel corrections)

```ts
{ knowledgeId: string; text: string; source: "site_read" | "episode" | "developer";
  sourceRef: string | null; confidence: number; embedding: number[] }
```

### `intents` (written by Door)

```ts
{ name: string; examples: string[]; embedding: number[]; capabilityIds: string[] }
```

### `rules` (written by the panel, enforced by Door)

```ts
{ ruleId: string; text: string;       // "agents may not apply discount codes"
  compiled: { action: "block" | "require_review"; capabilities?: string[]; match?: string };
  enabled: boolean }
```

### `feedback` (written by the panel)

```ts
{ feedbackId: string; type: "correction" | "approve" | "block";
  target: { collection: string; id: string }; text: string | null }
```

### `settings` (written by `agentdesk()` on first start)

```ts
{ _id: "settings"; siteId: string; adminTokenHash: string; installedAt: Date }
```

## 4. Capability lifecycle

```
observed -> proposed -> verified -> approved
                                 \-> blocked
```

| Stage | Set by | Rule |
|---|---|---|
| `observed` | Loop | Seen in a successful fallback request. Not offered to agents. |
| `proposed` | Loop | Offered to agents with a "new" note. |
| `verified` | Loop | An episode with `goalSuccess: true` called it. An HTTP 200 alone does not count. Set `verifiedByEpisodeId`. |
| `approved` / `blocked` | Panel | The developer's decision always wins. |

What the Door offers to agents:

| kind | Offered at stages |
|---|---|
| `read` | `proposed`, `verified`, `approved` |
| `write` | `approved` only |

Never offered: `observed`, `blocked`, or anything an enabled rule blocks.

### How agents see capabilities: fixed tools, capabilities as data

Agents always see the **same five tools**, on `/mcp` and on `POST /agent`. The tool list never changes. MCP clients cache the tool list and many ignore tool-list-changed, so a capability learned mid-visit would be invisible as a new tool. Learned capabilities come back as **data** from `list_actions` instead.

| Tool | What it does |
|---|---|
| `about` | What this site is and what it offers, from `knowledge`. An empty desk says "I don't know yet" (and that gap is what the Loop learns from). |
| `ask` | Answers a question from `knowledge`. Refuses to guess. |
| `list_actions` | The capabilities offered right now (table above): `name`, `description`, `kind`, `inputSchema`, and a "new" note for `proposed`. |
| `do` | `{ action, input }`: runs one offered capability by replaying its `mappedRequest` through the host app. Blocked, unapproved writes and rule matches are refused with the reason. |
| `done` | `{ goalSuccess, note? }`: the agent says how the visit ended, in its own words. Same as `POST /agent/done`. |

## 5. Who writes what

The Store part owns the panel code (inside the package) and the demo store, which writes nothing to these collections: it only installs `agentdesk()`.

| Collection | Door (incl. tap) | Loop | Panel |
|---|---|---|---|
| `requests` | writes (tap) | reads | reads |
| `episodes` | creates, appends turns, saves `goalSuccess` and `doneNote` | closes: `requestIds`, `outcome`, `steps`, `durationMs`, `reflection` | reads |
| `capabilities` | reads, increments `stats` | creates, sets other stages | sets `approved` / `blocked` only |
| `knowledge` | reads | writes | writes corrections |
| `intents` | writes | reads | reads |
| `rules` | reads, enforces | reads | writes |
| `feedback` | – | reads | writes |
| `settings` | writes on first start | – | reads (admin token) |

`goalSuccess`: the visitor agent reports it with the `done` tool or `POST /agent/done {sessionId, goalSuccess, note?}` (the Door saves it). The visitor agent never sets a capability stage.

**When an episode closes:** on `done`, or after **60 seconds** with no agent call and no tapped request for that `sessionId`. A visit closed by the timeout gets `outcome: "abandoned"` and `goalSuccess: null`.

## 6. Honest learning curve

- Every visit uses the same visitor script. Only the desk changes between visits.
- Closing check: a new goal, with the website fallback blocked. It must succeed with learned capabilities only.
- The curve plots `goalSuccess` rate, `steps` and `durationMs` against visit number, from `episodes`.

## Changelog

- v1: first version.
- v2: one drop-in package (`src/agentdesk/`) holds tap, door, loop and panel; the tap moves from Store to Door. Install = `MONGODB_URI` + LLM key + `app.use(agentdesk())`, with the desk's own `agentdesk` database and a `settings` collection. Five fixed agent tools with capabilities as data (no dynamic MCP tools). `doneNote` on episodes, 60 second abandon timeout, `siteId` defined.
