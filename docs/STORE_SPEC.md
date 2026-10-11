# Spec: Harbor Goods demo store

Companion to [STORE_PRD.md](./STORE_PRD.md). This is the build contract: stack, Atlas schema, HTTP, pages, seed, env, acceptance.

---

## 1. System context

```
browser / visiting agent
        |
        |  HTML + /api + aliased /cart/items
        v
+-------------------- Harbor Goods (this spec) ------------------+
|  shopper: agentdesk session, else cookie harbor_sid            |
|  SSR pages    JSON API    sitemap / llms.txt                   |
|                         |                                      |
|                         v                                      |
|                   MongoDB Atlas                                |
|                   db: harbor                                   |
|                   products, inventory, carts, coupons, orders  |
+----------------------------^-----------------------------------+
                             | same HTTP, same cookie
+-------------------- AgentDesk middleware ----------------------+
|  agentdesk(): tap -> requests, /agent /mcp /agentdesk panel   |
+----------------------------------------------------------------+
```

Two databases on the **same Atlas cluster**:

| Database | Owner | Collections |
|---|---|---|
| `harbor` | this store | `products`, `inventory`, `carts`, `coupons`, `orders` |
| `agentdesk` (`AGENTDESK_DB`) | AgentDesk package | `episodes`, `requests`, `knowledge`, `capabilities`, `intents`, `rules`, `feedback`, `settings` |

Store code never writes AgentDesk documents. Do not read `harbor` from the desk brain except via tapped HTTP and public HTML.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node 20+, TypeScript | Repo + Modelence |
| HTTP | Express | Simple SSR + JSON, easy middleware tap |
| HTML | Server-rendered templates (e.g. `lit-html`/Handlebars or TS template strings) | Crawlers and browser-driving agents see full pages |
| Driver | official `mongodb` | No ORM lock-in for a 5-collection app |
| DB | Atlas sandbox, `MONGODB_URI` | Hackathon rule |
| Deploy | `PORT`, `npx modelence deploy` later | PLAN.md |

Suggested layout (when we scaffold):

```
src/agentdesk/contract/  # shared with Door and Loop (CONTRACT.md): types.ts, db.ts
src/store/
  index.ts               # listen on PORT (npm run dev / start)
  dev-local.ts           # in-memory MongoDB for local testing only (npm run dev:local)
  app.ts                 # createApp({ storeDb, siteUrl, install })
  session.ts             # who owns the cart
  env.ts                 # loads .env before anything reads process.env
  store.ts               # catalog, cart, checkout logic
  routes/  views/  test/
package.json             # one app at the repo root (CONTRACT.md section 1)
```

If the team prefers Next.js App Router, keep **route paths, JSON bodies, and Atlas schemas identical**.

---

## 3. Configuration

```bash
MONGODB_URI=mongodb+srv://...        # required; hackathon Atlas Sandbox cluster only
MONGODB_DB_STORE=harbor              # default harbor
PORT=3000
SITE_URL=http://localhost:3000
```

Read **only** `MONGODB_URI` and exit with an error if it is missing. Do **not** fall back to Modelence's `MONGO_URL`: that would quietly move the data off the hackathon sandbox, which breaks the finalist rule. On Modelence, set `MONGODB_URI` explicitly to the sandbox URI. Listen on `process.env.PORT || 3000`.

`.env` is gitignored. Commit `.env.example` (repo root) with placeholder values only.

---

## 4. Session

The cart owner (`shopperId`) is resolved in this order:

1. `x-agentdesk-session` header, then `agentdesk_session` cookie (CONTRACT.md section 2). During an agent visit, the website fallback and the Door's capability calls then share **one cart**, and no `harbor_sid` is set.
2. Otherwise the store's own cookie `harbor_sid`: 24-byte hex, `httpOnly`, `sameSite=Lax`, `path=/`, 7-day max-age, created on the first request.


- One **active** cart per session (`carts.sessionId`, unique partial index on `status: "active"`). The cart has its own `_id`, so after checkout the converted cart stays as history and the same browser gets a fresh cart
AgentDesk's tap logs the **AgentDesk** session (`null` for humans), never `harbor_sid`.

---

## 5. Atlas data model (`harbor`)

### 5.1 Indexes

```
products:   { slug: 1 } unique
            { "variants.sku": 1 } unique
            { tags: 1 }
inventory:  { _id: 1 }          # sku
carts:      { sessionId: 1 } unique, partial { status: "active" }
            { status: 1, updatedAt: 1 }
coupons:    { code: 1 } unique
orders:     { sessionId: 1, createdAt: -1 }
```

### 5.2 `products`

One document per sellable product. Variants bounded (≤ 4). Stock is **not** the source of truth here; `inventory` is.

```json
{
  "_id": "prod_harbor_mug",
  "slug": "harbor-mug",
  "name": "Harbor Mug",
  "description": "12oz ceramic mug. The blue one is the house favorite.",
  "category": "mugs",
  "tags": ["mug", "ceramic", "desk"],
  "images": [{ "url": "/img/mug-blue.svg", "alt": "Harbor Mug in blue" }],
  "variants": [
    {
      "sku": "MUG-BLUE",
      "color": "blue",
      "label": "Blue",
      "priceCents": 2400
    },
    {
      "sku": "MUG-WHITE",
      "color": "white",
      "label": "White",
      "priceCents": 2400
    },
    {
      "sku": "MUG-CLAY",
      "color": "clay",
      "label": "Clay",
      "priceCents": 2400
    }
  ],
  "active": true,
  "createdAt": "ISODate"
}
```

### 5.3 `inventory`

```json
{
  "_id": "MUG-BLUE",
  "productId": "prod_harbor_mug",
  "available": 100,
  "reserved": 0,
  "sold": 0
}
```

Add-to-cart (simplified reservation, enough for demo):

```js
inventory.updateOne(
  { _id: sku, available: { $gte: qty } },
  { $inc: { available: -qty, reserved: qty } }
)
```

If `matchedCount === 0` → `409` `{ error: "out_of_stock", sku }`.

Checkout: `$inc: { reserved: -qty, sold: qty }`.  
Qty down / remove from cart: reverse the reservation.

Hackathon skip: no background expiry job. Stock starts at 100.

### 5.4 `carts`

```json
{
  "_id": "cart_...",
  "shopperId": "<agentdesk session or harbor_sid>",
  "status": "active",
  "items": [
    {
      "sku": "MUG-BLUE",
      "productId": "prod_harbor_mug",
      "name": "Harbor Mug",
      "variantLabel": "Blue",
      "imageUrl": "/img/mug-blue.svg",
      "qty": 1,
      "unitPriceCents": 2400
    }
  ],
  "coupon": null,
  "summary": {
    "subtotalCents": 2400,
    "discountCents": 0,
    "shippingCents": 0,
    "totalCents": 2400,
    "currency": "USD"
  },
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

`status`: `active` | `converted`.  
Recompute `summary` on every cart mutation. Shipping `$0` for demo.  
Coupon: `coupon` holds `{ code, percentOff }` snapshotted when applied; `discountCents = floor(subtotal * percentOff / 100)`.

### 5.5 `coupons`

```json
{
  "_id": "WELCOME10",
  "code": "WELCOME10",
  "percentOff": 10,
  "active": true,
  "description": "10% off subtotal"
}
```

Unknown or inactive code → `400` `{ error: "invalid_coupon" }`.

### 5.6 `orders` (immutable after insert)

```json
{
  "_id": "ord_...",
  "shopperId": "<agentdesk session or harbor_sid>",
  "cartId": "cart_...",
  "status": "paid",
  "items": [ { "sku": "MUG-BLUE", "name": "Harbor Mug", "variantLabel": "Blue", "qty": 1, "unitPriceCents": 2400 } ],
  "summary": { "subtotalCents": 2400, "discountCents": 240, "shippingCents": 0, "totalCents": 2160, "currency": "USD" },
  "couponCode": "WELCOME10",
  "shipping": {
    "name": "Alex Rivera",
    "email": "alex@example.com",
    "line1": "100 Congress Ave",
    "city": "Austin",
    "region": "TX",
    "postal": "78701",
    "country": "US"
  },
  "payment": { "method": "demo", "last4": "4242", "transactionId": "demo_..." },
  "createdAt": "ISODate"
}
```

No updates except optional `status` (keep `paid` for demo). Snapshot names and prices from the cart, never from live `products`.

---

## 6. HTTP API

Base: same origin. JSON `Content-Type: application/json`.  
**Alias:** `POST /cart/items` = `POST /api/cart/items` (DEMO.md).

All cart/checkout routes act on the shopper from section 4 (AgentDesk session, else `harbor_sid`).

### 6.1 `GET /health`

`200` `{ "ok": true, "mongo": true }`

### 6.2 `GET /api/products`

Query: `q` optional (regex on `name`, `tags`, `variants.color`, case-insensitive).  
`200` `{ "products": [ { id, slug, name, description, images, variants: [{ sku, color, label, priceCents, available }] } ] }`

Join `available` from `inventory` by sku when returning.

### 6.3 `GET /api/products/:slug`

`404` if missing. Same product object as above, single.

### 6.4 `GET /api/cart`

`200` cart document for this session (create empty `active` cart if none).

### 6.5 `POST /api/cart/items`  and  `POST /cart/items`

Body:

```json
{ "sku": "MUG-BLUE", "qty": 1 }
```

Rules:

- `sku` required string, `qty` integer ≥ 1 (default 1). In JSON, `qty` must be a **number**: `"one"` or `"2"` → `400` (the demo's failed visit, `fixtures/episode-cart-prior-fail.json`). Form posts are parsed.
- Resolve variant from `products`
- Reserve inventory
- Upsert line: if sku already in cart, add qty
- Recalc summary

`201` `{ "cart": { ... } }` (JSON; forms get `303` to `/cart`)  
`404` unknown sku  
`409` out of stock  
`400` bad qty

### 6.6 `PATCH /api/cart/items/:sku`

`{ "qty": 2 }`  — `qty: 0` removes. Adjust inventory reservation by delta.

### 6.7 `DELETE /api/cart/items/:sku`

Same as qty 0.

### 6.8 `POST /api/cart/coupon`

```json
{ "code": "WELCOME10" }
```

Set `couponCode`, recalc. `DELETE /api/cart/coupon` clears it.

### 6.9 `POST /api/checkout`

```json
{
  "shipping": {
    "name": "Alex Rivera",
    "email": "alex@example.com",
    "line1": "100 Congress Ave",
    "city": "Austin",
    "region": "TX",
    "postal": "78701",
    "country": "US"
  },
  "payment": { "method": "demo", "last4": "4242" }
}
```

Rules:

- Cart `active` with ≥ 1 item
- `shipping.name`, `email`, `line1`, `city`, `country` required
- `payment.method` must be `"demo"`
- Insert order snapshot, inventory reserved → sold, cart `converted`
- New empty cart may be created on next GET

Optional header `Idempotency-Key`: a retry with the same key returns the same order (`200`, `replayed: true`) instead of buying twice.

`201` `{ "order": { "id", "summary", "items", "shipping", "payment" }, "replayed": false }`  
`400` `empty_cart` or `invalid_shipping`  
`409` `already_ordered` `{ orderId }`: no active cart, but this shopper placed an order in the last 15 minutes. Agents should treat this as done, not rebuild the cart.

`payment.cardNumber` is accepted instead of `last4`; only the last 4 digits are kept.

---

## 7. HTML pages (SSR)

Every page: header with store name + cart count, footer with policies link.

| Route | Renders |
|---|---|
| `GET /` | Featured: Harbor Mug, Canvas Tote, Softcover Notebook |
| `GET /products` | Grid; honor `?q=` |
| `GET /products/:slug` | Name, description, color buttons, price, stock, form POST `/cart/items` with hidden `sku` + `qty` |
| `GET /cart` | Lines, qty forms, coupon form POST `/api/cart/coupon`, link to checkout |
| `GET /checkout` | Shipping fields (city default empty so demo can type Austin), submit POST `/api/checkout` |
| `GET /orders/:id` | Confirmation; 404 if not this session |
| `GET /policies` | Plain language: US shipping, fake payments, coupons for humans, returns 30 days |
| `GET /sitemap.xml` | `/`, `/products`, each product slug, `/policies` |
| `GET /llms.txt` | Store name, URL, what it sells, sitemap link. **No** `/agent` tool list (desk injects that). |

**Pages call the real JSON API.** Forms marked `data-api` are sent by a small inline script as JSON, with numbers as numbers and `shipping.city`-style names nested, and the card number cut to `last4` in the browser. So the traffic a visitor agent's fallback produces (and AgentDesk learns from) is exactly the API in section 6: `POST /cart/items {"sku":"MUG-BLUE","qty":2}` → `201`.

Without JavaScript the same forms still work: they post `application/x-www-form-urlencoded` (dotted names are unflattened server-side), a hidden `_method=PATCH|DELETE` picks the handler, and the response is a `303` redirect.

Product page for the mug **must** include the literal words `blue mug` in visible HTML (name + description) so visit-1 knowledge extraction is easy.

---

## 8. Seed catalog

Idempotent upsert by `_id` / sku. Run `npm run seed`.

| productId | slug | name | skus |
|---|---|---|---|
| `prod_harbor_mug` | `harbor-mug` | Harbor Mug | `MUG-BLUE` 2400, `MUG-WHITE` 2400, `MUG-CLAY` 2400 |
| `prod_canvas_tote` | `canvas-tote` | Canvas Tote | `TOTE-NAT` 3200 |
| `prod_notebook` | `softcover-notebook` | Softcover Notebook | `NOTE-DOT` 1400 |
| `prod_sticker` | `laptop-stickers` | Laptop Sticker Pack | `STK-PACK` 800 |
| `prod_coaster` | `cork-coaster` | Cork Coaster | `CST-CORK` 900 |
| `prod_pen` | `gel-pen` | Gel Pen | `PEN-BLK` 600 |

All `available: 100`.  
Coupon `WELCOME10` 10% off.

SVG placeholders in `public/img/` named by sku color.

---

## 9. AgentDesk integration contract

Per CONTRACT.md v2, the store writes **nothing** to the AgentDesk collections. The tap belongs to the Door, inside the `agentdesk()` package. The store's only job is the install line.

`createApp({ storeDb, siteUrl, install })` in `src/store/app.ts` runs, in order:

1. Body parsers and the shopper session (section 4).
2. `install(app)`: the one-line install, `app.use(agentdesk())`. `src/store/index.ts` loads `src/agentdesk/index.ts` once the Door ships it; `AGENTDESK=off` runs the bare store for the "before" shot.
3. Store routes.

Checkout runs in a **multi-document transaction** (cart → converted, inventory reserved → sold, order insert), so it is all or nothing.

Reserved by AgentDesk (store must not use): `/agent`, `/agentdesk`, `/mcp`, `/.well-known/agentdesk`.

Store **should** add in HTML `<head>`:

```html
<link rel="alternate" type="text/plain" href="/llms.txt" />
```

Desk may add the agentdesk link tag itself.

---

## 10. Money and errors

- All money: integer cents. Display with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.
- Error JSON: `{ "error": "<code>", "message": "<human>" }`
- Codes: `bad_request`, `not_found`, `out_of_stock`, `invalid_coupon`, `empty_cart`, `invalid_shipping`, `already_ordered`, `conflict`

---

## 11. Test / acceptance (store alone)

Automated or manual:

1. Seed on empty `harbor` db → 6 products, 8 inventory docs (3 mug colors + 5 others), 1 coupon.
2. `GET /products/harbor-mug` HTML contains `MUG-BLUE` or visible “Blue”.
3. `POST /cart/items` `{ "sku": "MUG-BLUE", "qty": 1 }` → cart total 2400; inventory available 99, reserved 1.
4. `POST /api/cart/coupon` `{ "code": "WELCOME10" }` → discount 240, total 2160.
5. `POST /api/checkout` with Austin shipping → `orders` count +1, cart `converted`, inventory sold 1 reserved 0.
6. Second checkout right after an order → 409 `already_ordered` with `orderId`; same `Idempotency-Key` → same order; a shopper with no cart and no recent order → 400 `empty_cart`.
7. Unknown sku → 404.
8. `/sitemap.xml` lists `/products/harbor-mug`.

Browser check: with JavaScript, the pages send the JSON in section 6 (verified in a headless browser).

---

## 12. Non-functional

- p95 page load does not matter beyond “feels instant” on localhost.
- No auth. Do not expose Atlas URI.
- Logs: method, path, status, sessionId — no payment PAN (store never accepts a real PAN field into Atlas).
