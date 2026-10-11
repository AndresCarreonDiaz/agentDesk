import express from "express";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDoorRouter } from "../src/agentdesk/door/index.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { fakeCtx } from "./fake-ctx.js";

// A real MCP client against /mcp inside a real Express host, with in-memory collections.
describe("/mcp", () => {
  const { ctx, cols } = fakeCtx();
  let base = "";
  let close: () => void;
  const text = (r: any) => (r.content as { text: string }[]).map((c) => c.text).join("\n");

  beforeAll(async () => {
    clearRuleCache();
    const app = express();
    app.use(createDoorRouter(ctx));
    app.use(express.json());
    app.get("/products", (req, res) => { res.json([{ sku: "MUG-BLUE", q: req.query.q ?? null }]); });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it("serves the five fixed tools, and one session id ties MCP calls, the episode and the tap together", async () => {
    const client = new Client({ name: "claude-code", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
    await client.connect(transport);
    const sessionId = transport.sessionId!;
    expect(sessionId).toMatch(/^ses_/);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["about", "ask", "do", "done", "list_actions"]);

    // Empty desk: about admits it knows nothing yet.
    const about = await client.callTool({ name: "about", arguments: {} });
    expect(text(about)).toContain("I don't know yet");

    // The Loop learns a read capability; it shows up as data, with no new MCP tool.
    const now = new Date();
    await cols.capabilities.insertOne({
      siteId: "test-site", createdAt: now, updatedAt: now, capabilityId: "cap_s", name: "search_products",
      description: "Search the catalog", kind: "read", stage: "proposed",
      inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      mappedRequests: [{ method: "GET", path: "/products", bodyTemplate: { q: "{{input.q}}" } }],
      sourceEpisodeId: "ep_x", sourceRequestId: "req_x", verifiedByEpisodeId: null, stats: { calls: 0, successes: 0 }, examples: [], embedding: [1, 0, 0],
    });
    expect((await client.listTools()).tools).toHaveLength(5);
    const list = await client.callTool({ name: "list_actions", arguments: {} });
    expect(text(list)).toContain("search_products");
    expect(text(list)).toContain("new: learned recently");

    const done1 = await client.callTool({ name: "do", arguments: { action: "search_products", input: { q: "blue mug" } } });
    expect(done1.isError).toBeFalsy();
    expect(text(done1)).toContain("MUG-BLUE");

    const refused = await client.callTool({ name: "do", arguments: { action: "teleport" } });
    expect(text(refused)).toContain("list_actions");

    await client.callTool({ name: "done", arguments: { goalSuccess: true, note: "found the blue mug" } });
    await new Promise((r) => setTimeout(r, 50));

    const episodes = cols.episodes.docs;
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ sessionId, agentFamily: "claude-code", goalSuccess: true, doneNote: "found the blue mug" });
    expect(episodes[0].turns.some((t: any) => t.capability === "search_products")).toBe(true);
    expect(cols.requests.docs).toMatchObject([{ source: "capability", sessionId, path: "/products", query: { q: "blue mug" }, status: 200 }]);
    expect(cols.capabilities.docs[0].stats).toEqual({ calls: 1, successes: 1 });

    await client.close();
  });

  it("teaches on GET", async () => {
    const res = await fetch(`${base}/mcp`);
    expect(res.status).toBe(405);
    expect((await res.json()).message).toContain("MCP endpoint");
  });
});
