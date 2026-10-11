import { DESK_DB, mongoClient } from '../contract/db';
import { createApp } from './app';
import { loadConfig } from './config';
import { ensureIndexes } from './db';
import { ensureTapIndexes } from './tap';

const config = loadConfig();
const client = await mongoClient();
const storeDb = client.db(config.storeDb);
const deskDb = client.db(DESK_DB);
await Promise.all([ensureIndexes(storeDb), ensureTapIndexes(deskDb)]);

const app = createApp({ storeDb, deskDb, siteId: config.siteId, siteUrl: config.siteUrl });
const server = app.listen(config.port, () => {
  console.log(`Harbor Goods on ${config.siteUrl} (store db: ${config.storeDb}, desk db: ${DESK_DB})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => client.close().then(() => process.exit(0))));
}
