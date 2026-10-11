import { pathToFileURL } from 'node:url';
import type { Db } from 'mongodb';
import { SEED_COUPONS, STARTING_STOCK, seedProducts } from './catalog';
import { loadConfig } from './config';
import { mongoClient } from '../contract/db';
import { collections, ensureIndexes } from './db';

// Idempotent: products and coupons are replaced by _id; inventory is only created
// if missing, so re-seeding never wipes stock that carts have reserved.
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
