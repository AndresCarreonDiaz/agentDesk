# PRD: Harbor Goods demo store

**Owner:** demo-store track  
**Status:** ready to build  
**Cluster:** MongoDB Atlas hackathon sandbox (all store data lives here)  
**Host:** local first, then Modelence (`cloud.modelence.com`) for the public demo link

This is the **host platform** AgentDesk drops into. It is not AgentDesk. It must look and behave like a real tiny shop so visiting agents can fail, fall back to the human site, and succeed later. AgentDesk learns from that traffic.

Related: [CONCEPT.md](./CONCEPT.md), [ARCHITECTURE.md](./ARCHITECTURE.md), [DEMO.md](./DEMO.md), [STORE_SPEC.md](./STORE_SPEC.md).

---

## 1. Why this store exists

The 3-minute stage demo needs a living website, not a mocked API:

| Demo beat | What the store must do |
|---|---|
| Empty desk | Site is already live. Catalog, cart, checkout work for humans. Desk knows nothing. |
| Visit 1 | Agent crawls pages / sitemap and can infer “this is a shop that sells mugs”. |
| Visit 2 | Agent cannot add to cart via the desk. Playwright (or a human) uses the site. Middleware tap sees `POST /cart/items` with `{ sku, qty }`. |
| Visits 3–10 | Search, cart, and checkout HTTP calls are stable, documented-by-traffic, and idempotent enough to become capabilities. |
| Developer steers | A real coupon exists (`WELCOME10`) so “agents may not apply discount codes” is a visible block, not a fake. |
| Close | Fake checkout completes an order in Atlas. No real money. |

If the store is a thin stub, the harness has nothing real to learn.

---

## 2. Research: what we keep, what we cut

Investigation (MongoDB retail ODL, official cart/inventory use cases, Shopify/UCP agent discovery, Modelence hosting) distilled to **hackathon-scale** choices.

### Keep (Atlas / commerce best practice)

1. **One Atlas cluster, two databases.** Commerce (`harbor`) is a bounded context. AgentDesk memory (`agentdesk`, CONTRACT.md v2) stays in the collections already named in Architecture. Same cluster, no joins across them. The tap correlates them with a **session id**, not a shared schema.
2. **Document model matched to access patterns.**
   - Product + a few color variants in **one product document** (always read together).
   - Cart = **one document**, line items embedded, **price/name/sku snapshotted** at add-to-cart.
   - Order = **immutable snapshot** of lines, totals, shipping, payment. Never re-read live product prices for history.
   - Inventory = **one document per SKU**, `_id = sku`, atomic `$inc` with `available: { $gte: qty }` so we cannot oversell.
3. **Guest session, not user accounts.** Humans get a `harbor_sid` cookie. During an agent visit the cart belongs to the AgentDesk session (`x-agentdesk-session` header or `agentdesk_session` cookie, CONTRACT.md section 2), so the Playwright fallback, the Door's capability calls and the tapped `requests` all share one id.
4. **HTML that works without a SPA hydration race.** Server-rendered pages (or SSR) so a crawler and Playwright can click “Add to cart” on the blue mug without waiting on a client bundle.
5. **Machine-readable doors on the origin.** Store serves crawlable HTML, `/sitemap.xml`, and a stub `/llms.txt`. AgentDesk middleware owns `/.well-known/agentdesk`, `POST /agent`, and `/mcp`. Do not pre-document tools in the store; the desk starts empty.
6. **Money in integer cents**, currency `USD`. Fake payment token only.

### Cut (too heavy for today)

- Atlas Search / Voyage vectors on the catalog (tiny catalog; `sku`, `name`, `color` filters are enough). Voyage stays on **desk** intents/capabilities.
- Multi-store inventory, geospatial, Atlas Triggers to denormalize stock.
- Real auth, Stripe, taxes by jurisdiction, shipping carriers.
- Cart TTL jobs that release reservations (use a long-lived demo cart; stock is high).
- Modelence App Builder as source of truth (we write the store in this repo so the team owns it). Deploy to Modelence Cloud later.

### Stack implication

Architecture already says TypeScript + Node. Modelence Cloud runs a Node 18+ service on `process.env.PORT` and injects `MONGODB_URI` / `MONGO_URL`. Spec targets **Express + server-rendered HTML** (or Next.js if we already have it) behind that contract so local and Modelence stay the same app.

---

## 3. Product definition

**Harbor Goods** is a one-origin shop that sells a handful of desk objects. Hero SKU for the script: **Harbor Mug, Blue** (`sku: MUG-BLUE`).

### Users

| Actor | Goal |
|---|---|
| Human shopper (judges, Playwright) | Browse, add mug, apply coupon, check out with a fake card. |
| Visiting agent | Discover the site, then either use AgentDesk or fall back to the same HTTP/HTML. |
| AgentDesk middleware | See every store request/response with session id. |
| Developer (teammate) | Seed Atlas, run locally, later deploy. |

### In scope (must ship)

- Catalog of 6 products, including color variants on the mug.
- Product list, product detail, cart, checkout, order confirmation.
- Pages call the real JSON API under `/api` (and `/cart/items`); without JavaScript the same forms post to the same handlers.
- Guest cart: AgentDesk session during agent visits, `harbor_sid` for humans.
- The install line `app.use(agentdesk())` (the tap inside it is the Door's).
- Coupon `WELCOME10` (10% off subtotal).
- Fake checkout that writes an `orders` document and marks the cart `converted`.
- Seed script into Atlas.
- `GET /sitemap.xml`, `GET /llms.txt` (store facts only, no tool list).
- Health: `GET /health` (mongo ping).

### Out of scope

- Payments on real rails (already a Concept non-goal).
- AgentDesk brain, reflector, developer panel (other tracks).
- Second host site (insurance quote) — separate later, cut-line #1 in PLAN.
- Accounts, email, admin CMS.

### Success metrics (store track)

The store is done when the AgentDesk track can run DEMO.md visits 1–2 against it without changing store code:

1. Open `/` — “Harbor Goods” and at least one mug visible in HTML.
2. Open `/products/harbor-mug` — Blue variant selectable; Add to cart works.
3. `POST /api/cart/items` with `{ "sku": "MUG-BLUE", "qty": 1 }` returns 201 and persists in Atlas `carts`.
4. Checkout creates an `orders` document.
5. `POST /api/cart/coupon` with `{ "code": "WELCOME10" }` changes totals.
6. Every request above is plain JSON over HTTP, so AgentDesk's tap records it with the agent's `sessionId`, `bodyShape` and status.

---

## 4. Experience

### Pages

| Path | Purpose |
|---|---|
| `/` | Hero, 3 featured products, “Shop mugs”. |
| `/products` | Grid + `?q=` search (name/color/tags, case-insensitive). |
| `/products/:slug` | PDP. Variant picker. Add to cart. |
| `/cart` | Lines, qty update, remove, coupon field, checkout CTA. |
| `/checkout` | Name, email, shipping (include city so “ship to Austin” works), fake card fields (ignored except non-empty). |
| `/orders/:id` | Confirmation. Order number, snapshot lines, total. |
| `/policies` | Shipping / returns / “no resale of discount codes to bots” copy — extra facts for visit-1 learning. |

Visual bar: clean, fast, obviously a shop. Not a dashboard. One accent color. Product photos can be solid-color SVG placeholders labeled “Blue mug” so the agent and the camera both see the color.

### Copy the desk should be able to learn from HTML

- Store name and one-sentence purpose.
- What it sells (mugs, totes, notebooks, stickers).
- Ships in the US. Fake payment. Coupons exist.
- Blue mug is in stock.

Do **not** publish a tool manifest or API cheat-sheet on the marketing pages. Learning from traffic is the product.

---

## 5. Capabilities the desk will observe

These are **store HTTP capabilities**, not AgentDesk tools. They must be stable.

| Human action | HTTP the tap should see | Writes? |
|---|---|---|
| Search / list | `GET /api/products?q=mug` | no |
| Product detail | `GET /api/products/harbor-mug` | no |
| Add to cart | `POST /api/cart/items` `{ sku, qty }` | yes |
| Update qty | `PATCH /api/cart/items/:sku` `{ qty }` | yes |
| Apply coupon | `POST /api/cart/coupon` `{ code }` | yes |
| Checkout | `POST /api/checkout` `{ shipping, payment }` | yes (spend) |

Read-only can auto-verify on the desk. Cart writes can proposed/verified. Checkout stays **needs approval**. Coupon is the capability the developer **blocks**.

HTML forms POST to the same `/api/*` routes (or the server maps `/cart/items` → the same controller). DEMO.md names `POST /cart/items`; the spec aliases that path so the script matches.

---

## 6. Data policy

- **All durable store state is in Atlas.** No in-memory catalog after seed. Restarting the app does not empty carts/orders.
- Seed is idempotent (`sku` / `slug` unique).
- `.env` holds `MONGODB_URI` only; never commit it.
- PII in demo orders is fake (scripted names). Still treat Atlas as the system of record.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| SPA-only cart that Playwright / tap cannot see | SSR + JSON APIs; no cart-only-in-React-state. |
| Desk and store fight over `/agent` | Store does not define AgentDesk routes. Middleware mounts them. |
| Coupon too hidden for the demo | Visible field on `/cart`. Seeded `WELCOME10`. |
| Overselling during sped-up visits | High stock (100+) and atomic inventory updates. |
| Modelence injects a different DB than the hackathon sandbox | App reads **only** `MONGODB_URI` and refuses to start without it. No fallback to Modelence's `MONGO_URL`. It always points at the hackathon Atlas Sandbox cluster (finalist rule, see §9). |

---

## 8. Build order (store track)

1. Atlas `harbor` db, seed products + inventory + coupon.
2. Session cookie + products list/detail HTML + JSON.
3. Cart add/update + `POST /cart/items` alias.
4. Checkout + orders.
5. Coupon.
6. sitemap + llms.txt + policies.
7. Install line in place; once the Door's `agentdesk()` lands, requests show up in Atlas.

Cut if late: coupon UI (keep API), policies page, search query (keep full list). **Never cut:** blue mug PDP, `POST /cart/items`, Atlas persistence, fake checkout.

Deadline: submissions close **5:00 PM PT, Oct 11**. The store must be usable by the AgentDesk track by mid-afternoon so the harness has time to run against it.

---

## 9. Hackathon rules compliance

Source: the Cerebral Valley participant guide for the Harness Engineering & Model Wrangling #SFTechWeek hackathon.

| Rule | How the store complies |
|---|---|
| Finalists must build on the **MongoDB Atlas Sandbox** from the hackathon email | All `harbor` data lives in that sandbox cluster. `MONGODB_URI` is required, and there is no fallback to another database (local, Modelence-provisioned, or a personal cluster). |
| Repository must be **public** | Store code ships in this repo. Secrets stay in `.env` (gitignored). Run `./scripts/setup-hooks.sh` with `gitleaks` before committing. |
| **New work only**, contributions clearly identifiable | Store is written from scratch today in `src/store/`. Git history shows it. Product images are our own SVG placeholders, not stock photos. Product names and copy are invented. |
| No code, data or assets we lack rights to | Only npm packages under permissive licenses. No scraped catalogs, brand names or logos. |
| Banned: "a dashboard is the main feature" | The store is a shopfront and the developer panel is a supporting view. The pitch centres on the harness learning (Problem Statement 1, Recursive Harnessing). |
| Demo only shows what we built | In the demo and 1-minute video, the store is framed as the **host site we built today** for the harness to learn. It is not presented as the product. |
