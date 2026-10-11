// Import this first: loads .env from the repo root before any module reads process.env.
try {
  process.loadEnvFile();
} catch {
  // no .env file; rely on the real environment
}
