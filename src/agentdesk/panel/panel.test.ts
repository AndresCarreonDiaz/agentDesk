import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import express from "express";
import { hashToken } from "../contract/db.js";
import { FakeCollection, fakeCtx } from "../../../tests/fake-ctx.js";
import { startPanel } from "./index.js";

const TOKEN = "panel-test-token";
const { ctx, cols } = fakeCtx("panel-site");
(ctx.settings as { adminTokenHash?: string }).adminTokenHash = hashToken(TOKEN);

const playbooks = new FakeCollection();
(ctx as unknown as { db: unknown }).db = { collection: () => playbooks };

let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base = "";
const call = (path: string, init?: { method?: string; body?: unknown }, token: string | null = TOKEN) =>
  fetch(`${base}/agentdesk${path}${token ? `?token=${token}` : ""}`, {
    method: init?.method ?? "GET",
    headers: { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("developer panel", () => {
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use("/agentdesk", startPanel(ctx));
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await cols.capabilities.insertOne({ capabilityId: "cap_1", name: "add_to_cart", kind: "write", stage: "proposed", embedding: [1], mappedRequests: [] });
    await cols.rules.insertOne({ ruleId: "rule_1", source: "reflector", status: "proposed", enabled: false, text: "<script>x</script>", evidence: [] });
    await cols.episodes.insertOne({ episodeId: "ep_1", outcome: "success", createdAt: new Date(), embedding: [1] });
  });
  after(() => server.close());

  it("refuses every route without a valid token", async () => {
    for (const path of ["/", "/api/state"]) {
      assert.equal((await call(path, undefined, null)).status, 401);
      assert.equal((await call(path, undefined, "wrong")).status, 401);
    }
    assert.equal((await call("/api/autopilot", { method: "POST", body: { on: true } }, null)).status, 401);
  });

  it("serves the page and the state without embeddings", async () => {
    const page = await call("/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /AgentDesk panel/);
    const res = await call("/api/state");
    const state = (await res.json()) as Record<string, any>;
    assert.equal(state.capabilities.length, 1);
    assert.equal(state.proposedRules.length, 1);
    assert.equal(typeof state.autopilot, "boolean");
    assert.ok(Array.isArray(state.metrics.visits));
  });

  it("adds per-visit request counts and playbook versions to the state", async () => {
    await cols.episodes.insertOne({ episodeId: "ep_2", sessionId: "s_2", outcome: "success", createdAt: new Date(), embedding: [1] });
    const req = (requestId: string, source: string, status: number) =>
      cols.requests.insertOne({ requestId, sessionId: "s_2", source, status, method: "POST", path: "/api/cart/items", timestamp: new Date() });
    await req("r1", "fallback", 400);
    await req("r2", "fallback", 201);
    await req("r3", "capability", 201);
    await playbooks.insertMany([
      { version: 1, status: "kept", params: { lessonStyle: "example" }, reason: "r", trigger: null, result: "Kept", createdAt: new Date() },
      { version: 2, status: "trial", params: { lessonStyle: "field" }, reason: "r", trigger: null, result: null, createdAt: new Date() },
    ]);
    const state = (await (await call("/api/state")).json()) as Record<string, any>;
    const ep = state.episodes.find((e: any) => e.episodeId === "ep_2");
    assert.equal(ep.siteRequests, 2);
    assert.equal(ep.usedLearned, true);
    assert.equal(state.episodes.find((e: any) => e.episodeId === "ep_1").siteRequests, 0);
    assert.deepEqual(state.playbooks.map((p: any) => p.version), [2, 1]);
  });

  it("serves every section of the page", async () => {
    const html = await (await call("/")).text();
    for (const title of ["The desk improved how it teaches", "Visits", "Learned actions", "Guardrails", "Autopilot", "Learning curve"]) {
      assert.ok(html.includes(`>${title}</h2>`), title);
    }
  });

  it("approves a capability and records feedback; rejects bad input", async () => {
    assert.equal((await call("/api/capabilities/cap_1", { method: "POST", body: { stage: "verified" } })).status, 400);
    assert.equal((await call("/api/capabilities/nope", { method: "POST", body: { stage: "approved" } })).status, 404);
    assert.equal((await call("/api/capabilities/cap_1", { method: "POST", body: { stage: "approved" } })).status, 200);
    assert.equal(cols.capabilities.docs[0].stage, "approved");
    const fb = cols.feedback.docs[0];
    assert.equal(fb.type, "approve");
    assert.deepEqual(fb.target, { collection: "capabilities", id: "cap_1" });
    assert.equal(fb.text, null);
  });

  it("sets rule status and adds developer rules", async () => {
    assert.equal((await call("/api/rules/rule_1", { method: "POST", body: { status: "proposed" } })).status, 400);
    assert.equal((await call("/api/rules/rule_1", { method: "POST", body: { status: "active" } })).status, 200);
    assert.equal(cols.rules.docs[0].enabled, true);
    assert.equal((await call("/api/rules/rule_1", { method: "POST", body: { status: "rejected" } })).status, 200);
    assert.equal(cols.rules.docs[0].enabled, false);
    assert.equal((await call("/api/rules", { method: "POST", body: { text: "no coupons", method: "post", path: "/api/cart/coupon" } })).status, 201);
    const rule = cols.rules.docs[1];
    assert.equal(rule.source, "developer");
    assert.deepEqual(rule.compiled, { action: "block", match: { method: "POST", path: "/api/cart/coupon" } });
    assert.equal((await call("/api/rules", { method: "POST", body: { text: "x" } })).status, 400);
  });

  it("toggles autopilot and audits it", async () => {
    cols.settings.docs.push({ _id: "settings" });
    assert.equal((await call("/api/autopilot", { method: "POST", body: { on: true } })).status, 200);
    assert.equal(cols.settings.docs[0].autopilot, true);
    assert.equal(cols.audit.docs[0].action, "autopilot_on");
  });
});
