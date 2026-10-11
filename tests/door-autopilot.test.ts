import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearAutopilotCache, setAutopilot } from "../src/agentdesk/contract/autopilot.js";
import { newId } from "../src/agentdesk/contract/ids.js";
import { isOffered, isSensitive, type CapabilityDoc } from "../src/agentdesk/contract/types.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { createTap } from "../src/agentdesk/door/tap.js";
import { doAction, listActions } from "../src/agentdesk/door/tools.js";
import { fakeCtx } from "./fake-ctx.js";

const now = new Date();
const cap = (name: string, path: string, stage: CapabilityDoc["stage"], body: object = { sku: "{{sku}}", qty: "{{qty}}" }): CapabilityDoc => ({
  siteId: "s", createdAt: now, updatedAt: now, capabilityId: `cap_${name}`, name, description: name, kind: "write",
  inputSchema: { type: "object", properties: {}, required: [] }, mappedRequests: [{ method: "POST", path, bodyTemplate: body }],
  stage, sourceEpisodeId: "ep_x", sourceRequestId: "req_x", verifiedByEpisodeId: null, stats: { calls: 0, successes: 0 }, examples: [], embedding: [],
});

describe("offer rule with autopilot", () => {
  it("everyday writes go live on autopilot; money never does without approval", () => {
    const addToCart = cap("add_to_cart", "/api/cart/items", "proposed");
    const checkout = cap("checkout", "/api/checkout", "proposed", { shipping: "{{shipping}}" });
    const pay = cap("place_order", "/api/x", "verified", { cardNumber: "{{cardNumber}}" });
    expect(isOffered(addToCart)).toBe(false);
    expect(isOffered(addToCart, { autopilot: true })).toBe(true);
    expect(isOffered(checkout, { autopilot: true })).toBe(false);
    expect(isOffered(pay, { autopilot: true })).toBe(false);
    expect(isOffered({ ...checkout, stage: "approved" })).toBe(true);
    expect(isOffered({ ...addToCart, stage: "blocked" }, { autopilot: true })).toBe(false);
    expect(isOffered({ ...addToCart, stage: "observed" }, { autopilot: true })).toBe(false);
  });

  it("spots money by name, path or payment fields", () => {
    expect(isSensitive({ name: "apply_coupon", mappedRequests: [{ method: "POST", path: "/api/cart/coupon", bodyTemplate: { code: "{{code}}" } }] })).toBe(false);
    expect(isSensitive({ name: "submit_order" })).toBe(true);
    expect(isSensitive({ name: "x", mappedRequests: [{ method: "POST", path: "/api/refunds", bodyTemplate: {} }] })).toBe(true);
    expect(isSensitive({ name: "x", mappedRequests: [{ method: "POST", path: "/api/x", bodyTemplate: { amount: "{{amount}}" } }] })).toBe(true);
  });
});

describe("autopilot in a real host", () => {
  const { ctx, cols } = fakeCtx("s");
  let base = "";
  let close: () => void;

  beforeAll(async () => {
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent"] }));
    app.use(express.json());
    app.post("/api/cart/items", (req, res) => { res.status(201).json({ ok: true, item: req.body }); });
    app.post("/api/checkout", (_req, res) => { res.status(201).json({ order: "o_1" }); });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());
  beforeEach(async () => {
    clearRuleCache();
    clearAutopilotCache();
    cols.capabilities.docs = [cap("add_to_cart", "/api/cart/items", "proposed"), cap("checkout", "/api/checkout", "proposed", { shipping: "{{shipping}}" })];
    cols.audit.docs = [];
    cols.settings.docs = [{ _id: "settings", autopilot: true }];
  });

  it("runs a learned add_to_cart before review, says so, and audits it", async () => {
    const list = await listActions(ctx);
    const actions = (list.data as { actions: { name: string; note?: string }[] }).actions;
    expect(actions.map((a) => a.name)).toEqual(["add_to_cart"]); // checkout is not offered
    expect(actions[0].note).toContain("running on autopilot");

    const sessionId = newId("ses");
    const r = await doAction(ctx, { sessionId }, base, "add_to_cart", { sku: "MUG-BLUE", qty: 1 });
    expect(r.data).toMatchObject({ ok: true });
    expect(cols.audit.docs).toMatchObject([{ actor: "autopilot", action: "ran_unreviewed", capabilityName: "add_to_cart", sessionId, ok: true }]);
  });

  it("still makes checkout wait for the developer", async () => {
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "checkout", { shipping: {} });
    expect(r.data).toMatchObject({ ok: false, error: "needs_approval_money" });
    expect(r.reply).toContain("moves money");
    expect(cols.audit.docs).toHaveLength(0);
  });

  it("turning autopilot off brings back approval, and the toggle is audited", async () => {
    await setAutopilot(ctx, false);
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "add_to_cart", { sku: "MUG-BLUE", qty: 1 });
    expect(r.data).toMatchObject({ ok: false, error: "needs_approval" });
    expect(cols.audit.docs).toMatchObject([{ actor: "developer", action: "autopilot_off" }]);
  });

  it("an approved write runs without an audit line (the developer already reviewed it)", async () => {
    cols.capabilities.docs[0].stage = "approved";
    const r = await doAction(ctx, { sessionId: newId("ses") }, base, "add_to_cart", { sku: "MUG-BLUE", qty: 1 });
    expect(r.data).toMatchObject({ ok: true });
    expect(cols.audit.docs).toHaveLength(0);
  });
});
