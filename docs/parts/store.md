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

- Run: `npm run dev:local` (in-memory MongoDB, seeded, no Atlas needed) or `npm run seed && npm run dev` (Atlas Sandbox, `MONGODB_URI` in `.env`).
- Test: `npm test` (15 acceptance tests: catalog, cart, coupon, transactional checkout, session sharing, tap shape and redaction).
- Details: [src/store/README.md](../../src/store/README.md), [STORE_SPEC.md](../STORE_SPEC.md).

## Conventions the contract leaves open (proposed, tell Store if you disagree)

- `siteId` for the demo store: `demo-store` (same as `fixtures/`).
- Databases on the Atlas Sandbox cluster: `desk` for the contract collections (`src/contract/db.ts`, override with `MONGODB_DB_DESK`), `harbor` for the store's catalog, carts and orders.
- The Door marks capability replays with the request header `x-agentdesk-source: capability`. The tap sets `source` from it.
- The tap returns the `requestId` in the `x-agentdesk-request` response header, so the Door can link a capability call to its `requests` document.
- Add-to-cart returns `201` (matches `fixtures/episode-cart-fail.json`).
- During an agent visit the cart belongs to the AgentDesk session, so fallback clicks and capability calls share one cart.

## Status

- [x] 1. Demo store runs locally.
- [x] 2. Tap writes `requests` (contract shape, tested). **Ready for Loop**, once the Atlas URI is in `.env`.
- [ ] 3. Visitor agent.
- [ ] 4. Panel on fixtures.
- [ ] 5. Panel live.
- [ ] 6. Modelence deploy.
