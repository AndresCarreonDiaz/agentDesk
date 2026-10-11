// Local-only run with a throwaway in-memory MongoDB (a one-node replica set, so checkout
// transactions work). Nothing persists. The demo and judging must use the Atlas Sandbox
// via `npm run dev` / `npm start`.
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = mongo.getUri();
console.log('[dev:local] in-memory MongoDB, data is lost on exit. NOT the Atlas Sandbox.');

const { mongoClient } = await import('../contract/db');
const { loadConfig } = await import('./config');
const { seedDatabase } = await import('./seed');
const config = loadConfig();
console.log('[dev:local] seeded', await seedDatabase((await mongoClient()).db(config.storeDb)));
await import('./index');

process.on('exit', () => void mongo.stop());
