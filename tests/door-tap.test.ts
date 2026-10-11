import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AgentDeskConfigError, resolveConfig } from "../src/agentdesk/contract/config.js";
import type { AgentDeskContext } from "../src/agentdesk/contract/context.js";
import { newId } from "../src/agentdesk/contract/ids.js";
import { isOffered, type RequestDoc, type RuleDoc } from "../src/agentdesk/contract/types.js";
import { bodyShape, redact } from "../src/agentdesk/door/redact.js";
import { clearRuleCache, matchesRequest, pathMatches } from "../src/agentdesk/door/rules.js";
import { REPLAY_HEADER, REPLAY_SECRET, rememberEpisode, sessionFromHeaders } from "../src/agentdesk/door/sessions.js";
import { createTap } from "../src/agentdesk/door/tap.js";

describe("redact and bodyShape", () => {
  it("keeps the shape, hides secrets and card numbers", () => {
    const body = { sku: "MUG-BLUE", qty: 1, password: "hunter2", card: { number: "4242 4242 4242 4242" }, note: "4242424242424242" };
    expect(bodyShape(body)).toEqual({ sku: "string", qty: "number", password: "string", card: "object", note: "string" });
    expect(redact(body)).toEqual({ sku: "MUG-BLUE", qty: 1, password: "[redacted]", card: "[redacted]", note: "[redacted]" });
  });

  it("does not redact ordinary numbers that fail the card check", () => {
    expect(redact({ orderRef: "1234567890123" })).toEqual({ orderRef: "1234567890123" });
  });
});

describe("rule matching", () => {
  it("matches paths with params and wildcards", () => {
    expect(pathMatches("/cart/items", "/cart/items/")).toBe(true);
    expect(pathMatches("/quote/:id/submit", "/quote/q_1/submit")).toBe(true);
    expect(pathMatches("/quote/:id/submit", "/quote/submit")).toBe(false);
    expect(pathMatches("/admin/*", "/admin/users/1")).toBe(true);
    expect(pathMatches("/cart", "/cart/items")).toBe(false);
  });

  it("needs every field it sets, and never matches an empty match", () => {
    const req = { method: "POST", path: "/cart/discount", body: { code: "SAVE10" } };
    expect(matchesRequest({ method: "post", path: "/cart/discount" }, req)).toBe(true);
    expect(matchesRequest({ bodyField: "code" }, req)).toBe(true);
    expect(matchesRequest({ method: "GET", path: "/cart/discount" }, req)).toBe(false);
    expect(matchesRequest({}, req)).toBe(false);
    expect(matchesRequest(undefined, req)).toBe(false);
  });
});

describe("sessions and offers", () => {
  it("reads the session from the header first, then the cookie, and rejects junk", () => {
    expect(sessionFromHeaders({ "x-agentdesk-session": "ses_abcdef0123456789" })).toBe("ses_abcdef0123456789");
    expect(sessionFromHeaders({ cookie: "a=1; agentdesk_session=ses_0011223344556677" })).toBe("ses_0011223344556677");
    expect(sessionFromHeaders({ "x-agentdesk-session": "'; drop" })).toBeNull();
  });

  it("offers writes only when approved", () => {
    expect(isOffered({ kind: "write", stage: "verified" })).toBe(false);
    expect(isOffered({ kind: "write", stage: "approved" })).toBe(true);
    expect(isOffered({ kind: "read", stage: "proposed" })).toBe(true);
    expect(isOffered({ kind: "read", stage: "observed" })).toBe(false);
    expect(isOffered({ kind: "read", stage: "blocked" })).toBe(false);
  });
});

describe("resolveConfig", () => {
  it("turns off cleanly without MONGODB_URI or an LLM key", () => {
    expect(() => resolveConfig({ env: { GEMINI_API_KEY: "x" } })).toThrow(AgentDeskConfigError);
    expect(() => resolveConfig({ env: { MONGODB_URI: "mongodb://x" } })).toThrow(/LLM key/);
  });

  it("defaults to Gemini, its own database, and siteId = database", () => {
    const c = resolveConfig({ env: { MONGODB_URI: "mongodb://x", GEMINI_API_KEY: "g", AGENTDESK_DB: "agentdesk_test" } });
    expect(c.llm).toMatchObject({ provider: "gemini", model: "gemini-3.8-flash" });
    expect(c.dbName).toBe("agentdesk_test");
    expect(c.siteId).toBe("agentdesk_test");
    expect(c.panelPath).toBe("/agentdesk");
  });
});

// The tap inside a real Express host, with in-memory collections.
describe("tap in a host app", () => {
  const inserted: RequestDoc[] = [];
  let rules: RuleDoc[] = [];
  let base = "";
  let close: () => void;

  const ctx = {
    config: { siteId: "test-site", panelPath: "/agentdesk" },
    cols: {
      requests: { insertOne: async (d: RequestDoc) => { inserted.push(d); } },
      episodes: { findOne: async () => null },
      rules: { find: () => ({ toArray: async () => rules }) },
    },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as AgentDeskContext;

  beforeAll(async () => {
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent", "/mcp", "/agentdesk"] })); // installed before the host's parser
    app.use(express.json());
    app.get("/products", (_req, res) => { res.json([{ sku: "MUG-BLUE" }]); });
    app.post("/cart/items", (req, res) => { res.status(201).json({ ok: true, got: req.body }); });
    app.post("/cart/discount", (_req, res) => { res.json({ ok: true }); });
    app.post("/agent", (_req, res) => { res.json({ desk: true }); });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());
  beforeEach(() => {
    inserted.length = 0;
    rules = [];
    clearRuleCache();
  });

  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("records human traffic as direct, with no session", async () => {
    await fetch(`${base}/products?q=blue%20mug`);
    await settle();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ source: "direct", sessionId: null, method: "GET", path: "/products", query: { q: "blue mug" }, status: 200, siteId: "test-site" });
    expect(inserted[0].requestId).toMatch(/^req_/);
  });

  it("records an agent fallback with session, episode, body and shape; the host still parses the body", async () => {
    const sessionId = newId("ses");
    rememberEpisode(sessionId, "ep_test01");
    const res = await fetch(`${base}/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `agentdesk_session=${sessionId}` },
      body: JSON.stringify({ sku: "MUG-BLUE", qty: 1 }),
    });
    expect(await res.json()).toEqual({ ok: true, got: { sku: "MUG-BLUE", qty: 1 } });
    await settle();
    expect(inserted[0]).toMatchObject({
      source: "fallback", sessionId, episodeId: "ep_test01", status: 201,
      body: { sku: "MUG-BLUE", qty: 1 }, bodyShape: { sku: "string", qty: "number" },
    });
  });

  it("marks Door replays as capability only with the secret", async () => {
    await fetch(`${base}/products`, { headers: { [REPLAY_HEADER]: REPLAY_SECRET } });
    await fetch(`${base}/products`, { headers: { [REPLAY_HEADER]: "guess" } });
    await settle();
    expect(inserted.map((r) => r.source)).toEqual(["capability", "direct"]);
  });

  it("skips the desk's own paths", async () => {
    await fetch(`${base}/agent`, { method: "POST" });
    await settle();
    expect(inserted).toHaveLength(0);
  });

  it("refuses an agent fallback that matches an active rule, logs it as 403, and leaves humans alone", async () => {
    rules = [{
      siteId: "test-site", createdAt: new Date(), ruleId: "rule_1", text: "agents may not apply discount codes",
      compiled: { action: "block", match: { method: "POST", path: "/cart/discount" } },
      source: "developer", status: "active", evidence: [], enabled: true,
    }];
    const agent = await fetch(`${base}/cart/discount`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentdesk-session": newId("ses") },
      body: JSON.stringify({ code: "SAVE10" }),
    });
    expect(agent.status).toBe(403);
    expect(await agent.json()).toMatchObject({ error: "blocked_by_rule", rule: "agents may not apply discount codes" });

    const human = await fetch(`${base}/cart/discount`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(human.status).toBe(200);
    await settle();
    expect(inserted.map((r) => [r.source, r.status])).toEqual([["fallback", 403], ["direct", 200]]);
  });

  it("matches a rule on a body field even though the host parses JSON after the tap", async () => {
    rules = [{
      siteId: "test-site", createdAt: new Date(), ruleId: "rule_2", text: "no discount codes in cart writes",
      compiled: { action: "block", match: { bodyField: "discountCode" } },
      source: "developer", status: "active", evidence: [], enabled: true,
    }];
    const res = await fetch(`${base}/cart/items`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-agentdesk-session": newId("ses") },
      body: JSON.stringify({ sku: "MUG-BLUE", qty: 1, discountCode: "SAVE10" }),
    });
    expect(res.status).toBe(403);
  });
});
