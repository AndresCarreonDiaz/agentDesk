# Part: Store

The world the desk lives in: the demo store, the visitor agents, the developer panel and the deploy.

## Owns

`src/store/` (demo store and visitor agents) and `src/agentdesk/panel/` (the panel ships inside the package).

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 2, 3 and 5.

- The demo store writes **nothing** to the AgentDesk collections. It only installs `agentdesk()` with one line. That line is the demo.
- The panel writes developer `rules`, sets reflector-proposed rules to `active` or `rejected`, and writes `feedback`, knowledge corrections, and capability stage `approved` / `blocked`.
- The panel reads `episodes`, `capabilities`, `knowledge` (Atlas change streams for the live feed) and `settings` (admin token).

## Gives others

- **Demo store:** product list, product page, cart (`POST /cart/items`), fake checkout. Pages call a real JSON API underneath (the API is what the Loop learns from). **The cart is keyed by the `agentdesk_session` cookie**, so when the Door runs `add_to_cart` for an agent, it lands in that agent's cart.
- **The install line in the store's server:** `app.use(agentdesk())`, plus `MONGODB_URI` and `GEMINI_API_KEY` in `.env` (`VOYAGE_API_KEY` optional). Nothing else.
- **Visitor agents:** scripted agents that call the Door, fall back to clicking the site with Playwright (with the `agentdesk_session` cookie set), and finish with `done {goalSuccess, note}`. Same script for every visit (CONTRACT section 6).
- **Developer panel** at `/agentdesk`: live feed, capabilities with approve/block, corrections, rules, **proposed rules from the reflector with their evidence and one-click approve/reject**, each episode's `reflection.diff` (what the success did that the failure did not), and the learning curve with failures before the first success. Feedback must be one click: approve, block, or "wrong, here is the right answer". Keep it thin: the desk is the product, not the panel.

## Needs from others

- Door: `agentdesk()` and `POST /agent` with the `x-agentdesk-session` header. Until it is live, visitor agents go straight to fallback.
- Loop: closed episodes and learning-curve numbers. Until then, the panel reads `fixtures/`.

## Order

1. Demo store runs locally, cart keyed by session cookie.
2. Install line added; requests show up in Atlas (the tap is the Door's, inside the package).
3. Visitor agent runs one visit end to end (Door call, fallback, `done`).
4. Panel shows episodes and capabilities from fixtures.
5. Panel goes live; blocking a capability makes the Door refuse it.
   Proposed rules from the reflector show with evidence; one click makes them `active`, and the next agent is refused (by `do` and by the tap).
6. Deploy on Modelence; the public URL serves the store with AgentDesk inside.

## Run and test

- Run: `npm run dev:local` (in-memory MongoDB, seeded, no Atlas needed) or `npm run seed && npm run dev` (Atlas Sandbox, `MONGODB_URI` in `.env`). `AGENTDESK=off` runs the store without the package.
- Test: `npm test` (store: catalog, cart, coupon, transactional and idempotent checkout, shared agent cart, page script; tap: contract shape and redaction).
- Details: [src/store/README.md](../../src/store/README.md), [STORE_SPEC.md](../STORE_SPEC.md).

## Notes for Door and Loop

- Cart is keyed by the AgentDesk session (`x-agentdesk-session` header, then `agentdesk_session` cookie). Humans get the store's own `harbor_sid`.
- Pages send JSON to the API (`POST /cart/items {"sku":"MUG-BLUE","qty":2}` → `201`), matching `fixtures/episode-cart-fail.json`.
- `POST /api/checkout` accepts `Idempotency-Key`. A repeat checkout returns `409 already_ordered {orderId}`, not `empty_cart`, so `do` retries never buy twice.
- Store code for the Door: `src/agentdesk/door/tap.ts` is a tested tap (contract `requests` shape, redaction, `x-agentdesk-source: capability` for replays, `requestId` echoed in `x-agentdesk-request`). Use it or replace it.

## Status

- [x] 1. Demo store runs locally, cart keyed by session cookie.
- [ ] 2. Install line: wired in `src/store/index.ts`, waiting for the Door's `agentdesk()`.
- [ ] 3. Visitor agent.
- [ ] 4. Panel on fixtures.
- [ ] 5. Panel live.
- [ ] 6. Modelence deploy.
