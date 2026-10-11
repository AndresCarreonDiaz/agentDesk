// The demo, MCP only: an agent finds an empty desk, the desk learns from its own site,
// the next agent gets answers and acts in one call. Run against a store with AgentDesk on a FRESH database.
//
//   AGENTDESK_DB=agentdesk_demo1 PORT=3000 npm run start      (another terminal)
//   BASE_URL=http://localhost:3000 AGENTDESK_DB=agentdesk_demo1 npm run demo:mcp
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connect } from "../src/agentdesk/contract/db.js";

const base = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const dbName = process.env.AGENTDESK_DB || "agentdesk";
const say = (who: string, text: string) => console.log(`\n${who}\n  ${text.replace(/\n/g, "\n  ")}`);
const textOf = (r: any) => (r.content as { text: string }[]).map((c) => c.text).join("\n");
const short = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}...` : s);

async function agent(name: string) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`));
  await client.connect(transport);
  return { client, sessionId: transport.sessionId! };
}

const { client: mongo, db } = await connect({ mongoUri: process.env.MONGODB_URI!, dbName });

// ---- Visit 1: the desk knows nothing ----
const a1 = await agent("shopper-agent-1");
say("Agent 1 -> about", "What can I do on this site?");
say("Desk", textOf(await a1.client.callTool({ name: "about", arguments: {} })));
say("Agent 1 -> list_actions", "Can I add a blue mug to my cart?");
say("Desk", short(textOf(await a1.client.callTool({ name: "list_actions", arguments: { query: "add a blue mug to my cart" } }))));
await a1.client.callTool({ name: "done", arguments: { goalSuccess: false, note: "I wanted to know what the store sells and to add a blue mug to my cart; the desk did not know how yet." } });
say("Agent 1 -> done", "goal not reached");
await a1.client.close();

// ---- The desk learns from its own site ----
const t0 = Date.now();
process.stdout.write("\nDesk is learning from the site");
// The reflection is written last, after the explorer, so it means the desk has finished learning from visit 1.
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  process.stdout.write(".");
  const ep = await db.collection("episodes").findOne({ sessionId: a1.sessionId }, { projection: { reflection: 1 } });
  if (ep?.reflection) break;
}
console.log(` ${Math.round((Date.now() - t0) / 1000)} s`);
const facts = await db.collection("knowledge").countDocuments({ source: "site_read" });
const actions = (await db.collection("capabilities").find({}, { projection: { _id: 0, name: 1, kind: 1, stage: 1 } }).toArray()) as any[];
say("Learned", `${facts} facts about the site; actions: ${actions.map((a) => `${a.name} (${a.kind}, ${a.stage})`).join(", ") || "none"}`);

// ---- Visit 2: a new agent, same MCP ----
const a2 = await agent("shopper-agent-2");
say("Agent 2 -> about", "What can I do on this site?");
say("Desk", textOf(await a2.client.callTool({ name: "about", arguments: {} })));
say("Agent 2 -> ask", "Do you ship to Austin?");
say("Desk", textOf(await a2.client.callTool({ name: "ask", arguments: { question: "Do you ship to Austin, Texas?" } })));
// Like a real agent: discover the action through list_actions, then run it.
const listed = textOf(await a2.client.callTool({ name: "list_actions", arguments: { query: "add a blue mug to my cart" } }));
say("Agent 2 -> list_actions", "add a blue mug to my cart");
say("Desk", short(listed.split("\n\n")[0], 400));
const offered: { name: string; kind: string }[] = JSON.parse(listed.slice(listed.indexOf("{"))).actions ?? [];
const cart = offered.find((a) => /cart/.test(a.name) && a.kind === "write");
if (cart) {
  const t = Date.now();
  const run = await a2.client.callTool({ name: "do", arguments: { action: cart.name, input: { sku: "MUG-BLUE", qty: 1 } } });
  say(`Agent 2 -> do ${cart.name} {sku: MUG-BLUE, qty: 1}  (${Date.now() - t} ms)`, short(textOf(run), 300));
  await a2.client.callTool({ name: "done", arguments: { goalSuccess: !run.isError, note: run.isError ? "The cart action failed." : "Added the blue mug in one call." } });
}
await a2.client.close();

await new Promise((r) => setTimeout(r, 6000));
const audit = await db.collection("audit").find({}, { projection: { _id: 0, actor: 1, action: 1, detail: 1 } }).toArray();
say("Audit (autopilot ran these before review)", audit.map((a) => `${a.actor} ${a.action}: ${a.detail}`).join("\n") || "none");
const caps = await db.collection("capabilities").find({}, { projection: { _id: 0, name: 1, stage: 1, stats: 1 } }).toArray();
say("Actions now", caps.map((c) => `${c.name}: ${c.stage} (${c.stats?.successes ?? 0}/${c.stats?.calls ?? 0} ok)`).join("\n"));
await mongo.close();
