import './env';
import { pathToFileURL } from 'node:url';
import type { Db } from 'mongodb';
import { SEED_COUPONS, STARTING_STOCK, seedProducts } from './catalog';
import { loadConfig } from './config';
import { mongoClient } from '../agentdesk/contract/db';
import { collections, ensureIndexes } from './db';

// Idempotent: products and coupons are replaced by _id. Inventory is created if missing and
// topped back up to STARTING_STOCK available, so carts left behind by rehearsal visits
// (stock they reserved is never released) cannot run the demo out of blue mugs.
// Reserved and sold counts are kept.
export async function seedDatabase(db: Db) {
  const c = collections(db);
  await ensureIndexes(db);
  const products = seedProducts();
  await c.products.bulkWrite(
    products.map((p) => ({ replaceOne: { filter: { _id: p._id }, replacement: p, upsert: true } })),
  );
  await c.inventory.bulkWrite(
    products.flatMap((p) =>
      p.variants.map((v) => ({
        updateOne: {
          filter: { _id: v.sku },
          update: { $setOnInsert: { productId: p._id, available: STARTING_STOCK, reserved: 0, sold: 0 } },
          upsert: true,
        },
      })),
    ),
  );
  await c.inventory.updateMany(
    { _id: { $in: products.flatMap((p) => p.variants.map((v) => v.sku)) }, available: { $lt: STARTING_STOCK } },
    { $set: { available: STARTING_STOCK } },
  );
  await c.coupons.bulkWrite(
    SEED_COUPONS.map((cp) => ({ replaceOne: { filter: { _id: cp._id }, replacement: cp, upsert: true } })),
  );
  return {
    products: await c.products.countDocuments(),
    inventory: await c.inventory.countDocuments(),
    coupons: await c.coupons.countDocuments(),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = loadConfig();
  const client = await mongoClient();
  try {
    console.log(`Seeded ${config.storeDb}:`, await seedDatabase(client.db(config.storeDb)));
  } finally {
    await client.close();
  }
}
