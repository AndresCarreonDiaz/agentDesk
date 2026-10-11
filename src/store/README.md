# Harbor Goods (Store part)

The demo store AgentDesk is dropped into. Built during the hackathon. Spec: [STORE_SPEC.md](../../docs/STORE_SPEC.md). Part doc: [parts/store.md](../../docs/parts/store.md).

The store's own data lives in database `harbor` on the **hackathon MongoDB Atlas Sandbox** cluster. AgentDesk uses its own `agentdesk` database on the same cluster; the store never writes to it.

Run from the repo root:

```bash
npm install
npm run dev:local      # no Atlas needed: in-memory MongoDB, seeded, http://localhost:3000 (data lost on exit)
npm test               # store + tap tests, in-memory MongoDB

cp .env.example .env   # paste the Atlas Sandbox URI into MONGODB_URI
npm run seed           # 6 products, 8 inventory docs, WELCOME10
npm run dev            # against Atlas
```

`dev:local` is only for working offline. Run the demo against Atlas.

The demo path: open `/products/harbor-mug`, add the blue mug, apply `WELCOME10` in the cart, then check out to Austin. The pages call the JSON API, so a browser sends exactly what an agent would:

```bash
curl -s -X POST localhost:3000/cart/items -H 'content-type: application/json' \
  -H 'x-agentdesk-session: ses_demo0001' -d '{"sku":"MUG-BLUE","qty":1}'
```

During an agent visit the cart belongs to the AgentDesk session (header or `agentdesk_session` cookie), so the visitor's fallback clicks and the Door's `do` calls fill the same cart.

## The install line

`src/store/index.ts` does `app.use(agentdesk())` as soon as the Door's `src/agentdesk/index.ts` exists. `AGENTDESK=off npm run dev` runs the bare store for the "before" shot. Until the Door lands, the store runs on its own and says so in the log.
