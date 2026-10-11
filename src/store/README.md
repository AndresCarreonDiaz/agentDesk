# Harbor Goods (Store part)

The demo store AgentDesk learns from, plus the tap that records its traffic. Built during the hackathon. Spec: [STORE_SPEC.md](../../docs/STORE_SPEC.md). Part doc: [parts/store.md](../../docs/parts/store.md).

Store data lives in database `harbor` and desk memory in `desk`, both on the **hackathon MongoDB Atlas Sandbox** cluster.

Run from the repo root:

```bash
npm install
npm run dev:local      # no Atlas needed: in-memory MongoDB, seeded, http://localhost:3000 (data lost on exit)
npm test               # 15 acceptance tests, in-memory MongoDB

cp .env.example .env   # paste the Atlas Sandbox URI into MONGODB_URI
npm run seed           # 6 products, 8 inventory docs, WELCOME10
npm run dev            # against Atlas
```

`dev:local` is only for working offline. Run the demo against Atlas.

The demo path: open `/products/harbor-mug`, add the blue mug, apply `WELCOME10` in the cart, then check out to Austin.

An agent visit, as the Door or a visitor agent would make it:

```bash
curl -s -X POST localhost:3000/cart/items -H 'content-type: application/json' \
  -H 'x-agentdesk-session: ses_demo0001' -d '{"sku":"MUG-BLUE","qty":1}'
```

The tap then writes a `requests` document with `sessionId: "ses_demo0001"`, `source: "fallback"`, `bodyShape: { sku: "string", qty: "number" }` and status 201. To mark a Door replay, add `x-agentdesk-source: capability`.

## For the Door

Mount your routes with `createApp({ ..., mountDesk: (app) => app.use(doorRouter) })` in `src/store/app.ts`. They run after the session and tap, before the store's routes. `/agent`, `/mcp` and `/.well-known/*` are yours, and the tap skips them.
