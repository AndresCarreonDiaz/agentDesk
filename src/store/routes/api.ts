import { Router, type Request, type Response } from 'express';
import type { MongoClient } from 'mongodb';
import type { Collections } from '../db';
import { body, isForm, parseQty, requireString } from '../http';
import { shopperId } from '../session';
import * as store from '../store';
import type { CartDoc, OrderDoc } from '../types';

function cartJson(cart: CartDoc) {
  const { _id, shopperId: _sid, ...rest } = cart;
  return { id: _id || null, ...rest };
}

function orderJson(order: OrderDoc) {
  const { _id, shopperId: _sid, cartId: _cart, idempotencyKey: _key, ...rest } = order;
  return { id: _id, ...rest };
}

// Forms get a 303 back to a page; JSON callers get the resource. Same handler either way,
// so the AgentDesk tap sees one request shape per capability.
function reply(req: Request, res: Response, redirectTo: string, json: unknown, status = 200) {
  if (isForm(req)) return res.redirect(303, redirectTo);
  return res.status(status).json(json);
}

export function apiRouter(c: Collections, client: MongoClient) {
  const r = Router();

  r.get('/api/products', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ products: await store.listProducts(c, q) });
  });

  r.get('/api/products/:slug', async (req, res) => {
    res.json({ product: await store.getProduct(c, req.params.slug) });
  });

  r.get('/api/cart', async (_req, res) => {
    const sid = shopperId(res);
    const cart = (await store.findActiveCart(c, sid)) ?? store.emptyCartView(sid);
    res.json({ cart: cartJson(cart) });
  });

  // DEMO.md names POST /cart/items; /api/cart/items is the same capability.
  r.post(['/api/cart/items', '/cart/items'], async (req, res) => {
    const b = body(req);
    const sku = requireString(b.sku, 'sku');
    const qty = parseQty(b.qty, { min: 1, fallback: 1, form: isForm(req) });
    const cart = await store.addItem(c, shopperId(res), sku, qty);
    reply(req, res, '/cart', { cart: cartJson(cart) }, 201);
  });

  r.patch('/api/cart/items/:sku', async (req, res) => {
    const qty = parseQty(body(req).qty, { min: 0, form: isForm(req) });
    const cart = await store.setItemQty(c, shopperId(res), req.params.sku, qty);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.delete('/api/cart/items/:sku', async (req, res) => {
    const cart = await store.setItemQty(c, shopperId(res), req.params.sku, 0);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.post('/api/cart/coupon', async (req, res) => {
    const code = requireString(body(req).code, 'code');
    const cart = await store.applyCoupon(c, shopperId(res), code);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.delete('/api/cart/coupon', async (req, res) => {
    const cart = await store.removeCoupon(c, shopperId(res));
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.post('/api/checkout', async (req, res) => {
    const b = body(req);
    const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    const { order, replayed } = await store.checkout(c, client, shopperId(res), {
      shipping: obj(b.shipping),
      payment: obj(b.payment),
      // Retrying with the same key returns the same order instead of buying twice.
      idempotencyKey: req.get('idempotency-key') ?? null,
    });
    reply(req, res, `/orders/${order._id}`, { order: orderJson(order), replayed }, replayed ? 200 : 201);
  });

  r.get('/api/orders/:id', async (req, res) => {
    res.json({ order: orderJson(await store.getOrder(c, shopperId(res), req.params.id)) });
  });

  return r;
}
