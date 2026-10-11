import { describe, expect, it } from "vitest";
import { clearAutopilotCache } from "../src/agentdesk/contract/autopilot.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { ask, listActions } from "../src/agentdesk/door/tools.js";
import { fakeCtx } from "./fake-ctx.js";

// Live finding: a bad Voyage key made every embedding fail, and ask crashed with desk_error.
// The desk must keep answering from what it learned when embeddings are down.
describe("when embeddings fail", () => {
  const { ctx, cols } = fakeCtx("s");
  (ctx as any).embedder = {
    embed: async () => { throw new Error("Voyage embeddings failed: HTTP 401"); },
    embedOne: async () => { throw new Error("Voyage embeddings failed: HTTP 401"); },
  };
  let seenPrompt = "";
  (ctx as any).llm = { provider: "gemini", model: "test", json: async () => ({}), text: async (req: { prompt: string }) => { seenPrompt = req.prompt; return "Yes, free shipping anywhere in the US."; } };

  it("ask reads the facts directly instead of crashing, including facts saved without vectors", async () => {
    cols.knowledge.docs = [
      { siteId: "s", createdAt: new Date(), knowledgeId: "kn_1", text: "Harbor Goods ships anywhere in the US for free.", source: "site_read", sourceRef: null, intent: null, confidence: 0.8, embedding: [] },
    ];
    const r = await ask(ctx, "Do you ship to Austin?");
    expect(r.unknown).toBeFalsy();
    expect(r.reply).toContain("free shipping");
    expect(seenPrompt).toContain("ships anywhere in the US");
  });

  it("list_actions still lists every offered action without ranking", async () => {
    clearRuleCache();
    clearAutopilotCache();
    cols.settings.docs = [{ _id: "settings", autopilot: true }];
    const now = new Date();
    const cap = (name: string) => ({
      siteId: "s", createdAt: now, updatedAt: now, capabilityId: `cap_${name}`, name, description: name, kind: "read", stage: "proposed",
      inputSchema: {}, mappedRequests: [{ method: "GET", path: `/${name}`, bodyTemplate: {} }], sourceEpisodeId: "ep", sourceRequestId: "req",
      verifiedByEpisodeId: null, stats: { calls: 0, successes: 0 }, examples: [], embedding: [],
    });
    cols.capabilities.docs = [cap("search_products"), cap("track_order")];
    const r = await listActions(ctx, "find a blue mug");
    expect((r.data as { actions: { name: string }[] }).actions.map((a) => a.name).sort()).toEqual(["search_products", "track_order"]);
  });
});
