import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../src/agentdesk/contract/config.js";
import { VOYAGE_EMBEDDING, createEmbedder } from "../src/agentdesk/contract/embed.js";

// Atlas-issued Voyage keys only work on ai.mongodb.com; voyageai.com keys only on api.voyageai.com.
describe("Voyage endpoint", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = resolveConfig({ env: { MONGODB_URI: "mongodb://x", GEMINI_API_KEY: "g", VOYAGE_API_KEY: "v" } });
  const ok = (n: number) => new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: [i, 1] })) }), { status: 200 });

  it("uses Atlas first and keeps using it", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(new URL(url).host); return ok(1); }));
    const e = createEmbedder(VOYAGE_EMBEDDING, config);
    await e.embed(["a"], "query");
    await e.embed(["b"], "document");
    expect(calls).toEqual(["ai.mongodb.com", "ai.mongodb.com"]);
  });

  it("switches to api.voyageai.com once on an auth error, then remembers", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const host = new URL(url).host;
      calls.push(host);
      return host === "ai.mongodb.com" ? new Response("unauthorized", { status: 401 }) : ok(2);
    }));
    const e = createEmbedder(VOYAGE_EMBEDDING, config);
    expect(await e.embed(["a", "b"], "document")).toEqual([[0, 1], [1, 1]]);
    await e.embed(["c", "d"], "query");
    expect(calls).toEqual(["ai.mongodb.com", "api.voyageai.com", "api.voyageai.com"]);
  });

  it("does not hop endpoints on a bad request", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(new URL(url).host); return new Response("bad model", { status: 400 }); }));
    const e = createEmbedder(VOYAGE_EMBEDDING, config);
    await expect(e.embed(["a"], "query")).rejects.toThrow(/HTTP 400/);
    expect(calls).toEqual(["ai.mongodb.com"]);
  });
});
