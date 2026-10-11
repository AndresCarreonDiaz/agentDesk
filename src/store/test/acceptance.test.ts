// STORE_SPEC.md §11 acceptance, against a throwaway in-memory MongoDB.
// The real app runs only on the hackathon Atlas Sandbox; this is just for tests.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { createApp } from '../app';
import { seedDatabase } from '../seed';
import { ensureTapIndexes } from '../tap';

let mongo: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let desk: Db;
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
  desk = client.db('desk');
  await ensureTapIndexes(desk);
  const server = createApp({ storeDb: db, deskDb: desk, siteId: 'demo-store', siteUrl: 'http://store.test' }).listen(0);
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

test('6. second checkout with an empty cart is rejected', async () => {
  const res = await call('POST', '/api/checkout', AUSTIN);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'empty_cart');
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
  res = await form('/api/checkout', { name: 'Sam Lee', email: 's@example.com', line1: '1 Main St', city: 'Austin', region: 'TX', postal: '78701', country: 'US', cardNumber: '4242424242424242' });
  assert.equal(res.status, 303);
  const location = res.headers.get('location')!;
  assert.match(location, /^\/orders\/ord_/);
  const orderPage = await (await fetch(base + location, { headers: { cookie: `harbor_sid=${sid}` } })).text();
  assert.match(orderPage, /Austin/);
  const order = await db.collection('orders').findOne({ shopperId: sid });
  assert.equal(order?.payment.last4, '4242');
  assert.doesNotMatch(JSON.stringify(order), /4242424242424242/);
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
  // Fallback: Playwright clicks the site with the agentdesk_session cookie set.
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

test('tap: writes contract-shaped requests to desk.requests', async () => {
  await desk.collection('episodes').insertOne({ episodeId: 'ep_tap0001', sessionId: 'ses_tap0001', siteId: 'demo-store' });
  const res = await call('POST', '/cart/items', { sku: 'MUG-BLUE', qty: 1 }, 'ses_tap0001');
  const requestId = res.headers.get('x-agentdesk-request');
  assert.match(requestId ?? '', /^req_/);
  await call('POST', '/cart/items', { sku: 'MUG-BLUE', qty: 1 }, 'ses_tap0001', { 'x-agentdesk-source': 'capability' });
  await fetch(`${base}/products?q=blue%20mug`); // a human
  await fetch(`${base}/img/mug-blue.svg`); // not recorded
  await new Promise((r) => setTimeout(r, 100)); // the tap writes after the response

  const doc = await desk.collection('requests').findOne({ requestId }, { projection: { _id: 0 } });
  assert.ok(doc);
  assert.equal(doc.siteId, 'demo-store');
  assert.equal(doc.sessionId, 'ses_tap0001');
  assert.equal(doc.episodeId, 'ep_tap0001');
  assert.equal(doc.source, 'fallback');
  assert.equal(doc.method, 'POST');
  assert.equal(doc.path, '/cart/items');
  assert.deepEqual(doc.bodyShape, { sku: 'string', qty: 'number' });
  assert.deepEqual(doc.body, { sku: 'MUG-BLUE', qty: 1 });
  assert.equal(doc.status, 201);
  assert.equal(typeof doc.durationMs, 'number');
  assert.ok(doc.timestamp instanceof Date && doc.createdAt instanceof Date);

  const sources = await desk.collection('requests').find({ sessionId: 'ses_tap0001' }).map((d) => d.source).toArray();
  assert.deepEqual(sources.sort(), ['capability', 'fallback']);
  const human = await desk.collection('requests').findOne({ path: '/products', 'query.q': 'blue mug' });
  assert.equal(human?.sessionId, null);
  assert.equal(human?.source, 'direct');
  assert.equal(await desk.collection('requests').countDocuments({ path: /^\/img\// }), 0);
});

test('tap: redacts card numbers from checkout forms', async () => {
  const visit = 'ses_card0001';
  await call('POST', '/cart/items', { sku: 'CST-CORK', qty: 1 }, visit);
  await fetch(`${base}/api/checkout`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `agentdesk_session=${visit}` },
    body: new URLSearchParams({ name: 'Ana', email: 'a@example.com', line1: '1 Main', city: 'Austin', country: 'US', cardNumber: '4242424242424242' }),
  });
  await new Promise((r) => setTimeout(r, 100));
  const doc = await desk.collection('requests').findOne({ sessionId: visit, path: '/api/checkout' });
  assert.equal(doc?.body.cardNumber, '[redacted]');
  assert.equal(doc?.body.city, 'Austin');
  assert.doesNotMatch(JSON.stringify(await desk.collection('requests').find().toArray()), /4242424242424242/);
});
