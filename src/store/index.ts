import { createApp } from './app';
import { loadConfig } from './config';
import { connect, ensureIndexes } from './db';

const config = loadConfig();
const { client, db } = await connect(config.mongoUri, config.dbName);
await ensureIndexes(db);

const server = createApp(db, { siteUrl: config.siteUrl }).listen(config.port, () => {
  console.log(`Harbor Goods on ${config.siteUrl} (db: ${config.dbName})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => client.close().then(() => process.exit(0))));
}
