import './env';
import type { RequestHandler } from 'express';
import { mongoClient } from '../agentdesk/contract/db';
import { createApp } from './app';
import { loadConfig } from './config';
import { ensureIndexes } from './db';

const config = loadConfig();
const client = await mongoClient();
const storeDb = client.db(config.storeDb);
await ensureIndexes(storeDb);

// AgentDesk is the Door's package (src/agentdesk/index.ts). Until it lands, or with
// AGENTDESK=off, the store runs on its own. Once it exists this becomes a plain import.
type AgentDesk = () => RequestHandler;
async function loadAgentDesk(): Promise<AgentDesk | null> {
  if (!config.agentdesk) return null;
  const entry = '../agentdesk/index.ts';
  try {
    return ((await import(entry)) as { agentdesk: AgentDesk }).agentdesk;
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_MODULE_NOT_FOUND') return null;
    throw err;
  }
}
const agentdesk = await loadAgentDesk();

const app = createApp({
  storeDb,
  siteUrl: config.siteUrl,
  install: agentdesk ? (app) => app.use(agentdesk()) : undefined, // the one-line install
});

const server = app.listen(config.port, () => {
  console.log(`Harbor Goods on ${config.siteUrl} (store db: ${config.storeDb})`);
  console.log(agentdesk ? 'AgentDesk installed.' : 'AgentDesk not installed (package missing or AGENTDESK=off).');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => client.close().then(() => process.exit(0))));
}
