import { Router, type Request, type Response } from 'express';
import type { Collections } from '../db';
import { body, isForm, parseQty, requireString } from '../http';
import { sessionId } from '../session';
import * as store from '../store';
import type { CartDoc } from '../types';

function cartJson(cart: CartDoc) {
  const { _id, sessionId: _sid, ...rest } = cart;
  return { id: _id || null, ...rest };
}

// Forms get a 303 back to a page; JSON callers get the resource. Same handler either way,
// so the AgentDesk tap sees one request shape per capability.
function reply(req: Request, res: Response, redirectTo: string, json: unknown, status = 200) {
  if (isForm(req)) return res.redirect(303, redirectTo);
  return res.status(status).json(json);
}

export function apiRouter(c: Collections) {
  const r = Router();

  r.get('/api/products', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    res.json({ products: await store.listProducts(c, q) });
  });

  r.get('/api/products/:slug', async (req, res) => {
    res.json({ product: await store.getProduct(c, req.params.slug) });
  });

  r.get('/api/cart', async (_req, res) => {
    const sid = sessionId(res);
    const cart = (await store.findActiveCart(c, sid)) ?? store.emptyCartView(sid);
    res.json({ cart: cartJson(cart) });
  });

  // DEMO.md names POST /cart/items; /api/cart/items is the same capability.
  r.post(['/api/cart/items', '/cart/items'], async (req, res) => {
    const b = body(req);
    const sku = requireString(b.sku, 'sku');
    const qty = parseQty(b.qty, { min: 1, fallback: 1 });
    const cart = await store.addItem(c, sessionId(res), sku, qty);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.patch('/api/cart/items/:sku', async (req, res) => {
    const qty = parseQty(body(req).qty, { min: 0 });
    const cart = await store.setItemQty(c, sessionId(res), req.params.sku, qty);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.delete('/api/cart/items/:sku', async (req, res) => {
    const cart = await store.setItemQty(c, sessionId(res), req.params.sku, 0);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.post('/api/cart/coupon', async (req, res) => {
    const code = requireString(body(req).code, 'code');
    const cart = await store.applyCoupon(c, sessionId(res), code);
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.delete('/api/cart/coupon', async (req, res) => {
    const cart = await store.removeCoupon(c, sessionId(res));
    reply(req, res, '/cart', { cart: cartJson(cart) });
  });

  r.post('/api/checkout', async (req, res) => {
    const b = body(req);
    // JSON sends { shipping, payment }; the HTML form posts flat fields.
    const input: store.CheckoutInput = isForm(req)
      ? {
          shipping: b,
          payment: { method: 'demo', last4: typeof b.cardNumber === 'string' ? b.cardNumber : '' },
        }
      : {
          shipping: (b.shipping ?? {}) as store.CheckoutInput['shipping'],
          payment: (b.payment ?? {}) as store.CheckoutInput['payment'],
        };
    const order = await store.checkout(c, sessionId(res), input);
    const { _id, sessionId: _sid, cartId: _cart, ...rest } = order;
    reply(req, res, `/orders/${_id}`, { order: { id: _id, ...rest } }, 201);
  });

  r.get('/api/orders/:id', async (req, res) => {
    const { _id, sessionId: _sid, cartId: _cart, ...rest } = await store.getOrder(c, sessionId(res), req.params.id);
    res.json({ order: { id: _id, ...rest } });
  });

  return r;
}
