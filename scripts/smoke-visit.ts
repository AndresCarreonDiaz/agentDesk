// A real agent visit against a running store with AgentDesk installed, over both doors,
// then what landed in Atlas. Use it to rehearse the demo and to check a deploy.
//
//   npm run start                      (in another terminal; PORT and MONGODB_DB_STORE as you like)
//   BASE_URL=http://localhost:3000 npm run smoke:visit
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connect } from "../src/agentdesk/contract/db.js";

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const dbName = process.env.AGENTDESK_DB || "agentdesk";
const step = (label: string, value: unknown) => console.log(`\n== ${label}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);

async function agent(path: string, body: object, sessionId?: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agentdesk-agent": "script:smoke-visit", ...(sessionId ? { "x-agentdesk-session": sessionId } : {}) },
    body: JSON.stringify(sessionId ? { sessionId, ...body } : body),
  });
  return { status: res.status, session: res.headers.get("x-agentdesk-session"), json: (await res.json()) as any };
}

async function site(method: string, path: string, sessionId: string, body?: object) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { cookie: `agentdesk_session=${sessionId}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

// ---- Visit 1: plain HTTP door, then the website fallback ----
step("discovery", await (await fetch(`${base}/.well-known/agentdesk`)).json());

const hello = await agent("/agent", { message: "Hi, what can I do on this site?" });
const sessionId = hello.session!;
step(`visit 1 /agent "what can I do here?" -> HTTP ${hello.status}, session ${sessionId}`, hello.json.reply);

const actions = await agent("/agent/list_actions", {}, sessionId);
step("visit 1 list_actions", actions.json.reply);

const cartAsk = await agent("/agent", { message: "Add a blue mug to my cart" }, sessionId);
step(`visit 1 "add a blue mug to my cart" -> tool ${cartAsk.json.tool}`, cartAsk.json.reply);

// If the desk has learned a cart action, use it: one call. Otherwise use the website, carrying the session cookie.
const offered: { name: string; note?: string }[] = actions.json?.data?.actions ?? [];
const learned = offered.find((a) => /cart/i.test(a.name));
let reached = false;
let note: string;
if (learned) {
  const t = Date.now();
  const run = await agent("/agent/do", { action: learned.name, input: { sku: "MUG-BLUE", qty: 1 } }, sessionId);
  reached = run.json?.data?.ok === true;
  step(`visit 1 do ${learned.name} -> ${reached ? "ok" : "failed"} in ${Date.now() - t} ms (${learned.note ?? "reviewed"})`, run.json.reply);
  note = reached ? `The desk did it in one call with ${learned.name}.` : `${learned.name} failed: ${run.json.reply}`;
} else {
  const products = await site("GET", "/api/products?q=mug", sessionId);
  const product = products.json?.products?.[0];
  const sku = product?.variants?.find((v: any) => /blue/i.test(JSON.stringify(v)))?.sku ?? product?.variants?.[0]?.sku;
  step(`visit 1 fallback GET /api/products?q=mug -> ${products.status}`, { found: products.json?.products?.length ?? 0, product: product?.name, sku });
  const add = await site("POST", "/api/cart/items", sessionId, { sku, qty: 1 });
  step(`visit 1 fallback POST /api/cart/items -> ${add.status}`, { items: add.json?.cart?.items?.map((i: any) => `${i.qty} x ${i.sku}`) });
  reached = add.status < 300;
  note = "The desk could not add to cart, so I used the website: GET /api/products then POST /api/cart/items.";
}

const done1 = await agent("/agent/done", { goalSuccess: reached, note }, sessionId);
step("visit 1 done", done1.json.reply);

// ---- Visit 2: MCP door ----
const client = new Client({ name: "smoke-mcp", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
await client.connect(transport);
const mcpSession = transport.sessionId!;
const tools = await client.listTools();
step(`visit 2 /mcp connected, session ${mcpSession}`, tools.tools.map((t) => t.name));
const about = await client.callTool({ name: "about", arguments: {} });
step("visit 2 about", (about.content as { text: string }[])[0].text);
await client.callTool({ name: "done", arguments: { goalSuccess: false, note: "I wanted to know what the store sells; the desk did not know yet." } });
await client.close();

// ---- What landed in Atlas ----
await new Promise((r) => setTimeout(r, 1500));
const { client: mongo, db } = await connect({ mongoUri: process.env.MONGODB_URI!, dbName });
for (const sid of [sessionId, mcpSession]) {
  const ep = await db.collection("episodes").findOne({ sessionId: sid }, { projection: { _id: 0, episodeId: 1, agentFamily: 1, goal: 1, outcome: 1, goalSuccess: 1, doneNote: 1, turns: 1 } });
  step(`Atlas episode for ${sid}`, ep ? { ...ep, turns: (ep.turns as any[]).map((t) => `${t.role}: ${String(t.text).slice(0, 90)}`) } : "MISSING");
}
const reqs = await db.collection("requests").find({ sessionId }, { projection: { _id: 0, source: 1, method: 1, path: 1, status: 1, episodeId: 1, bodyShape: 1 } }).sort({ timestamp: 1 }).toArray();
step(`Atlas requests tapped for visit 1 (${reqs.length})`, reqs);
const audit = await db.collection("audit").find({ sessionId }, { projection: { _id: 0, actor: 1, action: 1, capabilityName: 1, ok: 1, detail: 1 } }).toArray();
step(`Atlas audit for visit 1 (${audit.length})`, audit);
await mongo.close();
