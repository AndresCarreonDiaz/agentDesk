// Checks the shared LLM and embedding helpers with your real keys. No database needed.
// Run: npm run smoke:llm
import { resolveConfig } from "../src/agentdesk/contract/config.js";
import { chooseEmbedding, cosine, createEmbedder } from "../src/agentdesk/contract/embed.js";
import { createLlm } from "../src/agentdesk/contract/llm.js";

const config = resolveConfig({ env: { ...process.env, MONGODB_URI: process.env.MONGODB_URI || "mongodb://unused" } });
const llm = createLlm(config);
console.log(`model: ${llm.provider} ${llm.model}`);

let t = Date.now();
console.log("text:", JSON.stringify(await llm.text("Reply with exactly: desk ready")), `${Date.now() - t}ms`);

t = Date.now();
const json = await llm.json<{ intent: string }>(
  "A shopping agent says: 'put two blue mugs in my basket'. Name the intent in snake_case.",
  { type: "object", properties: { intent: { type: "string" } }, required: ["intent"] },
);
console.log("json:", json, `${Date.now() - t}ms`);

const embedder = createEmbedder(chooseEmbedding(config), config);
const [query] = await embedder.embed(["put two of the blue ones in my basket"], "query");
const [cart, track] = await embedder.embed(["add_to_cart: add a product to the cart", "track_order: check where an order is"], "document");
console.log(`embeddings: ${embedder.settings.provider} ${embedder.settings.model}, ${query.length} dims`);
console.log(`similarity: add_to_cart ${cosine(query, cart).toFixed(3)} vs track_order ${cosine(query, track).toFixed(3)}`);
