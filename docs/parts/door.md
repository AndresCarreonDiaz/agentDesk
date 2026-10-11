# Part: Door

How agents find and talk to the desk: discovery, `POST /agent`, `/mcp`, the desk brain, intent matching and rule enforcement.

## Owns

`src/door/`

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 2 to 5.

- Creates `episodes` (with `sessionId`) and appends turns. Saves `goalSuccess` from `/agent/done`.
- Writes `intents`. Increments capability `stats`.
- Reads `capabilities`, `knowledge`, `rules`.

## Gives others

- `/.well-known/agentdesk`, `llms.txt` entry, `<link>` tag snippet.
- `POST /agent {sessionId?, message}` returns `{sessionId, reply, capabilityCalls?}` and the `x-agentdesk-session` header.
- `POST /agent/done {sessionId, goalSuccess}`.
- `/mcp`: tool list built from capabilities offered under CONTRACT section 4; sends tool-list-changed when it grows.
- Capability call: replays `mappedRequest` through the host app with `source: "capability"` and the session header, so the tap records it.
- Rule enforcement: a blocked capability cannot be called, even if the model asks for it. The refusal says which rule blocked it.

## Needs from others

- Loop: capabilities in stage `proposed` or later. Until then, use `fixtures/capability-add-to-cart.json`.
- Store: the tap, so capability calls are recorded.

## Order

1. Discovery files and `POST /agent` answer from `knowledge` (empty desk says "I don't know yet").
2. Session and episode created on first call; `/agent/done` works. **Hand off to Store's visitor agents.**
3. Voyage intent match finds the fixture capability from a free-text request.
4. `/agent` calls a capability and returns its result. Rules block a capability.
5. `/mcp` serves the same tools. (Cut line: keep `/agent` only if late.)

## Run and test

- Run: _fill in_
- Test: _fill in_

## Status

Not started.
