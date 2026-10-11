import { MongoServerError } from 'mongodb';
import type { Collections } from './db';
import { HttpError } from './errors';
import { newId } from './ids';
import { computeSummary } from './money';
import type { CartDoc, CartLine, OrderDoc, ProductDoc, Shipping, Variant } from './types';

export interface PublicVariant extends Variant {
  available: number;
}

export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  images: ProductDoc['images'];
  featured: boolean;
  variants: PublicVariant[];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function withStock(c: Collections, products: ProductDoc[]): Promise<PublicProduct[]> {
  const skus = products.flatMap((p) => p.variants.map((v) => v.sku));
  const stock = await c.inventory.find({ _id: { $in: skus } }).toArray();
  const available = new Map(stock.map((s) => [s._id, s.available]));
  return products.map((p) => ({
    id: p._id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    category: p.category,
    tags: p.tags,
    images: p.images,
    featured: p.featured,
    variants: p.variants.map((v) => ({ ...v, available: available.get(v.sku) ?? 0 })),
  }));
}

export async function listProducts(c: Collections, q?: string, featuredOnly = false): Promise<PublicProduct[]> {
  const filter: Record<string, unknown> = { active: true };
  if (featuredOnly) filter.featured = true;
  const query = q?.trim();
  if (query) {
    const re = new RegExp(escapeRegex(query), 'i');
    filter.$or = [{ name: re }, { tags: re }, { 'variants.color': re }, { 'variants.sku': re }, { category: re }];
  }
  const products = await c.products.find(filter).sort({ featured: -1, name: 1 }).toArray();
  return withStock(c, products);
}

export async function getProduct(c: Collections, slug: string): Promise<PublicProduct> {
  const product = await c.products.findOne({ slug, active: true });
  if (!product) throw new HttpError(404, 'not_found', `No product with slug "${slug}".`);
  return (await withStock(c, [product]))[0];
}

// ---- inventory ----

async function reserve(c: Collections, sku: string, qty: number) {
  const res = await c.inventory.updateOne(
    { _id: sku, available: { $gte: qty } },
    { $inc: { available: -qty, reserved: qty } },
  );
  if (res.matchedCount === 0) throw new HttpError(409, 'out_of_stock', `Not enough stock for ${sku}.`);
}

async function release(c: Collections, sku: string, qty: number) {
  await c.inventory.updateOne({ _id: sku }, { $inc: { available: qty, reserved: -qty } });
}

// ---- cart ----

export function emptyCartView(sessionId: string): CartDoc {
  const now = new Date();
  return {
    _id: '',
    sessionId,
    status: 'active',
    items: [],
    coupon: null,
    summary: computeSummary([], null),
    createdAt: now,
    updatedAt: now,
  };
}

export async function findActiveCart(c: Collections, sessionId: string) {
  return c.carts.findOne({ sessionId, status: 'active' });
}

async function getOrCreateCart(c: Collections, sessionId: string): Promise<CartDoc> {
  const now = new Date();
  const upsert = () =>
    c.carts.findOneAndUpdate(
      { sessionId, status: 'active' },
      {
        $setOnInsert: {
          _id: newId('cart'),
          items: [],
          coupon: null,
          summary: computeSummary([], null),
          createdAt: now,
          updatedAt: now,
        },
      },
      { upsert: true, returnDocument: 'after' },
    );
  try {
    return (await upsert())!;
  } catch (err) {
    // Two concurrent first requests: the unique partial index lets one win; read it.
    if (err instanceof MongoServerError && err.code === 11000) return (await upsert())!;
    throw err;
  }
}

async function recalc(c: Collections, cartId: string): Promise<CartDoc> {
  const cart = await c.carts.findOne({ _id: cartId });
  if (!cart) throw new HttpError(404, 'not_found', 'Cart not found.');
  const summary = computeSummary(cart.items, cart.coupon);
  await c.carts.updateOne({ _id: cartId }, { $set: { summary, updatedAt: new Date() } });
  return { ...cart, summary };
}

async function findVariant(c: Collections, sku: string): Promise<{ product: ProductDoc; variant: Variant }> {
  const product = await c.products.findOne({ 'variants.sku': sku, active: true });
  const variant = product?.variants.find((v) => v.sku === sku);
  if (!product || !variant) throw new HttpError(404, 'not_found', `Unknown sku "${sku}".`);
  return { product, variant };
}

export async function addItem(c: Collections, sessionId: string, sku: string, qty: number): Promise<CartDoc> {
  const { product, variant } = await findVariant(c, sku);
  const cart = await getOrCreateCart(c, sessionId);
  await reserve(c, sku, qty);

  const now = new Date();
  const bumped = await c.carts.updateOne(
    { _id: cart._id, status: 'active', 'items.sku': sku },
    { $inc: { 'items.$.qty': qty }, $set: { updatedAt: now } },
  );
  if (bumped.matchedCount === 0) {
    const line: CartLine = {
      sku,
      productId: product._id,
      slug: product.slug,
      name: product.name,
      variantLabel: variant.label,
      imageUrl: variant.imageUrl,
      qty,
      unitPriceCents: variant.priceCents,
    };
    const pushed = await c.carts.updateOne(
      { _id: cart._id, status: 'active', 'items.sku': { $ne: sku } },
      { $push: { items: line }, $set: { updatedAt: now } },
    );
    if (pushed.matchedCount === 0) {
      await release(c, sku, qty);
      throw new HttpError(409, 'conflict', 'Cart changed while adding; try again.');
    }
  }
  return recalc(c, cart._id);
}

export async function setItemQty(c: Collections, sessionId: string, sku: string, qty: number): Promise<CartDoc> {
  const cart = await findActiveCart(c, sessionId);
  const line = cart?.items.find((l) => l.sku === sku);
  if (!cart || !line) throw new HttpError(404, 'not_found', `${sku} is not in the cart.`);

  const delta = qty - line.qty;
  if (delta > 0) await reserve(c, sku, delta);

  // Guard on the qty we read so a concurrent change cannot be overwritten.
  const guard = { _id: cart._id, status: 'active' as const, items: { $elemMatch: { sku, qty: line.qty } } };
  const res =
    qty === 0
      ? await c.carts.updateOne(guard, { $pull: { items: { sku } }, $set: { updatedAt: new Date() } })
      : await c.carts.updateOne(guard, { $set: { 'items.$.qty': qty, updatedAt: new Date() } });
  if (res.matchedCount === 0) {
    if (delta > 0) await release(c, sku, delta);
    throw new HttpError(409, 'conflict', 'Cart changed while updating; try again.');
  }
  if (delta < 0) await release(c, sku, -delta);
  return recalc(c, cart._id);
}

export async function applyCoupon(c: Collections, sessionId: string, rawCode: string): Promise<CartDoc> {
  const code = rawCode.trim().toUpperCase();
  const coupon = code ? await c.coupons.findOne({ _id: code, active: true }) : null;
  if (!coupon) throw new HttpError(400, 'invalid_coupon', `Coupon "${rawCode}" is not valid.`);
  const cart = await getOrCreateCart(c, sessionId);
  await c.carts.updateOne(
    { _id: cart._id },
    { $set: { coupon: { code: coupon.code, percentOff: coupon.percentOff }, updatedAt: new Date() } },
  );
  return recalc(c, cart._id);
}

export async function removeCoupon(c: Collections, sessionId: string): Promise<CartDoc> {
  const cart = await findActiveCart(c, sessionId);
  if (!cart) return emptyCartView(sessionId);
  await c.carts.updateOne({ _id: cart._id }, { $set: { coupon: null, updatedAt: new Date() } });
  return recalc(c, cart._id);
}

// ---- checkout ----

const REQUIRED_SHIPPING = ['name', 'email', 'line1', 'city', 'country'] as const;

export interface CheckoutInput {
  shipping: Partial<Record<keyof Shipping, unknown>>;
  payment: { method?: unknown; last4?: unknown };
}

export async function checkout(c: Collections, sessionId: string, input: CheckoutInput): Promise<OrderDoc> {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const shipping: Shipping = {
    name: str(input.shipping.name),
    email: str(input.shipping.email),
    line1: str(input.shipping.line1),
    city: str(input.shipping.city),
    region: str(input.shipping.region),
    postal: str(input.shipping.postal),
    country: str(input.shipping.country) || 'US',
  };
  const missing = REQUIRED_SHIPPING.filter((k) => !shipping[k]);
  if (missing.length) {
    throw new HttpError(400, 'invalid_shipping', `Missing shipping fields: ${missing.join(', ')}.`);
  }
  if (input.payment.method !== 'demo') {
    throw new HttpError(400, 'bad_request', 'Only payment.method "demo" is accepted. This store takes no real payments.');
  }
  const last4 = str(input.payment.last4).replace(/\D/g, '').slice(-4) || '4242';

  // Flip the cart first: this is the one atomic step that stops a double checkout.
  const orderId = newId('ord', 5);
  const cart = await c.carts.findOneAndUpdate(
    { sessionId, status: 'active', 'items.0': { $exists: true } },
    { $set: { status: 'converted', orderId, updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!cart) throw new HttpError(400, 'empty_cart', 'The cart is empty.');

  await c.inventory.bulkWrite(
    cart.items.map((l) => ({
      updateOne: { filter: { _id: l.sku }, update: { $inc: { reserved: -l.qty, sold: l.qty } } },
    })),
  );

  const order: OrderDoc = {
    _id: orderId,
    sessionId,
    cartId: cart._id,
    status: 'paid',
    items: cart.items.map(({ sku, slug, name, variantLabel, qty, unitPriceCents }) => ({
      sku,
      slug,
      name,
      variantLabel,
      qty,
      unitPriceCents,
    })),
    summary: computeSummary(cart.items, cart.coupon),
    couponCode: cart.coupon?.code ?? null,
    shipping,
    payment: { method: 'demo', last4, transactionId: newId('demo') },
    createdAt: new Date(),
  };
  await c.orders.insertOne(order);
  return order;
}

export async function getOrder(c: Collections, sessionId: string, id: string): Promise<OrderDoc> {
  const order = await c.orders.findOne({ _id: id, sessionId });
  if (!order) throw new HttpError(404, 'not_found', 'Order not found.');
  return order;
}
