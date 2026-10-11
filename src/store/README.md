# Harbor Goods

The demo store AgentDesk learns from. Built during the hackathon, following [STORE_PRD.md](../../docs/STORE_PRD.md) and [STORE_SPEC.md](../../docs/STORE_SPEC.md).

All store data lives in the **hackathon MongoDB Atlas Sandbox** cluster, database `harbor`.

```bash
cd apps/store
npm install
cp .env.example .env   # paste the Atlas Sandbox URI into MONGODB_URI
npm run seed           # 6 products, 8 inventory docs, WELCOME10
npm run dev            # http://localhost:3000
npm test               # spec §11 acceptance, against a throwaway in-memory MongoDB
```

Try the demo path: open `/products/harbor-mug`, add the blue mug, apply `WELCOME10` in the cart, then check out to Austin.

Or use the API directly:

```bash
curl -s -X POST localhost:3000/cart/items -H 'content-type: application/json' \
  -H 'x-session-id: demo_agent_01' -d '{"sku":"MUG-BLUE","qty":1}'
```

## AgentDesk hook

`createApp(db, { siteUrl, beforeRoutes })` in `src/app.ts` takes extra middleware that runs after the session id is set (`res.locals.sessionId`) and before the store routes. That's where the AgentDesk tap goes. The store does not use `/agent`, `/mcp` or `/.well-known/agentdesk`.
