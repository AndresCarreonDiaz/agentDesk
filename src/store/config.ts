// Loads .env from the repo root when present. Only MONGODB_URI is accepted: falling back to
// a host-injected MONGO_URL would move data off the hackathon Atlas Sandbox.
try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the real environment
}

export interface Config {
  mongoUri: string;
  storeDb: string;
  siteId: string;
  port: number;
  siteUrl: string;
}

export function loadConfig(): Config {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is required (hackathon Atlas Sandbox). Copy .env.example to .env.');
  }
  const port = Number(process.env.PORT ?? 3000);
  return {
    mongoUri,
    storeDb: process.env.MONGODB_DB_STORE ?? 'harbor',
    siteId: process.env.SITE_ID ?? 'demo-store',
    port,
    siteUrl: (process.env.SITE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  };
}
