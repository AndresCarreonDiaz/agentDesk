import { MongoClient, type Db } from 'mongodb';
import type {
  CapabilityDoc,
  EpisodeDoc,
  FeedbackDoc,
  IntentDoc,
  KnowledgeDoc,
  RequestDoc,
  RuleDoc,
  SettingsDoc,
} from './types';

// CONTRACT.md section 1: the desk uses its own database (default `agentdesk`) and never
// touches the host app's collections. Read lazily so a .env loaded at startup is honored.
export function agentdeskDbName(): string {
  return process.env.AGENTDESK_DB || 'agentdesk';
}

// Section 2: one install is one site; defaults to the database name.
export function siteIdFromEnv(): string {
  return process.env.AGENTDESK_SITE_ID || agentdeskDbName();
}

export const COLLECTIONS = {
  requests: 'requests',
  episodes: 'episodes',
  capabilities: 'capabilities',
  knowledge: 'knowledge',
  intents: 'intents',
  rules: 'rules',
  feedback: 'feedback',
  settings: 'settings',
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
    settings: db.collection<SettingsDoc>(COLLECTIONS.settings),
  };
}

let shared: Promise<MongoClient> | undefined;

// One client per process, shared by the host app and every part. Only MONGODB_URI is read,
// so data cannot silently land outside the hackathon Atlas Sandbox.
export function mongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required (hackathon Atlas Sandbox). Copy .env.example to .env.');
  shared ??= new MongoClient(uri, { appName: 'agentdesk' }).connect();
  return shared;
}

export async function agentdeskDb(): Promise<Db> {
  return (await mongoClient()).db(agentdeskDbName());
}
