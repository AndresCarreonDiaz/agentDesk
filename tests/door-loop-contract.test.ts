import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../src/agentdesk/contract/ids.js";
import { fillTemplate } from "../src/agentdesk/door/replay.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { createTap } from "../src/agentdesk/door/tap.js";
import { doAction } from "../src/agentdesk/door/tools.js";
import { buildCapability } from "../src/agentdesk/loop/core.js";
import { fakeCtx } from "./fake-ctx.js";

// The Door must run exactly what the Loop builds: the hand-off between the two parts.
describe("Door runs what the Loop builds", () => {
  it("fills the Loop's bare {{field}} templates from the input", () => {
    expect(fillTemplate({ sku: "{{sku}}", qty: "{{qty}}" }, { input: { sku: "MUG-BLUE", qty: 2 }, steps: [] })).toEqual({ sku: "MUG-BLUE", qty: 2 });
  });

  const { ctx, cols } = fakeCtx("s");
  let base = "";
  let close: () => void;
  const carts = new Map<string, unknown[]>();

  beforeAll(async () => {
    clearRuleCache();
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent"] }));
    app.use(express.json());
    app.post("/api/cart/items", (req, res) => {
      if (typeof req.body.qty !== "number") return void res.status(400).json({ error: "qty must be a number" });
      const sid = String(req.headers["x-agentdesk-session"]);
      carts.set(sid, [...(carts.get(sid) ?? []), req.body]);
      res.status(201).json({ cart: carts.get(sid) });
    });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it("a capability from buildCapability, once approved, adds to the agent's own cart through do", async () => {
    // The visit the live smoke run recorded: a fallback POST /api/cart/items {sku, qty}.
    const episode = { episodeId: "ep_1", sessionId: "ses_aaaaaaaaaaaaaaaa", intents: ["add_to_cart"], turns: [], goalSuccess: true, createdAt: new Date() };
    const draft = buildCapability(episode, [
      { requestId: "req_1", sessionId: episode.sessionId, source: "fallback", method: "GET", path: "/api/products", bodyShape: {}, status: 200, timestamp: new Date() },
      { requestId: "req_2", sessionId: episode.sessionId, source: "fallback", method: "POST", path: "/api/cart/items", bodyShape: { sku: "string", qty: "number" }, status: 201, timestamp: new Date() },
    ]);
    expect(draft).not.toBeNull();
    const now = new Date();
    await cols.capabilities.insertOne({
      ...draft!, siteId: "s", createdAt: now, updatedAt: now, capabilityId: "cap_1", name: "add_to_cart",
      description: "Add a product variant to the cart", stage: "approved", verifiedByEpisodeId: null,
      stats: { calls: 0, successes: 0 }, examples: [], embedding: [],
    });

    const sessionId = newId("ses");
    const r = await doAction(ctx, { sessionId }, base, "add_to_cart", { sku: "MUG-BLUE", qty: 2 });
    expect(r.data).toMatchObject({ ok: true, steps: [{ method: "POST", path: "/api/cart/items", status: 201 }] });
    expect(carts.get(sessionId)).toEqual([{ sku: "MUG-BLUE", qty: 2 }]);
  });
});
