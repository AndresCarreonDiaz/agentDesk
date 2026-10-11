import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isOffered } from "../src/agentdesk/contract/types.js";
import { rememberHostBaseUrl } from "../src/agentdesk/contract/site.js";
import { createTap } from "../src/agentdesk/door/tap.js";
import { exploreAfterVisit, exploreSite, formsOf, pickPages, shouldExplore } from "../src/agentdesk/loop/explore.js";
import { fakeCtx } from "./fake-ctx.js";

const html = (title: string, body: string) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

describe("explorer", () => {
  const { ctx, cols } = fakeCtx("s");
  (ctx as any).embedder = { embed: async (t: string[]) => t.map(() => [1, 0, 0]), embedOne: async () => [1, 0, 0] };
  (ctx as any).llm = {
    provider: "gemini", model: "test",
    text: async () => "",
    json: async (req: { system?: string; prompt?: string }) => {
      if (req.system?.includes("learning about it")) return { facts: ["Harbor Goods sells desk goods: mugs, totes and notebooks.", "Ships anywhere in the US.", "Payments are simulated."] };
      const p = req.prompt ?? "";
      if (p.includes("POST /cart/items")) return { name: "add_to_cart", description: "Add a product to the cart." };
      if (p.includes("GET /products") || p.includes("GET /api/products")) return { name: "search_products", description: "Search the catalog." };
      if (p.includes("/api/checkout")) return { name: "checkout", description: "Place the order." };
      return { name: "do_something", description: "Something." };
    },
  };
  let base = "";
  let close: () => void;

  beforeAll(async () => {
    const app = express();
    app.use(createTap(ctx, { ownPaths: ["/agent"] }));
    app.get("/llms.txt", (_q, res) => { res.type("text/plain").send("# Harbor Goods\n\n> Small, sturdy things for your desk.\n\n- [Harbor Mug](/products/harbor-mug): 12oz mug\n- [Policies](/policies)\n- [Checkout](/checkout)\n"); });
    app.get("/", (_q, res) => { res.send(html("Harbor Goods", `<a href="/products/harbor-mug">Mug</a><form action="/products" method="get"><input name="q" type="search"><button>Search</button></form>`)); });
    app.get("/products/harbor-mug", (_q, res) => { res.send(html("Harbor Mug", `<form action="/cart/items" method="post"><input type="hidden" name="sku" value="MUG-BLUE"><input name="qty" type="number" value="1"><button type="submit">Add to cart</button></form>`)); });
    app.get("/products/other", (_q, res) => { res.send(html("Other", `<form action="/cart/items" method="post"><input type="hidden" name="sku" value="TOTE"><input name="qty" type="number" value="1"><button>Add to cart</button></form>`)); });
    app.get("/checkout", (_q, res) => { res.send(html("Checkout", `<form action="/api/checkout" method="post"><input name="name"><input name="cardNumber"><button>Pay</button></form>`)); });
    app.get("/policies", (_q, res) => { res.send(html("Policies", "<p>Returns within 30 days.</p>")); });
    app.get("/api/products", (_q, res) => { res.json({ products: [{ name: "Harbor Mug", variants: [{ sku: "MUG-BLUE" }] }] }); });
    app.get("/sitemap.xml", (_q, res) => { res.type("application/xml").send("<urlset><url><loc>/products/other</loc></url></urlset>"); });
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => close());

  it("reads forms with the real method and fields", () => {
    const forms = formsOf("http://x", { path: "/cart", title: "Cart", text: `<form action="/api/cart/items/MUG" method="post"><input type="hidden" name="_method" value="PATCH"><input name="qty" type="number" value="2"><input type="submit" value="Update"></form>` });
    expect(forms).toEqual([{ method: "PATCH", path: "/api/cart/items/MUG", fields: [{ name: "qty", type: "number", value: "2" }], label: "Update", page: "/cart", pageTitle: "Cart" }]);
  });

  it("treats the public SITE_URL as the same site (deployed behind a proxy, links are absolute)", () => {
    const before = process.env.SITE_URL;
    process.env.SITE_URL = "https://harbor.example.app";
    try {
      const pages = pickPages("http://127.0.0.1:8080", ["- [Mug](https://harbor.example.app/products/harbor-mug)\n- [Elsewhere](https://evil.example.com/x)"]);
      expect(pages).toEqual(["/products/harbor-mug"]);
    } finally {
      if (before === undefined) delete process.env.SITE_URL;
      else process.env.SITE_URL = before;
    }
  });

  it("explores only when the desk did not know", () => {
    expect(shouldExplore({ turns: [] }, "unknown_site")).toBe(true);
    expect(shouldExplore({ turns: [{ role: "desk", text: "I don't know yet what this site offers", at: new Date() }] }, null)).toBe(true);
    expect(shouldExplore({ turns: [{ role: "desk", text: "Done: add_to_cart.", at: new Date() }] }, null)).toBe(false);
  });

  it("learns facts and actions from the site's own pages, once, without being recorded as traffic", async () => {
    const learned = await exploreSite(ctx, base, "ep_1");
    expect(cols.knowledge.docs.map((k) => k.source)).toEqual(["site_read", "site_read", "site_read"]);
    expect(cols.knowledge.docs[0].text).toContain("mugs");

    const byName = Object.fromEntries(cols.capabilities.docs.map((c) => [c.name, c]));
    expect(Object.keys(byName).sort()).toEqual(["add_to_cart", "checkout", "search_products"]);
    expect(byName.add_to_cart).toMatchObject({
      kind: "write", stage: "proposed", sourceEpisodeId: "ep_1",
      mappedRequests: [{ method: "POST", path: "/cart/items", bodyTemplate: { sku: "{{sku}}", qty: "{{qty}}" } }],
      inputSchema: { properties: { sku: { type: "string" }, qty: { type: "number" } }, required: ["sku", "qty"] },
      examples: [{ input: { sku: "MUG-BLUE", qty: 1 } }],
    });
    // The search form's JSON twin is preferred: agents get SKUs, not a page of HTML.
    expect(byName.search_products).toMatchObject({ kind: "read", mappedRequests: [{ method: "GET", path: "/api/products" }] });
    // On autopilot the cart goes live; checkout moves money, so it still waits for the developer.
    expect(isOffered(byName.add_to_cart, { autopilot: true })).toBe(true);
    expect(isOffered(byName.checkout, { autopilot: true })).toBe(false);
    expect(learned.filter((l) => l.kind === "capability")).toHaveLength(3);

    expect(cols.requests.docs).toHaveLength(0); // the tap skipped the desk's own reads

    const again = await exploreSite(ctx, base, "ep_2");
    expect(again).toEqual([]);
    expect(cols.capabilities.docs).toHaveLength(3);
  });

  it("still learns add_to_cart when a learned multi-step purchase already contains that step", async () => {
    const fresh = fakeCtx("u");
    (fresh.ctx as any).llm = (ctx as any).llm;
    (fresh.ctx as any).embedder = (ctx as any).embedder;
    const now = new Date();
    await fresh.cols.capabilities.insertOne({
      siteId: "u", createdAt: now, updatedAt: now, capabilityId: "cap_buy", name: "purchase_item_with_coupon", description: "Buy", kind: "write", stage: "proposed",
      inputSchema: {}, mappedRequests: [{ method: "POST", path: "/cart/items", bodyTemplate: {} }, { method: "POST", path: "/api/checkout", bodyTemplate: {} }],
      sourceEpisodeId: "ep_x", sourceRequestId: "req_x", verifiedByEpisodeId: null, stats: { calls: 0, successes: 0 }, examples: [], embedding: [],
    });
    await exploreSite(fresh.ctx, base, "ep_3");
    expect(fresh.cols.capabilities.docs.map((c) => c.name)).toContain("add_to_cart");
  });

  it("after a failed visit it explores at most every couple of minutes", async () => {
    const fresh = fakeCtx("t");
    (fresh.ctx as any).llm = (ctx as any).llm;
    (fresh.ctx as any).embedder = (ctx as any).embedder;
    rememberHostBaseUrl(fresh.ctx, base);
    const episode = { episodeId: "ep_9", turns: [{ role: "desk", text: "I don't know yet.", at: new Date() }] } as any;
    expect((await exploreAfterVisit(fresh.ctx, episode, "unknown_site")).length).toBeGreaterThan(0);
    expect(await exploreAfterVisit(fresh.ctx, episode, "unknown_site")).toEqual([]);
  });
});
