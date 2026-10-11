import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearAutopilotCache } from "../src/agentdesk/contract/autopilot.js";
import { newId } from "../src/agentdesk/contract/ids.js";
import { PAUSE_COOLDOWN_MS, capabilitySignature, isPaused, type CapabilityDoc } from "../src/agentdesk/contract/types.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { createTap } from "../src/agentdesk/door/tap.js";
import { doAction, listActions } from "../src/agentdesk/door/tools.js";
import { fakeCtx } from "./fake-ctx.js";

// The breaker (CONTRACT section 4, "Autopilot"): 2 failed runs in a row pause a capability until the
// Loop repairs it (what it sends changes), a 10 minute cooldown passes (one trial run), or the panel's
// approve resets the streak. updatedAt alone does not un-pause it: the Loop touches it on every visit.

const earlier = new Date(Date.now() - 60_000);
const addToCart = (stage: CapabilityDoc["stage"] = "proposed"): CapabilityDoc => ({
  siteId: "s", createdAt: earlier, updatedAt: earlier, capabilityId: "cap_add_to_cart", name: "add_to_cart",
  description: "Add a product to the cart", kind: "write",
  inputSchema: { type: "object", properties: { sku: { type: "string" }, qty: { type: "number" } }, required: ["sku"] },
  mappedRequests: [{ method: "POST", path: "/api/cart/items", bodyTemplate: { sku: "{{sku}}", qty: "{{qty}}" } }],
  stage, sourceEpisodeId: "ep_x", sourceRequestId: "req_x", verifiedByEpisodeId: null,
  stats: { calls: 0, successes: 0 }, examples: [], embedding: [],
});

describe("isPaused", () => {
  const lastFailureAt = new Date("2026-10-11T20:00:00Z");
  const now = lastFailureAt.getTime() + 60_000;
  const cap = addToCart();
  const failedVersion = capabilitySignature(cap);
  const streak = (n: number) => ({ calls: n, successes: 0, consecutiveFailures: n, lastFailureAt, pausedFor: failedVersion });

  it("pauses at 2 failures in a row", () => {
    expect(isPaused({ ...cap, stats: { calls: 0, successes: 0 } }, now)).toBe(false); // no streak yet
    expect(isPaused({ ...cap, stats: streak(1) }, now)).toBe(false);
    expect(isPaused({ ...cap, stats: streak(2) }, now)).toBe(true);
    expect(isPaused({ ...cap, stats: streak(3) }, now)).toBe(true);
  });

  it("comes back when the Loop repairs what it sends, not when updatedAt merely moves", () => {
    const repaired = { ...cap, mappedRequests: [{ method: "POST", path: "/api/cart/items", bodyTemplate: { sku: "{{sku}}", quantity: "{{qty}}" } }] };
    expect(isPaused({ ...repaired, stats: streak(2) }, now)).toBe(false);
    expect(isPaused({ ...cap, updatedAt: new Date(now), stats: streak(2) } as CapabilityDoc, now)).toBe(true);
  });

  it("gets one trial run after the cooldown", () => {
    expect(isPaused({ ...cap, stats: streak(2) }, lastFailureAt.getTime() + PAUSE_COOLDOWN_MS - 1)).toBe(true);
    expect(isPaused({ ...cap, stats: streak(2) }, lastFailureAt.getTime() + PAUSE_COOLDOWN_MS)).toBe(false);
  });

  it("reads dates stored as strings, as in fixtures", () => {
    const stats = { ...streak(2), lastFailureAt: "2026-10-11T20:00:00Z" as unknown as Date };
    expect(isPaused({ ...cap, stats }, now)).toBe(true);
  });
});

describe("the breaker in a real host", () => {
  const { ctx, cols } = fakeCtx("s");
  let base = "";
  let close: () => void;
  let failing = true; // the host's cart answers 400 while this is true
  let hits = 0; // requests that reached the host's cart

  beforeAll(async () => {
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent"] }));
    app.use(express.json());
    app.post("/api/cart/items", (req, res) => {
      hits++;
      if (failing) return void res.status(400).json({ error: "bad_request" });
      res.status(201).json({ ok: true, item: req.body });
    });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());
  beforeEach(() => {
    clearRuleCache();
    clearAutopilotCache();
    failing = true;
    hits = 0;
    cols.capabilities.docs = [addToCart()];
    cols.audit.docs = [];
    cols.settings.docs = [{ _id: "settings", autopilot: true }];
  });

  const episode = { sessionId: newId("ses"), episodeId: newId("ep") };
  const run = (url = base) => doAction(ctx, episode, url, "add_to_cart", { sku: "MUG-BLUE", qty: 1 });
  const offered = async () => ((await listActions(ctx)).data as { actions: { name: string }[] }).actions.map((a) => a.name);
  const stats = () => cols.capabilities.docs[0].stats;
  const pauses = () => cols.audit.docs.filter((a) => a.action === "paused_failing");

  it("two failures in a row pause it: not listed, do refused before sending anything, audited once", async () => {
    expect((await run()).data).toMatchObject({ ok: false, steps: [{ status: 400 }] });
    expect(await offered()).toEqual(["add_to_cart"]); // one failure is not a streak
    expect((await run()).data).toMatchObject({ ok: false, steps: [{ status: 400 }] });
    expect(stats()).toMatchObject({ calls: 2, successes: 0, consecutiveFailures: 2 });
    expect(stats().lastFailureAt).toBeInstanceOf(Date);

    expect(await offered()).toEqual([]);
    const refused = await run();
    expect(refused.data).toEqual({ ok: false, error: "paused_failing" });
    expect(refused.reply).toBe("add_to_cart failed twice in a row, so it is paused while the desk relearns it. Use the website for now.");
    expect(refused.capability).toBeUndefined(); // nothing ran, so the Loop must not read it as a call
    expect(hits).toBe(2);
    expect(stats()).toMatchObject({ calls: 2, consecutiveFailures: 2 });

    expect(pauses()).toMatchObject([{
      actor: "autopilot", action: "paused_failing", capabilityId: "cap_add_to_cart", capabilityName: "add_to_cart",
      sessionId: episode.sessionId, episodeId: episode.episodeId, ok: false,
      detail: "Paused add_to_cart after 2 failures in a row: POST /api/cart/items 400",
    }]);
  });

  it("a success in between resets the streak", async () => {
    await run();
    failing = false;
    expect((await run()).data).toMatchObject({ ok: true });
    expect(stats().consecutiveFailures).toBe(0);
    failing = true;
    await run();
    expect(stats()).toMatchObject({ calls: 3, successes: 1, consecutiveFailures: 1 });
    expect(await offered()).toEqual(["add_to_cart"]);
    expect(pauses()).toHaveLength(0);
  });

  it("comes back when the Loop repairs it (what it sends changed), not when it only touches updatedAt", async () => {
    await run();
    await run();
    expect(await offered()).toEqual([]);
    // The Loop touches updatedAt on every visit that used it: that alone must not un-pause it.
    await cols.capabilities.updateOne({ capabilityId: "cap_add_to_cart" }, { $set: { updatedAt: new Date(Date.now() + 1000) } });
    expect(await offered()).toEqual([]);
    // A repair changes what it sends.
    await cols.capabilities.updateOne({ capabilityId: "cap_add_to_cart" }, { $set: { inputSchema: { type: "object", properties: { sku: { type: "string" } }, required: ["sku"] } } });
    expect(await offered()).toEqual(["add_to_cart"]);
    failing = false;
    expect((await run()).data).toMatchObject({ ok: true });
    expect(stats().consecutiveFailures).toBe(0);
  });

  it("comes back when the panel approves it, which resets consecutiveFailures to 0", async () => {
    await run();
    await run();
    expect((await run()).data).toMatchObject({ error: "paused_failing" });
    await cols.capabilities.updateOne({ capabilityId: "cap_add_to_cart" }, { $set: { stage: "approved", "stats.consecutiveFailures": 0 } });
    expect(await offered()).toEqual(["add_to_cart"]);
    failing = false;
    expect((await run()).data).toMatchObject({ ok: true });
  });

  it("pauses any kind at any stage, autopilot on or off", async () => {
    cols.settings.docs = [{ _id: "settings", autopilot: false }];
    cols.capabilities.docs = [addToCart("approved")];
    await run();
    await run();
    expect(await offered()).toEqual([]);
    expect((await run()).data).toMatchObject({ error: "paused_failing" });

    cols.capabilities.docs = [{
      ...addToCart("verified"), capabilityId: "cap_search", name: "search_products", kind: "read",
      mappedRequests: [{ method: "GET", path: "/api/products", bodyTemplate: {} }],
      stats: { calls: 2, successes: 0, consecutiveFailures: 2, lastFailureAt: new Date() },
    }];
    expect(await offered()).toEqual([]);
    expect((await doAction(ctx, episode, base, "search_products", {})).data).toMatchObject({ error: "paused_failing" });
  });

  it("counts a site it cannot reach as a failure", async () => {
    const gone = express().listen(0);
    await new Promise((r) => gone.once("listening", r));
    const deadUrl = `http://127.0.0.1:${(gone.address() as AddressInfo).port}`;
    await new Promise((r) => gone.close(r));

    expect((await run(deadUrl)).data).toMatchObject({ error: "replay_failed" });
    expect((await run(deadUrl)).data).toMatchObject({ error: "replay_failed" });
    expect((await run()).data).toMatchObject({ error: "paused_failing" });
    expect(pauses()).toMatchObject([{ detail: expect.stringMatching(/^Paused add_to_cart after 2 failures in a row: could not reach the site/) }]);
  });

  it("writes one audit line when failures race past 2", async () => {
    await Promise.all([run(), run(), run()]);
    expect(stats().consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(pauses()).toHaveLength(1);
  });
});
