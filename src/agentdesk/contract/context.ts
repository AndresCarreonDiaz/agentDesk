import type { Db, MongoClient } from "mongodb";
import { resolveConfig, type AgentDeskConfig, type AgentDeskOptions } from "./config.js";
import { bootstrap, collections, connect, ensureVectorIndexes, type Collections } from "./db.js";
import { createEmbedder, type Embedder } from "./embed.js";
import { createLlm, type Llm } from "./llm.js";
import type { SettingsDoc } from "./types.js";

// What every part's start function receives (CONTRACT section 1: startLoop(ctx), startPanel(ctx)).
// Parts get the database, the model and the embedder from here, never on their own.

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

export interface AgentDeskContext {
  config: AgentDeskConfig;
  client: MongoClient;
  db: Db;
  cols: Collections;
  settings: SettingsDoc;
  llm: Llm;
  embedder: Embedder;
  log: Logger;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(`[agentdesk] ${m}`),
  warn: (m) => console.warn(`[agentdesk] ${m}`),
  error: (m, err) => console.error(`[agentdesk] ${m}`, err ?? ""),
};

/**
 * Connects, bootstraps the database and builds the shared helpers.
 * Parts can call this directly in their own scripts and tests, with AGENTDESK_DB set to their own database.
 */
export async function createContext(
  options: AgentDeskOptions = {},
  log: Logger = consoleLogger,
): Promise<{ ctx: AgentDeskContext; adminToken: string | null }> {
  const config = resolveConfig(options);
  const { client, db } = await connect(config);
  const { settings, adminToken, warnings } = await bootstrap(db, config);
  for (const w of warnings) log.warn(w);
  const cols = collections(db);
  ensureVectorIndexes(cols, settings.embedding.dims)
    .then((ws) => ws.forEach((w) => log.warn(w)))
    .catch((err) => log.warn(`vector indexes: ${(err as Error).message}`));
  const ctx: AgentDeskContext = {
    config,
    client,
    db,
    cols,
    settings,
    llm: createLlm(config),
    embedder: createEmbedder(settings.embedding, config),
    log,
  };
  return { ctx, adminToken };
}
