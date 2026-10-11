import type { Db } from 'mongodb';
import type { CartDoc, CouponDoc, InventoryDoc, OrderDoc, ProductDoc } from './types';

export type Collections = ReturnType<typeof collections>;

export function collections(db: Db) {
  return {
    products: db.collection<ProductDoc>('products'),
    inventory: db.collection<InventoryDoc>('inventory'),
    carts: db.collection<CartDoc>('carts'),
    coupons: db.collection<CouponDoc>('coupons'),
    orders: db.collection<OrderDoc>('orders'),
  };
}

export async function ensureIndexes(db: Db) {
  const c = collections(db);
  await Promise.all([
    c.products.createIndex({ slug: 1 }, { unique: true }),
    c.products.createIndex({ 'variants.sku': 1 }, { unique: true }),
    c.products.createIndex({ tags: 1 }),
    // One active cart per session; converted carts stay as history.
    c.carts.createIndex(
      { shopperId: 1 },
      { unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_cart_per_session' },
    ),
    c.carts.createIndex({ status: 1, updatedAt: 1 }),
    c.coupons.createIndex({ code: 1 }, { unique: true }),
    c.orders.createIndex({ shopperId: 1, createdAt: -1 }),
  ]);
}
