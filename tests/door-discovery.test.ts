import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDoorRouter } from "../src/agentdesk/door/index.js";
import { clearRuleCache } from "../src/agentdesk/door/rules.js";
import { fakeCtx } from "./fake-ctx.js";

// Auto-discovery: an agent that lands on any page can find the desk, and a browsing agent
// that only opens links can read the desk and have its later clicks join the same visit.
describe("auto-discovery", () => {
  const { ctx, cols } = fakeCtx("s");
  let base = "";
  let close: () => void;

  beforeAll(async () => {
    clearRuleCache();
    const app = express();
    app.use(createDoorRouter(ctx)); // the one-line install
    app.use(express.json());
    app.get("/llms.txt", (_q, res) => { res.type("text/plain").send("# Harbor Goods\n\n> Small things for your desk.\n"); });
    app.get("/", (_q, res) => { res.send("<html><body>Harbor Goods</body></html>"); });
    app.post("/cart/items", (req, res) => { res.status(201).json({ ok: true, item: req.body }); });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it("adds a 'For AI agents' section to the site's own llms.txt, with absolute links", async () => {
    const text = await (await fetch(`${base}/llms.txt`)).text();
    expect(text.startsWith("# Harbor Goods")).toBe(true); // the site's own content is untouched
    expect(text).toContain("## For AI agents");
    expect(text).toContain(`MCP (Streamable HTTP): ${base}/mcp`);
    expect(text).toContain(`${base}/agent/about`);
  });

  it("uses the public address behind a proxy", async () => {
    const text = await (await fetch(`${base}/llms.txt`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "harbor.example.app" } })).text();
    expect(text).toContain("https://harbor.example.app/mcp");
  });

  it("puts a Link header on every page and serves an MCP server card", async () => {
    const page = await fetch(`${base}/`);
    expect(page.headers.get("link")).toContain('</mcp>; rel="mcp"');
    const card = await (await fetch(`${base}/.well-known/mcp`)).json();
    expect(card.remotes).toEqual([{ type: "streamable-http", url: `${base}/mcp` }]);
    expect(card.tools).toEqual(["about", "ask", "list_actions", "do", "done"]);
  });

  it("lets a browsing agent read the desk by opening a link, and joins its later clicks to the same visit", async () => {
    const about = await fetch(`${base}/agent/about`, { headers: { accept: "text/html" } });
    expect(about.headers.get("content-type")).toContain("text/plain");
    expect(await about.text()).toContain("I don't know yet");
    const cookie = about.headers.get("set-cookie") ?? "";
    const sessionId = cookie.match(/agentdesk_session=(ses_[a-f0-9]+)/)?.[1];
    expect(sessionId).toBeTruthy();

    // The same agent then clicks "Add to cart" on the website, carrying the cookie.
    await fetch(`${base}/cart/items`, { method: "POST", headers: { "content-type": "application/json", cookie: `agentdesk_session=${sessionId}` }, body: JSON.stringify({ sku: "MUG-BLUE", qty: 1 }) });
    await new Promise((r) => setTimeout(r, 50));
    const episode = cols.episodes.docs.find((e) => e.sessionId === sessionId);
    expect(episode).toBeTruthy();
    expect(cols.requests.docs.find((r) => r.path === "/cart/items")).toMatchObject({ source: "fallback", sessionId, episodeId: episode!.episodeId });
  });

  it("keeps writes on POST", async () => {
    const res = await fetch(`${base}/agent/do`);
    expect(res.status).toBe(405);
  });
});
