// End to end check of Door step 1 against real Atlas: boot agentdesk() inside a tiny host app,
// send human and agent traffic, and read back what the tap recorded.
// Run: npm run smoke:door   (uses AGENTDESK_DB from .env, or agentdesk_smoke)
import express from "express";
import type { AddressInfo } from "node:net";
import { agentdesk } from "../src/agentdesk/index.js";
import { connect } from "../src/agentdesk/contract/db.js";
import { newId } from "../src/agentdesk/contract/ids.js";

const dbName = process.env.AGENTDESK_DB || "agentdesk_smoke";
const app = express();
app.use(agentdesk({ db: dbName }));
app.use(express.json());
app.get("/products", (_req, res) => {
  res.json([{ sku: "MUG-BLUE", name: "Blue mug", price: 12 }]);
});
app.post("/cart/items", (req, res) => {
  res.status(201).json({ ok: true, item: req.body });
});

const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const sessionId = newId("ses");
await fetch(`${base}/products?q=mug`); // human
await fetch(`${base}/products?q=blue`, { headers: { "x-agentdesk-session": sessionId } }); // agent fallback
await fetch(`${base}/cart/items`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: `agentdesk_session=${sessionId}` },
  body: JSON.stringify({ sku: "MUG-BLUE", qty: 1, password: "should-be-redacted" }),
});
const discovery = await (await fetch(`${base}/.well-known/agentdesk`)).json();
console.log("discovery:", discovery);

await new Promise((r) => setTimeout(r, 800));
const { client, db } = await connect({ mongoUri: process.env.MONGODB_URI!, dbName });
const recent = await db
  .collection("requests")
  .find({}, { projection: { _id: 0, source: 1, sessionId: 1, method: 1, path: 1, status: 1, body: 1 } })
  .sort({ timestamp: -1 })
  .limit(3)
  .toArray();
console.log("last 3 tapped requests:", recent.reverse());
const settings = await db.collection("settings").findOne({ _id: "settings" as never }, { projection: { adminTokenHash: 0 } });
console.log("settings:", settings);
for (const name of ["capabilities", "knowledge", "intents"]) {
  const indexes = await db.collection(name).listSearchIndexes().toArray().catch((e: Error) => [{ error: e.message }]);
  console.log(`vector index on ${name}:`, indexes.map((i) => (i as { status?: string; error?: string }).status ?? (i as { error?: string }).error));
}

server.close();
await client.close();
