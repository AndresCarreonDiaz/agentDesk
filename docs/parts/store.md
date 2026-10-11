# Part: Store

The world the desk lives in: the demo store, the tap, the visitor agents, the developer panel and the deploy.

## Owns

`src/store/`

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 2, 3 and 5.

- Writes `requests` (the tap), `rules`, `feedback`, and capability stage `approved` / `blocked` (the panel).
- Reads `episodes`, `capabilities`, `knowledge` for the panel (Atlas change streams for the live feed).

## Gives others

- **Tap middleware:** records every request to the host app. Reads the session from the `x-agentdesk-session` header, then the `agentdesk_session` cookie. Sets `source`.
- **Demo store:** product list, product page, cart (`POST /cart/items`), fake checkout.
- **Visitor agents:** scripted agents that call the Door, fall back to clicking the site with Playwright, and report `POST /agent/done {sessionId, goalSuccess}`. Same script for every visit (CONTRACT section 6).
- **Developer panel:** live feed, capabilities with approve/block, corrections, rules, learning curve. Read-only toward the desk except for the writes listed above. Keep it thin.

## Needs from others

- Door: `POST /agent` and the `x-agentdesk-session` header. Until it is live, visitor agents go straight to fallback.
- Loop: closed episodes and learning-curve numbers. Until then, the panel reads `fixtures/`.

## Order

1. Demo store runs locally.
2. Tap writes a `requests` document with `requestId`, `sessionId`, method, path, `bodyShape`, status. **Hand off to Loop.**
3. Visitor agent runs one visit end to end (Door call, fallback, `/agent/done`).
4. Panel shows episodes and capabilities from fixtures.
5. Panel goes live; blocking a capability makes the Door refuse it.
6. Deploy on Modelence; the public URL serves the store and records requests.

## Run and test

- Run: _fill in_
- Test: _fill in_

## Status

Not started.
