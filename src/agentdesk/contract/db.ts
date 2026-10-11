import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { MongoClient, MongoServerError, type Collection, type Db, type Document } from "mongodb";
import type { AgentDeskConfig } from "./config.js";
import { chooseEmbedding } from "./embed.js";
import type {
  CapabilityDoc,
  EpisodeDoc,
  FeedbackDoc,
  IntentDoc,
  KnowledgeDoc,
  RequestDoc,
  RuleDoc,
  SettingsDoc,
} from "./types.js";

// Atlas client and collection names (CONTRACT sections 1 and 3).
// AgentDesk only ever touches its own database, never the host app's collections.

export const COLLECTIONS = {
  requests: "requests",
  episodes: "episodes",
  capabilities: "capabilities",
  knowledge: "knowledge",
  intents: "intents",
  rules: "rules",
  feedback: "feedback",
  settings: "settings",
} as const;

export interface Collections {
  requests: Collection<RequestDoc>;
  episodes: Collection<EpisodeDoc>;
  capabilities: Collection<CapabilityDoc>;
  knowledge: Collection<KnowledgeDoc>;
  intents: Collection<IntentDoc>;
  rules: Collection<RuleDoc>;
  feedback: Collection<FeedbackDoc>;
  settings: Collection<SettingsDoc>;
}

export function collections(db: Db): Collections {
  return {
    requests: db.collection<RequestDoc>(COLLECTIONS.requests),
    episodes: db.collection<EpisodeDoc>(COLLECTIONS.episodes),
    capabilities: db.collection<CapabilityDoc>(COLLECTIONS.capabilities),
    knowledge: db.collection<KnowledgeDoc>(COLLECTIONS.knowledge),
    intents: db.collection<IntentDoc>(COLLECTIONS.intents),
    rules: db.collection<RuleDoc>(COLLECTIONS.rules),
    feedback: db.collection<FeedbackDoc>(COLLECTIONS.feedback),
    settings: db.collection<SettingsDoc>(COLLECTIONS.settings),
  };
}

const clients = new Map<string, Promise<MongoClient>>();

/** One shared client per connection string, so every part reuses the same pool. */
export function connect(config: Pick<AgentDeskConfig, "mongoUri" | "dbName">): Promise<{ client: MongoClient; db: Db }> {
  let pending = clients.get(config.mongoUri);
  if (!pending) {
    pending = new MongoClient(config.mongoUri, { appName: "agentdesk", serverSelectionTimeoutMS: 10_000 }).connect();
    pending.catch(() => clients.delete(config.mongoUri));
    clients.set(config.mongoUri, pending);
  }
  return pending.then((client) => ({ client, db: client.db(config.dbName) }));
}

// Regular indexes. createIndex is idempotent, so this runs on every start.
const INDEXES: { collection: keyof Collections; key: Document; unique?: boolean }[] = [
  { collection: "requests", key: { requestId: 1 }, unique: true },
  { collection: "requests", key: { sessionId: 1, timestamp: 1 } },
  { collection: "requests", key: { siteId: 1, timestamp: -1 } },
  { collection: "episodes", key: { episodeId: 1 }, unique: true },
  { collection: "episodes", key: { sessionId: 1 }, unique: true },
  { collection: "episodes", key: { siteId: 1, outcome: 1, createdAt: -1 } },
  { collection: "capabilities", key: { capabilityId: 1 }, unique: true },
  { collection: "capabilities", key: { siteId: 1, name: 1 } },
  { collection: "capabilities", key: { siteId: 1, stage: 1 } },
  { collection: "knowledge", key: { knowledgeId: 1 }, unique: true },
  { collection: "knowledge", key: { siteId: 1, source: 1, intent: 1 } },
  { collection: "intents", key: { siteId: 1, name: 1 }, unique: true },
  { collection: "rules", key: { ruleId: 1 }, unique: true },
  { collection: "rules", key: { siteId: 1, status: 1 } },
  { collection: "feedback", key: { feedbackId: 1 }, unique: true },
];

// Vector indexes: one per embedded collection, with the filter fields each part queries by.
export const VECTOR_INDEX_NAME = "agentdesk_vector";
const VECTOR_FILTERS: Partial<Record<keyof Collections, string[]>> = {
  capabilities: ["siteId", "stage", "kind"],
  knowledge: ["siteId", "source", "intent"],
  intents: ["siteId"],
};

export interface BootstrapResult {
  settings: SettingsDoc;
  /** Only set the very first time, so the panel link is printed once. */
  adminToken: string | null;
  warnings: string[];
}

/** Bump when collections or regular indexes change; installs re-create them once. */
export const SCHEMA_VERSION = 1;

export async function bootstrap(db: Db, config: AgentDeskConfig): Promise<BootstrapResult> {
  const cols = collections(db);
  const warnings: string[] = [];

  // Fast path: this database was already set up for this schema version.
  const current = await cols.settings.findOne({ _id: "settings" });
  if (current?.schemaVersion === SCHEMA_VERSION) {
    const { settings, adminToken } = await ensureSettings(cols, config, current);
    if (settings.embedding.provider === "gemini" && config.voyageApiKey) {
      warnings.push("VOYAGE_API_KEY is set, but this database is locked to Gemini embeddings from its first start. Keeping Gemini.");
    }
    return { settings, adminToken, warnings };
  }

  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  await Promise.all(
    Object.values(COLLECTIONS)
      .filter((name) => !existing.has(name))
      .map((name) =>
        db.createCollection(name).catch((err) => {
          if (!(err instanceof MongoServerError && err.codeName === "NamespaceExists")) throw err;
        }),
      ),
  );

  // Index failures are warnings, not a reason to turn the desk off.
  const indexResults = await Promise.allSettled(
    INDEXES.map(({ collection, key, unique }) =>
      cols[collection].createIndex(key, unique ? { unique: true } : {}),
    ),
  );
  indexResults.forEach((r, i) => {
    if (r.status === "rejected") warnings.push(`index on ${INDEXES[i].collection} ${JSON.stringify(INDEXES[i].key)} not created: ${(r.reason as Error).message}`);
  });

  const { settings, adminToken } = await ensureSettings(cols, config, current);
  if (indexResults.every((r) => r.status === "fulfilled")) {
    await cols.settings.updateOne({ _id: "settings" }, { $set: { schemaVersion: SCHEMA_VERSION } });
  }
  if (settings.embedding.provider === "gemini" && config.voyageApiKey) {
    warnings.push(
      "VOYAGE_API_KEY is set, but this database is locked to Gemini embeddings from its first start. Keeping Gemini.",
    );
  }

  // Vector indexes build in the background (createContext starts them): search falls back to
  // in-process cosine until they are queryable, so they never slow down the first start.
  return { settings, adminToken, warnings };
}

async function ensureSettings(
  cols: Collections,
  config: AgentDeskConfig,
  found: SettingsDoc | null,
): Promise<{ settings: SettingsDoc; adminToken: string | null }> {
  if (found && config.resetAdminToken) {
    const adminToken = randomBytes(24).toString("base64url");
    const adminTokenHash = hashToken(adminToken);
    await cols.settings.updateOne({ _id: "settings" }, { $set: { adminTokenHash } });
    return { settings: { ...found, adminTokenHash }, adminToken };
  }
  if (found) return { settings: found, adminToken: null };

  const adminToken = randomBytes(24).toString("base64url");
  const now = new Date();
  const doc: SettingsDoc = {
    _id: "settings",
    siteId: config.siteId,
    adminTokenHash: hashToken(adminToken),
    installedAt: now,
    embedding: chooseEmbedding(config),
    createdAt: now,
  };
  try {
    await cols.settings.insertOne(doc);
    return { settings: doc, adminToken };
  } catch (err) {
    // Two processes started at once: the other one won, use its settings.
    if (err instanceof MongoServerError && err.code === 11000) {
      const winner = await cols.settings.findOne({ _id: "settings" });
      if (winner) return { settings: winner, adminToken: null };
    }
    throw err;
  }
}

export async function ensureVectorIndexes(cols: Collections, dims: number): Promise<string[]> {
  const warnings: string[] = [];
  await Promise.all((Object.entries(VECTOR_FILTERS) as [keyof Collections, string[]][]).map(async ([name, filters]) => {
    const col = cols[name] as unknown as Collection<Document>;
    try {
      const current = await col.listSearchIndexes(VECTOR_INDEX_NAME).toArray();
      if (current.length > 0) return;
      await col.createSearchIndex({
        name: VECTOR_INDEX_NAME,
        type: "vectorSearch",
        definition: {
          fields: [
            { type: "vector", path: "embedding", numDimensions: dims, similarity: "cosine" },
            ...filters.map((path) => ({ type: "filter", path })),
          ],
        },
      });
    } catch (err) {
      // Free-tier clusters cap search indexes. Search still works: it falls back to
      // in-process cosine similarity (contract/search.ts), which is fine at hackathon scale.
      warnings.push(`vector index on ${name} not created (${(err as Error).message}); using in-process search`);
    }
  }));
  return warnings;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** For the panel: constant-time check of an admin token against settings. */
export function verifyAdminToken(token: string | undefined | null, settings: Pick<SettingsDoc, "adminTokenHash">): boolean {
  if (!token) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(settings.adminTokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * A MongoClient on MONGODB_URI that shares AgentDesk's pool, for the host app's own data
 * (the demo store uses it for its `harbor` database).
 */
export async function mongoClient(uri = process.env.MONGODB_URI): Promise<MongoClient> {
  if (!uri) throw new Error("MONGODB_URI is missing. Add your Atlas connection string to .env.");
  return (await connect({ mongoUri: uri, dbName: "agentdesk" })).client;
}
