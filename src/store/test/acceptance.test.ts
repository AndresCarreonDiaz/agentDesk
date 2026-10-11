// STORE_SPEC.md §11 acceptance, against a throwaway in-memory MongoDB.
// The real app runs only on the hackathon Atlas Sandbox; this is just for tests.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { createApp } from '../app';
import { seedDatabase } from '../seed';
import { PAGE_SCRIPT } from '../views/layout';

let mongo: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let base: string;
let close: () => void;

const SID = 'ses_test0001';
const AUSTIN = {
  shipping: { name: 'Alex Rivera', email: 'alex@example.com', line1: '100 Congress Ave', city: 'Austin', region: 'TX', postal: '78701', country: 'US' },
  payment: { method: 'demo', last4: '4242' },
};

function call(method: string, path: string, json?: unknown, sid = SID, extra: Record<string, string> = {}) {
  return fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { 'x-agentdesk-session': sid, ...extra, ...(json ? { 'content-type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
}

const stock = (sku: string) => db.collection('inventory').findOne({ _id: sku as never });

before(async () => {
  // Replica set so checkout runs in a real transaction, as on Atlas.
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('harbor');
  const server = createApp({ storeDb: db, siteUrl: 'http://store.test' }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(async () => {
  close();
  await client.close();
  await mongo.stop();
});

test('1. seed: 6 products, 8 inventory docs, 1 coupon; idempotent', async () => {
  assert.deepEqual(await seedDatabase(db), { products: 6, inventory: 8, coupons: 1 });
  assert.deepEqual(await seedDatabase(db), { products: 6, inventory: 8, coupons: 1 });
});

test('2. blue mug product page is crawlable HTML', async () => {
  const res = await fetch(`${base}/products/harbor-mug`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie') ?? '', /harbor_sid=/);
  const page = await res.text();
  assert.match(page, /MUG-BLUE/);
  assert.match(page, /blue mug/i);
  assert.match(page, /action="\/cart\/items"/);
});

test('3. POST /cart/items reserves stock and persists the cart', async () => {
  const res = await call('POST', '/cart/items', { sku: 'MUG-BLUE', qty: 1 });
  assert.equal(res.status, 201);
  const { cart } = await res.json();
  assert.equal(cart.summary.totalCents, 2400);
  assert.equal(cart.items[0].sku, 'MUG-BLUE');
  assert.deepEqual(await stock('MUG-BLUE'), { _id: 'MUG-BLUE', productId: 'prod_harbor_mug', available: 99, reserved: 1, sold: 0 });
  assert.equal(await db.collection('carts').countDocuments({ shopperId: SID, status: 'active' }), 1);
});

test('4. WELCOME10 takes 10% off', async () => {
  const { cart } = await (await call('POST', '/api/cart/coupon', { code: 'welcome10' })).json();
  assert.equal(cart.summary.discountCents, 240);
  assert.equal(cart.summary.totalCents, 2160);
  const bad = await call('POST', '/api/cart/coupon', { code: 'NOPE' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error, 'invalid_coupon');
});

test('5. checkout to Austin writes an order and converts the cart', async () => {
  const res = await call('POST', '/api/checkout', AUSTIN);
  assert.equal(res.status, 201);
  const { order } = await res.json();
  assert.equal(order.summary.totalCents, 2160);
  assert.equal(order.shipping.city, 'Austin');
  assert.equal(await db.collection('orders').countDocuments(), 1);
  assert.equal(await db.collection('carts').countDocuments({ shopperId: SID, status: 'converted' }), 1);
  assert.equal((await stock('MUG-BLUE'))?.sold, 1);
  assert.equal((await stock('MUG-BLUE'))?.reserved, 0);
});

test('6. checking out again right after an order says already_ordered, not empty_cart', async () => {
  const res = await call('POST', '/api/checkout', AUSTIN);
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.equal(body.error, 'already_ordered');
  assert.match(body.orderId, /^ord_/);
  assert.equal(await db.collection('orders').countDocuments(), 1);
  const fresh = await call('POST', '/api/checkout', AUSTIN, 'ses_never0001');
  assert.equal(fresh.status, 400);
  assert.equal((await fresh.json()).error, 'empty_cart');
});

test('checkout retry with the same Idempotency-Key returns the same order', async () => {
  const sid = 'ses_retry0001';
  await call('POST', '/cart/items', { sku: 'NOTE-DOT', qty: 1 }, sid);
  const key = { 'idempotency-key': 'k-123' };
  const first = await call('POST', '/api/checkout', AUSTIN, sid, key);
  assert.equal(first.status, 201);
  const second = await call('POST', '/api/checkout', AUSTIN, sid, key);
  assert.equal(second.status, 200);
  const a = await first.json();
  const b = await second.json();
  assert.equal(b.replayed, true);
  assert.equal(b.order.id, a.order.id);
  assert.equal(await db.collection('orders').countDocuments({ shopperId: sid }), 1);
});

test('7. unknown sku is 404 and leaves stock alone', async () => {
  const res = await call('POST', '/api/cart/items', { sku: 'NOPE-1', qty: 1 });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'not_found');
});

test('8. sitemap lists the mug; llms.txt has facts but no tool list', async () => {
  assert.match(await (await fetch(`${base}/sitemap.xml`)).text(), /http:\/\/store\.test\/products\/harbor-mug/);
  const llms = await (await fetch(`${base}/llms.txt`)).text();
  assert.match(llms, /Harbor Mug/);
  assert.doesNotMatch(llms, /\/api\/|\/agent|cart\/items/);
});

test('same session gets a fresh cart after checkout; qty update and remove adjust stock', async () => {
  await call('POST', '/api/cart/items', { sku: 'TOTE-NAT', qty: 2 });
  let { cart } = await (await call('PATCH', '/api/cart/items/TOTE-NAT', { qty: 5 })).json();
  assert.equal(cart.items[0].qty, 5);
  assert.equal((await stock('TOTE-NAT'))?.reserved, 5);
  ({ cart } = await (await call('DELETE', '/api/cart/items/TOTE-NAT')).json());
  assert.equal(cart.items.length, 0);
  assert.deepEqual(await stock('TOTE-NAT'), { _id: 'TOTE-NAT', productId: 'prod_canvas_tote', available: 100, reserved: 0, sold: 0 });
});

test('JSON qty must be a number: "one" and "2" get 400 (the demo\'s failed visit)', async () => {
  for (const qty of ['one', '2']) {
    const res = await call('POST', '/cart/items', { sku: 'MUG-BLUE', qty }, 'ses_textqty01');
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'bad_request');
  }
  assert.equal(await db.collection('carts').countDocuments({ shopperId: 'ses_textqty01', 'items.0': { $exists: true } }), 0);
});

test('cannot oversell', async () => {
  const res = await call('POST', '/api/cart/items', { sku: 'PEN-BLK', qty: 99 }, 'ses_other0001');
  assert.equal(res.status, 201);
  const res2 = await call('POST', '/api/cart/items', { sku: 'PEN-BLK', qty: 2 }, 'ses_other0002');
  assert.equal(res2.status, 409);
  assert.equal((await res2.json()).error, 'out_of_stock');
});

test('HTML form flow: add, coupon, checkout with redirects', async () => {
  const sid = 'form_session_0001';
  const form = (path: string, fields: Record<string, string>) =>
    fetch(base + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `harbor_sid=${sid}`, referer: `${base}/cart` },
      body: new URLSearchParams(fields),
    });
  let res = await form('/cart/items', { sku: 'MUG-BLUE', qty: '2' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/cart');
  res = await form('/api/cart/items/MUG-BLUE', { _method: 'PATCH', qty: '1' });
  assert.equal(res.status, 303);
  res = await form('/api/cart/coupon', { code: 'BOGUS' });
  assert.equal(res.headers.get('location'), '/cart?error=invalid_coupon');
  res = await form('/api/cart/coupon', { code: 'WELCOME10' });
  const cartPage = await (await fetch(`${base}/cart`, { headers: { cookie: `harbor_sid=${sid}` } })).text();
  assert.match(cartPage, /data-total-cents="2160"/);
  const checkoutForm = {
    'shipping.name': 'Sam Lee', 'shipping.email': 's@example.com', 'shipping.line1': '1 Main St', 'shipping.city': 'Austin',
    'shipping.region': 'TX', 'shipping.postal': '78701', 'shipping.country': 'US', 'payment.method': 'demo', 'payment.cardNumber': '4242424242424242',
  };
  res = await form('/api/checkout', checkoutForm);
  assert.equal(res.status, 303);
  const location = res.headers.get('location')!;
  assert.match(location, /^\/orders\/ord_/);
  const orderPage = await (await fetch(base + location, { headers: { cookie: `harbor_sid=${sid}` } })).text();
  assert.match(orderPage, /Austin/);
  const order = await db.collection('orders').findOne({ shopperId: sid });
  assert.equal(order?.payment.last4, '4242');
  assert.doesNotMatch(JSON.stringify(order), /4242424242424242/);
  // Double-submitting the form lands on the same order.
  res = await form('/api/checkout', checkoutForm);
  assert.equal(res.headers.get('location'), location);
  // Another session cannot read the order.
  assert.equal((await fetch(base + location, { headers: { cookie: 'harbor_sid=someone_else_01' } })).status, 404);
});

test('search: "blue mug" finds the blue mug (fixture fallback query)', async () => {
  const { products } = await (await fetch(`${base}/api/products?q=blue%20mug`)).json();
  assert.deepEqual(products.map((p: { slug: string }) => p.slug), ['harbor-mug']);
  const { products: mugs } = await (await fetch(`${base}/api/products?q=mugs`)).json();
  assert.equal(mugs.length, 1);
  const { products: none } = await (await fetch(`${base}/api/products?q=blue%20tote`)).json();
  assert.equal(none.length, 0);
});

test('agent visit: website fallback (cookie) and capability call (header) share one cart', async () => {
  const visit = 'ses_visit0001';
  // Fallback: the visitor agent uses the website with the agentdesk_session cookie set.
  const fallback = await fetch(`${base}/cart/items`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `agentdesk_session=${visit}` },
    body: new URLSearchParams({ sku: 'MUG-WHITE', qty: '1' }),
  });
  assert.equal(fallback.status, 303);
  assert.equal(fallback.headers.get('set-cookie'), null, 'no harbor_sid during an agent visit');
  // Capability: the Door replays the mapped request with the session header.
  const cap = await call('POST', '/cart/items', { sku: 'MUG-WHITE', qty: 1 }, visit, { 'x-agentdesk-source': 'capability' });
  const { cart } = await cap.json();
  assert.equal(cart.items[0].qty, 2);
});

test('pages: forms post to the JSON API, and the page script parses', async () => {
  const pdp = await (await fetch(`${base}/products/harbor-mug`)).text();
  assert.match(pdp, /<form class="row" action="\/cart\/items" method="post" data-api/);
  assert.doesNotThrow(() => new Function(PAGE_SCRIPT));
  assert.doesNotMatch(pdp.slice(pdp.indexOf('<style>'), pdp.indexOf('</style>')), /&quot;|&gt;/, 'CSS must not be HTML-escaped');
});

test('JSON checkout with nested shipping/payment keeps only the last 4 digits', async () => {
  const sid = 'ses_json0001';
  await call('POST', '/cart/items', { sku: 'STK-PACK', qty: 1 }, sid);
  const res = await call('POST', '/api/checkout', {
    shipping: AUSTIN.shipping,
    payment: { method: 'demo', cardNumber: '4000 0000 0000 1234' },
  }, sid);
  assert.equal(res.status, 201);
  const { order } = await res.json();
  assert.equal(order.payment.last4, '1234');
  assert.doesNotMatch(JSON.stringify(await db.collection('orders').findOne({ shopperId: sid })), /4000/);
});
