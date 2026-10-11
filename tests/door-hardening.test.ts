import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentdesk } from "../src/agentdesk/index.js";
import { newId } from "../src/agentdesk/contract/ids.js";
import type { RuleDoc } from "../src/agentdesk/contract/types.js";
import { bodyShape, flatQuery, storableBody } from "../src/agentdesk/door/redact.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { readCookie } from "../src/agentdesk/door/sessions.js";
import { createTap } from "../src/agentdesk/door/tap.js";
import { fakeCtx } from "./fake-ctx.js";

// Regression tests for the confirmed review findings (wf_e4700301-725).

describe("redaction stays cheap and safe", () => {
  it("stores binary bodies as a marker, fast, even when large", () => {
    const big = Buffer.alloc(2_000_000, 1);
    const t = Date.now();
    expect(storableBody(big)).toEqual({ binary: true, bytes: 2_000_000 });
    expect(bodyShape(big)).toEqual({});
    expect(Date.now() - t).toBeLessThan(50);
  });

  it("parses text bodies before redacting, and hides unparseable text", () => {
    expect(storableBody('{"password":"hunter2","sku":"A"}')).toEqual({ password: "[redacted]", sku: "A" });
    expect(storableBody("sku=A&coupon=SAVE10&pwd=x")).toEqual({ sku: "A", coupon: "SAVE10", pwd: "[redacted]" });
    expect(storableBody("free text with secrets")).toBe("[text, 22 chars]");
  });

  it("redacts card numbers sent as numbers and in query strings; cleans bad keys", () => {
    expect(storableBody({ n: 4242424242424242 })).toEqual({ n: "[redacted]" });
    expect(flatQuery({ c: "4242424242424242", jwt: "x" })).toEqual({ c: "[redacted]", jwt: "[redacted]" });
    expect(storableBody({ "a\u0000b": 1, $where: 2, "x.y": 3 })).toEqual({ ab: 1, _$where: 2, x_y: 3 });
  });

  it("truncates huge objects instead of building a document Mongo would reject", () => {
    const huge = { items: Array.from({ length: 50 }, () => "x".repeat(2000)), more: Array.from({ length: 50 }, () => "y".repeat(2000)) };
    expect(storableBody(huge)).toMatchObject({ truncated: true });
  });

  it("never throws on a malformed cookie", () => {
    expect(readCookie("agentdesk_session=%E0%A4%A", "agentdesk_session")).toBeNull();
  });
});

describe("the tap leaves host bodies alone", () => {
  const { ctx, cols } = fakeCtx("s");
  let rules: RuleDoc[] = [];
  (cols.rules as any).find = () => ({ toArray: async () => rules });
  let base = "";
  let close: () => void;
  const rule = (match: RuleDoc["compiled"]["match"]): RuleDoc => ({
    siteId: "s", createdAt: new Date(), ruleId: "rule_x", text: "no coupons for agents",
    compiled: { action: "block", match }, source: "developer", status: "active", evidence: [], enabled: true,
  });

  beforeAll(async () => {
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent"] }));
    app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
      res.json({ isBuffer: Buffer.isBuffer(req.body) });
    });
    app.post("/big", express.json({ limit: "10mb" }), (req, res) => {
      res.json({ keys: Object.keys(req.body).length });
    });
    app.post("/checkout", express.urlencoded({ extended: true }), (req, res) => {
      res.json({ got: req.body });
    });
    app.post("/upload", (_req, res) => {
      res.json({ ok: true });
    });
    app.get("/", (_req, res) => {
      res.send("home");
    });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());
  beforeEach(() => {
    rules = [];
    clearRuleCache();
    cols.requests.docs.length = 0;
  });
  const agent = () => ({ "x-agentdesk-session": newId("ses") });

  it("raw-body routes still get a Buffer from agents (signature checks keep working)", async () => {
    const r = await fetch(`${base}/webhook`, { method: "POST", headers: { ...agent(), "content-type": "application/json" }, body: '{"a":1}' });
    expect(await r.json()).toEqual({ isBuffer: true });
  });

  it("the host's own body limit applies, not the tap's", async () => {
    const big = JSON.stringify(Object.fromEntries(Array.from({ length: 40_000 }, (_, i) => [`k${i}`, "v".repeat(40)])));
    const r = await fetch(`${base}/big`, { method: "POST", headers: { ...agent(), "content-type": "application/json" }, body: big });
    expect(r.status).toBe(200);
    expect((await r.json()).keys).toBe(40_000);
  });

  it("a body-field rule refuses an HTML form post too", async () => {
    rules = [rule({ path: "/checkout", bodyField: "coupon" })];
    const blocked = await fetch(`${base}/checkout`, { method: "POST", headers: { ...agent(), "content-type": "application/x-www-form-urlencoded" }, body: "sku=A&coupon=SAVE10" });
    expect(blocked.status).toBe(403);
    const fine = await fetch(`${base}/checkout`, { method: "POST", headers: { ...agent(), "content-type": "application/x-www-form-urlencoded" }, body: "sku=A" });
    expect(await fine.json()).toEqual({ got: { sku: "A" } });
  });

  it("a body it cannot read on a guarded route is refused, not waved through", async () => {
    rules = [rule({ path: "/upload", bodyField: "coupon" })];
    const form = new FormData();
    form.set("coupon", "SAVE10");
    const r = await fetch(`${base}/upload`, { method: "POST", headers: agent(), body: form });
    expect(r.status).toBe(403);
  });

  it("a malformed session cookie does not break the page", async () => {
    const r = await fetch(`${base}/`, { headers: { cookie: "agentdesk_session=%E0%A4%A" } });
    expect(r.status).toBe(200);
  });
});

describe("agentdesk() when off", () => {
  let base = "";
  let close: () => void;
  beforeAll(async () => {
    const app = express();
    const silent = { info() {}, warn() {}, error() {} };
    app.use(agentdesk({ env: {} }, silent)); // no keys: AgentDesk is off
    app.get("/agent/profile", (_req, res) => { res.send("host page"); });
    app.get("/llms.txt", (_req, res) => { res.send("host llms"); });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it("answers 503 only on desk routes; the host's own routes keep working", async () => {
    expect((await fetch(`${base}/agent`, { method: "POST" })).status).toBe(503);
    expect((await fetch(`${base}/mcp`, { method: "POST" })).status).toBe(503);
    expect(await (await fetch(`${base}/agent/profile`)).text()).toBe("host page");
    expect(await (await fetch(`${base}/llms.txt`)).text()).toBe("host llms");
  });
});
