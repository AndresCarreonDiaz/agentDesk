# Contract

The one thing all three parts share. Every part codes against this file. If you need to change it, ask the team first, change it in its own commit, and add a line to the changelog at the bottom.

Parts: **Store** ([parts/store.md](parts/store.md)), **Door** ([parts/door.md](parts/door.md)), **Loop** ([parts/loop.md](parts/loop.md)).

## 1. Code layout

One TypeScript app. Each part owns one folder. Shared types live in `src/contract/` and mirror this file.

```
src/
  contract/   types.ts (the documents below), db.ts (Atlas client + collection names)
  store/      demo store, tap middleware, visitor agents, developer panel
  door/       discovery, POST /agent, /mcp, desk brain, intent match, rule enforcement
  loop/       episodes, reflector, capability stages, metrics, Raindrop
fixtures/     hand-written documents for testing a part before the others are live
```

A part imports another part only through `src/contract/` or through HTTP. No reaching into another part's folder.

## 2. IDs and the session join

- `sessionId`: one agent visit. The Door mints it on the agent's first call (`/agent` or `/mcp`) and returns it in the `x-agentdesk-session` response header.
- The visitor agent sends `x-agentdesk-session` on every later call, and sets the cookie `agentdesk_session` before it falls back to clicking the website. The tap reads the header first, then the cookie.
- `episodeId`: one per `sessionId`, created by the Door at the same moment. `episodeId` and `sessionId` map one to one.
- `requestId`: minted by the tap for every HTTP request it records.
- These three IDs are the only join keys. Format: `ses_`, `ep_`, `req_` prefix plus a random id.

## 3. Collections

All documents carry `siteId` (which host platform) and `createdAt`.

### `requests` (written by Store's tap)

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
  steps: number;                        // agent calls + fallback requests
  durationMs: number;
  reflection: {
    failure: "unknown_site" | "unknown_steps" | "capability_failed" | "wrong_answer" | "blocked" | null;
    why: string;                        // plain language, shown in the panel
    learned: { kind: "knowledge" | "capability"; id: string }[];
  } | null;
}
```

### `capabilities` (stages by Loop, approve/block by Store's panel, read by Door)

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

### `rules` (written by Store's panel, enforced by Door)

```ts
{ ruleId: string; text: string;       // "agents may not apply discount codes"
  compiled: { action: "block" | "require_review"; capabilities?: string[]; match?: string };
  enabled: boolean }
```

### `feedback` (written by Store's panel)

```ts
{ feedbackId: string; type: "correction" | "approve" | "block";
  target: { collection: string; id: string }; text: string | null }
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
| `approved` / `blocked` | Store's panel | The developer's decision always wins. |

What the Door offers to agents:

| kind | Offered at stages |
|---|---|
| `read` | `proposed`, `verified`, `approved` |
| `write` | `approved` only |

Never offered: `observed`, `blocked`, or anything an enabled rule blocks.

## 5. Who writes what

| Collection | Store | Door | Loop |
|---|---|---|---|
| `requests` | writes (tap) | reads | reads |
| `episodes` | reads | creates, appends turns | closes: `requestIds`, `outcome`, `steps`, `durationMs`, `reflection` |
| `capabilities` | sets `approved` / `blocked` only | reads, increments `stats` | creates, sets other stages |
| `knowledge` | writes corrections | reads | writes |
| `intents` | reads | writes | reads |
| `rules` | writes | reads, enforces | reads |
| `feedback` | writes | – | reads |

`goalSuccess`: the visitor agent reports it with `POST /agent/done {sessionId, goalSuccess}` (the Door saves it). The visitor agent never sets a capability stage.

## 6. Honest learning curve

- Every visit uses the same visitor script. Only the desk changes between visits.
- Closing check: a new goal, with the website fallback blocked. It must succeed with learned capabilities only.
- The curve plots `goalSuccess` rate, `steps` and `durationMs` against visit number, from `episodes`.

## Changelog

- v1: first version.
