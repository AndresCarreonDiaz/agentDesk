import { defineConfig } from "vitest/config";

// Door tests live in tests/ (vitest). The store's tests in src/**/test use node:test (npm run test:store).
export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });
