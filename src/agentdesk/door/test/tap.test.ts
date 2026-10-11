import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient, type Db } from 'mongodb';
import { ensureTapIndexes, tap } from '../tap';

let mongo: MongoMemoryServer;
let client: MongoClient;
let db: Db;
let base: string;
let close: () => void;

before(async () => {
  mongo = await MongoMemoryServer.create();
  client = await MongoClient.connect(mongo.getUri());
  db = client.db('agentdesk_test');
  await ensureTapIndexes(db);
  // A stand-in host app: just enough routes to be tapped.
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(tap(db, 'demo-store'));
  app.post('/cart/items', (_req, res) => res.status(201).json({ ok: true }));
  app.post('/api/checkout', (_req, res) => res.status(201).json({ ok: true }));
  app.get('/products', (_req, res) => res.send('<h1>Products</h1>'));
  app.get('/img/:file', (_req, res) => res.send('svg'));
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});

after(async () => {
  close();
  await client.close();
  await mongo.stop();
});

const settle = () => new Promise((r) => setTimeout(r, 100)); // the tap writes after the response

test('writes contract-shaped requests', async () => {
  await db.collection('episodes').insertOne({ episodeId: 'ep_tap0001', sessionId: 'ses_tap0001', siteId: 'demo-store' });
  const res = await fetch(`${base}/cart/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agentdesk-session': 'ses_tap0001' },
    body: JSON.stringify({ sku: 'MUG-BLUE', qty: 1 }),
  });
  const requestId = res.headers.get('x-agentdesk-request');
  assert.match(requestId ?? '', /^req_/);
  await fetch(`${base}/cart/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agentdesk-session': 'ses_tap0001', 'x-agentdesk-source': 'capability' },
    body: JSON.stringify({ sku: 'MUG-BLUE', qty: 1 }),
  });
  await fetch(`${base}/products?q=blue%20mug`); // a human
  await fetch(`${base}/img/mug-blue.svg`); // not recorded
  await settle();

  const doc = await db.collection('requests').findOne({ requestId }, { projection: { _id: 0 } });
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

  const sources = await db.collection('requests').find({ sessionId: 'ses_tap0001' }).map((d) => d.source).toArray();
  assert.deepEqual(sources.sort(), ['capability', 'fallback']);
  const human = await db.collection('requests').findOne({ path: '/products' });
  assert.equal(human?.sessionId, null);
  assert.equal(human?.source, 'direct');
  assert.equal(await db.collection('requests').countDocuments({ path: /^\/img\// }), 0);
});

test('reads the session from the cookie and redacts card numbers', async () => {
  await fetch(`${base}/api/checkout`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'agentdesk_session=ses_card0001' },
    body: new URLSearchParams({ 'shipping.city': 'Austin', 'payment.cardNumber': '4242424242424242' }),
  });
  await settle();
  const doc = await db.collection('requests').findOne({ sessionId: 'ses_card0001' });
  assert.equal(doc?.body['payment.cardNumber'], '[redacted]');
  assert.equal(doc?.body['shipping.city'], 'Austin');
  assert.doesNotMatch(JSON.stringify(await db.collection('requests').find().toArray()), /4242424242424242/);
});
