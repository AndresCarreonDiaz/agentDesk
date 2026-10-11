# Part: Store

The world the desk lives in: the demo store, the visitor agents, the developer panel and the deploy.

## Owns

`src/store/` (demo store and visitor agents) and `src/agentdesk/panel/` (the panel ships inside the package).

## Reads / writes

See [CONTRACT.md](../CONTRACT.md) sections 2, 3 and 5.

- The demo store writes **nothing** to the AgentDesk collections. It only installs `agentdesk()` with one line. That line is the demo.
- The panel writes `rules`, `feedback`, knowledge corrections, and capability stage `approved` / `blocked`.
- The panel reads `episodes`, `capabilities`, `knowledge` (Atlas change streams for the live feed) and `settings` (admin token).

## Gives others

- **Demo store:** product list, product page, cart (`POST /cart/items`), fake checkout. Pages call a real JSON API underneath (the API is what the Loop learns from). **The cart is keyed by the `agentdesk_session` cookie**, so when the Door runs `add_to_cart` for an agent, it lands in that agent's cart.
- **The install line in the store's server:** `app.use(agentdesk())`, plus `MONGODB_URI`, the LLM key and `VOYAGE_API_KEY` in `.env`. Nothing else.
- **Visitor agents:** scripted agents that call the Door, fall back to clicking the site with Playwright (with the `agentdesk_session` cookie set), and finish with `done {goalSuccess, note}`. Same script for every visit (CONTRACT section 6).
- **Developer panel** at `/agentdesk`: live feed, capabilities with approve/block, corrections, rules, learning curve. Feedback must be one click: approve, block, or "wrong, here is the right answer". Keep it thin: the desk is the product, not the panel.

## Needs from others

- Door: `agentdesk()` and `POST /agent` with the `x-agentdesk-session` header. Until it is live, visitor agents go straight to fallback.
- Loop: closed episodes and learning-curve numbers. Until then, the panel reads `fixtures/`.

## Order

1. Demo store runs locally, cart keyed by session cookie.
2. Install line added; requests show up in Atlas (the tap is the Door's, inside the package).
3. Visitor agent runs one visit end to end (Door call, fallback, `done`).
4. Panel shows episodes and capabilities from fixtures.
5. Panel goes live; blocking a capability makes the Door refuse it.
6. Deploy on Modelence; the public URL serves the store with AgentDesk inside.

## Run and test

- Run: _fill in_
- Test: _fill in_

## Status

Not started.
