import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AgentDeskContext } from "../src/agentdesk/contract/context.js";
import { newId } from "../src/agentdesk/contract/ids.js";
import type { CapabilityDoc, RequestDoc, RuleDoc } from "../src/agentdesk/contract/types.js";
import { fillPath, fillTemplate } from "../src/agentdesk/door/replay.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { createTap } from "../src/agentdesk/door/tap.js";
import { doAction, listActions } from "../src/agentdesk/door/tools.js";

describe("replay templates", () => {
  const rc = { input: { sku: "MUG-BLUE", qty: 2, id: "q 1" }, steps: [{ method: "POST", path: "/quote", status: 201, body: { quoteId: "q_9" } }] };

  it("keeps types for whole templates and stringifies inline ones", () => {
    expect(fillTemplate({ sku: "{{input.sku}}", qty: "{{ input.qty }}", label: "x{{input.qty}}" }, rc)).toEqual({ sku: "MUG-BLUE", qty: 2, label: "x2" });
    expect(fillTemplate({ quoteId: "{{steps[0].body.quoteId}}" }, rc)).toEqual({ quoteId: "q_9" });
  });

  it("drops fields whose template has no value, and fills path params", () => {
    expect(fillTemplate({ sku: "{{input.sku}}", color: "{{input.color}}" }, rc)).toEqual({ sku: "MUG-BLUE" });
    expect(fillPath("/quote/:id/submit", rc)).toBe("/quote/q%201/submit");
    expect(fillPath("/quote/{{steps[0].body.quoteId}}/submit", rc)).toBe("/quote/q_9/submit");
  });
});

describe("do against a real host", () => {
  const requests: RequestDoc[] = [];
  let caps: CapabilityDoc[] = [];
  let rules: RuleDoc[] = [];
  const carts = new Map<string, unknown[]>();
  let base = "";
  let close: () => void;

  const now = new Date();
  const addToCart = (stage: CapabilityDoc["stage"]): CapabilityDoc => ({
    siteId: "s", createdAt: now, updatedAt: now, capabilityId: "cap_1", name: "add_to_cart",
    description: "Add a product to the cart", kind: "write",
    inputSchema: { type: "object", properties: { sku: { type: "string" }, qty: { type: "number" } }, required: ["sku"] },
    mappedRequests: [{ method: "POST", path: "/cart/items", bodyTemplate: { sku: "{{input.sku}}", qty: "{{input.qty}}" } }],
    stage, sourceEpisodeId: "ep_x", sourceRequestId: "req_x", verifiedByEpisodeId: null,
    stats: { calls: 0, successes: 0 }, examples: [{ input: { sku: "MUG-BLUE", qty: 1 }, requestId: "req_x" }], embedding: [],
  });

  const ctx = {
    config: { siteId: "s", panelPath: "/agentdesk" },
    cols: {
      requests: { insertOne: async (d: RequestDoc) => { requests.push(d); } },
      episodes: { findOne: async () => null },
      rules: { find: () => ({ toArray: async () => rules }) },
      capabilities: {
        find: () => ({ toArray: async () => caps }),
        findOne: async (q: { name: string }) => caps.find((c) => c.name === q.name) ?? null,
        updateOne: async (_q: unknown, u: { $inc: Record<string, number> }) => {
          caps[0].stats.calls += u.$inc["stats.calls"];
          caps[0].stats.successes += u.$inc["stats.successes"];
        },
      },
    },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as AgentDeskContext;

  beforeAll(async () => {
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent"] }));
    app.use(express.json());
    app.post("/cart/items", (req, res) => {
      const session = String(req.headers["x-agentdesk-session"]);
      carts.set(session, [...(carts.get(session) ?? []), req.body]);
      res.status(201).json({ ok: true, cart: carts.get(session) });
    });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());
  beforeEach(() => {
    requests.length = 0;
    rules = [];
    carts.clear();
    clearRuleCache();
  });
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it("does not offer or run an unapproved write", async () => {
    caps = [addToCart("verified")];
    expect((await listActions(ctx)).unknown).toBe(true);
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "add_to_cart", { sku: "MUG-BLUE" });
    expect(r.data).toMatchObject({ ok: false, error: "needs_approval" });
    expect(requests).toHaveLength(0);
  });

  it("runs an approved write into that agent's own cart, recorded as a capability call", async () => {
    caps = [addToCart("approved")];
    const sessionId = newId("ses");
    const r = await doAction(ctx, { sessionId }, base, "add_to_cart", { sku: "MUG-BLUE", qty: 2 });
    expect(r.data).toMatchObject({ ok: true, steps: [{ method: "POST", path: "/cart/items", status: 201 }] });
    expect(carts.get(sessionId)).toEqual([{ sku: "MUG-BLUE", qty: 2 }]);
    expect(caps[0].stats).toEqual({ calls: 1, successes: 1 });
    await settle();
    expect(requests[0]).toMatchObject({ source: "capability", sessionId, path: "/cart/items", status: 201 });
  });

  it("teaches the input when a required field is missing", async () => {
    caps = [addToCart("approved")];
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "add_to_cart", {});
    expect(r.data).toMatchObject({ ok: false, error: "missing_input", missing: ["sku"] });
    expect(r.reply).toContain("MUG-BLUE");
  });

  it("refuses when an active rule names the capability or matches its request", async () => {
    caps = [addToCart("approved")];
    rules = [{ siteId: "s", createdAt: now, ruleId: "rule_1", text: "no cart writes by agents", compiled: { action: "block", match: { method: "POST", path: "/cart/items" } }, source: "developer", status: "active", evidence: [], enabled: true }];
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "add_to_cart", { sku: "MUG-BLUE" });
    expect(r.data).toMatchObject({ ok: false, error: "blocked_by_rule", ruleId: "rule_1" });
    expect(requests).toHaveLength(0);
  });

  it("answers an unknown action with a pointer to list_actions", async () => {
    caps = [];
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "teleport", {});
    expect(r.unknown).toBe(true);
    expect(r.reply).toContain("list_actions");
  });
});
