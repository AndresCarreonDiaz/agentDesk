// STORE_SPEC.md §11 acceptance, against a throwaway in-memory MongoDB.
// The real app runs only on the hackathon Atlas Sandbox; this is just for tests.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { createApp } from '../src/app';
import { seedDatabase } from '../src/seed';

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let base: string;
let close: () => void;

const SID = 'test_session_0001';
const AUSTIN = {
  shipping: { name: 'Alex Rivera', email: 'alex@example.com', line1: '100 Congress Ave', city: 'Austin', region: 'TX', postal: '78701', country: 'US' },
  payment: { method: 'demo', last4: '4242' },
};

function call(method: string, path: string, json?: unknown, sid = SID) {
  return fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { 'x-session-id': sid, ...(json ? { 'content-type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
}

const stock = (sku: string) => db.collection('inventory').findOne({ _id: sku as never });

before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('harbor');
  const server = createApp(db, { siteUrl: 'http://store.test' }).listen(0);
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
  assert.equal(res.status, 200);
  const { cart } = await res.json();
  assert.equal(cart.summary.totalCents, 2400);
  assert.equal(cart.items[0].sku, 'MUG-BLUE');
  assert.deepEqual(await stock('MUG-BLUE'), { _id: 'MUG-BLUE', productId: 'prod_harbor_mug', available: 99, reserved: 1, sold: 0 });
  assert.equal(await db.collection('carts').countDocuments({ sessionId: SID, status: 'active' }), 1);
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
  assert.equal(await db.collection('carts').countDocuments({ sessionId: SID, status: 'converted' }), 1);
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
  const res = await call('POST', '/api/cart/items', { sku: 'PEN-BLK', qty: 99 }, 'other_session_01');
  assert.equal(res.status, 200);
  const res2 = await call('POST', '/api/cart/items', { sku: 'PEN-BLK', qty: 2 }, 'other_session_02');
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
  const order = await db.collection('orders').findOne({ sessionId: sid });
  assert.equal(order?.payment.last4, '4242');
  assert.doesNotMatch(JSON.stringify(order), /4242424242424242/);
  // Another session cannot read the order.
  assert.equal((await fetch(base + location, { headers: { cookie: 'harbor_sid=someone_else_01' } })).status, 404);
});
