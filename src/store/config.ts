// Only MONGODB_URI is accepted: falling back to a host-injected MONGO_URL would move data
// off the hackathon Atlas Sandbox. .env is loaded by ./env, imported first by entry points.

export interface Config {
  mongoUri: string;
  storeDb: string;
  port: number;
  agentdesk: boolean;
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
    port,
    // AGENTDESK=off runs the bare store (the "before" shot in the demo).
    agentdesk: process.env.AGENTDESK !== 'off',
    siteUrl: (process.env.SITE_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
  };
}
