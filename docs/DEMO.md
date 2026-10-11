# Demo

Everything happens over MCP: the agent never opens the website. Run it on a **fresh** desk database.

## Stage demo (3 minutes)

**0:00 Hook.** "Agents like dots and Muse now shop for people. They land on sites built for humans and give up. Here is a desk you install with one line that starts knowing nothing and learns from every agent that visits."

**0:15 Drop it in.** Show the one line, `app.use(agentdesk())`, and the two keys in `.env` (`MONGODB_URI`, `GEMINI_API_KEY`). Open the panel: 0 facts, 0 actions, autopilot on.

**0:30 Agent 1 (MCP).** It asks "what can I do here?" and "add a blue mug to my cart". The desk says honestly: "I don't know yet." The agent leaves.

**0:50 The desk learns.** In the panel, within about 20 seconds: the visit closes, the desk reads its own site (`/llms.txt`, pages, forms) and learns facts (what the store sells, US shipping, simulated payments) and actions (`search_products`, `add_to_cart`). Point out: nobody wrote an API.

**1:20 Agent 2 (MCP, a new agent).** `about` describes the store. "Do you ship to Austin?" "Yes, anywhere in the US." `list_actions` offers `add_to_cart`; `do` adds the blue mug **in one call**.

**1:50 Autopilot and audit.** The panel's audit log: "autopilot ran add_to_cart before review: POST /cart/items 201". `add_to_cart` is now **verified**. Checkout would still wait for the developer: anything that moves money always asks.

**2:15 The developer steers.** Add the rule "agents may not apply discount codes". The next agent's discount request is refused by the rule, even if it tries the website directly.

**2:40 Close.** "Visit 1: I don't know yet. Visit 2: done in one call. One line, two keys, and no one wrote an agent API."

## Video (1 minute, required for submission)

1. 0 to 10 s: the hook over the empty panel and the one install line.
2. 10 to 25 s: agent 1 gets "I don't know yet"; the panel shows facts and actions appearing.
3. 25 to 45 s: agent 2 gets real answers and adds the mug in one call; the audit line and "verified".
4. 45 to 60 s: the discount rule refusing an agent; closing line.

Record only what was built today.

## Run it

- Locally: `npm run start` (Harbor Goods with AgentDesk), then `npm run demo:mcp` drives agents 1 and 2.
- With a real agent: `claude mcp add --transport http harbor <site>/mcp`, then ask Claude to shop.
- Deployed: `https://agentdesk-mv4ds7c7j01-prod.cloud.modelence.app` (MCP at `/mcp`).

## Numbers to show

- Visit 1 vs visit 2: "I don't know yet" vs done in one call
- Seconds from the failed visit to learned facts and actions (about 20 s)
- Facts learned, actions learned, actions verified, autopilot runs in the audit log
