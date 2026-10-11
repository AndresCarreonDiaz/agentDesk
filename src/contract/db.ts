import { MongoClient, type Db } from 'mongodb';
import type {
  CapabilityDoc,
  EpisodeDoc,
  FeedbackDoc,
  IntentDoc,
  KnowledgeDoc,
  RequestDoc,
  RuleDoc,
} from './types';

// Desk memory (CONTRACT.md) lives in its own database on the same Atlas Sandbox cluster.
// Host-site data (the demo store's catalog, carts, orders) lives in a separate database.
export const DESK_DB = process.env.MONGODB_DB_DESK ?? 'desk';

export const COLLECTIONS = {
  requests: 'requests',
  episodes: 'episodes',
  capabilities: 'capabilities',
  knowledge: 'knowledge',
  intents: 'intents',
  rules: 'rules',
  feedback: 'feedback',
} as const;

export function deskCollections(db: Db) {
  return {
    requests: db.collection<RequestDoc>(COLLECTIONS.requests),
    episodes: db.collection<EpisodeDoc>(COLLECTIONS.episodes),
    capabilities: db.collection<CapabilityDoc>(COLLECTIONS.capabilities),
    knowledge: db.collection<KnowledgeDoc>(COLLECTIONS.knowledge),
    intents: db.collection<IntentDoc>(COLLECTIONS.intents),
    rules: db.collection<RuleDoc>(COLLECTIONS.rules),
    feedback: db.collection<FeedbackDoc>(COLLECTIONS.feedback),
  };
}

let shared: Promise<MongoClient> | undefined;

// One client per process: every part shares the same pool to the Atlas Sandbox.
// Only MONGODB_URI is read, so data cannot silently land outside the sandbox.
export function mongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required (hackathon Atlas Sandbox). Copy .env.example to .env.');
  shared ??= new MongoClient(uri, { appName: 'agentdesk' }).connect();
  return shared;
}

export async function deskDb(): Promise<Db> {
  return (await mongoClient()).db(DESK_DB);
}
