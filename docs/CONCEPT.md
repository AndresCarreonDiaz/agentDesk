# Concept

## The one sentence

AgentDesk is an empty agent you drop inside a platform, and it becomes that platform's expert front desk for AI agents by learning from every agent that visits.

## Who it is for

**The developer** of any platform that agents now visit: a store, a generative media app, an insurance or booking site. They want agent traffic to convert, but they do not want to design, document and maintain an agent API by hand.

**The visiting agents**: dots, Muse, Claude, custom shopping or research agents. They want to know, fast, what a site can do and how to do it, without screen-scraping.

## The drop-in

It should feel like a toggle. The site already runs on MongoDB, so the developer adds one LLM key and one line:

```
npm i agentdesk
# .env: MONGODB_URI (already there), ANTHROPIC_API_KEY or OPENAI_API_KEY, VOYAGE_API_KEY
app.use(agentdesk())
```

Nothing else. AgentDesk keeps its memory in its own `agentdesk` database inside the developer's cluster and thinks with the developer's own LLM key: no AgentDesk account, no AgentDesk servers. Once installed, AgentDesk:

1. Publishes a door so agents can find it: a discovery file at `/.well-known/agentdesk`, a link tag in the site's HTML, and an `llms.txt` entry.
2. Serves two ways in: a plain chat endpoint (`POST /agent`) and an MCP endpoint (`/mcp`), both with the same five fixed tools (`about`, `ask`, `list_actions`, `do`, `done`). What it learns shows up inside `list_actions`, so agents never reconnect.
3. Sits in the request path of the host app, so it can see which real requests succeed (read below).
4. Serves the developer panel at `/agentdesk`, behind a private link printed once in the server log.

It starts with **zero knowledge**. That is the point of the demo and the product: no setup cost.

## The learning loop

Every visit is an **episode**. AgentDesk keeps a full record of it: who came (agent family), what they wanted (intent), what the desk answered, what the agent did next, and how it ended (success, abandoned, error, blocked).

After every episode, a **reflection step** asks: what did this agent need that I could not give, and why? The answer is one of a few cases, and each has its own way to learn:

| Why it failed | How AgentDesk learns |
|---|---|
| Did not know what the site is or offers | Reads the site itself (pages, sitemap, product listings) and writes down facts |
| Knew the goal, not the steps | Watches the agent fall back to the human website, records the backend request that finally worked (for example `POST /cart/items {sku, qty}`), and turns it into a capability |
| Had a capability, but the call failed | Compares the failed call with successful ones and fixes the parameters or description |
| Gave a wrong or unhelpful answer | Waits for the developer's correction, or learns from the agent's next question |
| Action not allowed | Nothing to learn: a developer rule blocked it, and the desk now says so clearly up front |

**Watching the fallback** is the key trick. AgentDesk lives inside the platform, so when an agent gives up on the desk and clicks through the normal website, the desk sees the exact request that succeeded. It never has to guess the API: it learns it from real, working traffic.

## Capability lifecycle

Every capability (search products, add to cart, generate an image, request a quote) moves through stages:

```
unknown -> observed -> proposed -> verified -> approved
                                     \-> blocked (by the developer)
```

- **Observed:** seen in a successful request, not yet offered to agents.
- **Proposed:** offered to agents, with a note that it is new.
- **Verified:** an agent used it and the task succeeded.
- **Approved / blocked:** the developer's decision, which always wins.

Read-only capabilities (search, describe, check status) can go live on their own. Anything that writes or spends (checkout, submit an application, generate paid media) needs **developer approval** before agents can use it. That rule is the guardrail the product is built around.

## Developer control

The developer gets a live view of the desk at work:

- **Live feed** of agent visits: intent, steps, outcome, and the desk's own explanation of why it went that way.
- **Capabilities** with their stage, success rate and example calls. Approve, block, or edit the description.
- **Corrections:** mark any answer as wrong and type the right one. It becomes knowledge on the spot.
- **Rules:** plain-language limits ("never apply discount codes", "quotes only for US addresses"). Each rule becomes an enforced guardrail, not just a prompt line.
- **Learning curve:** success rate, steps and seconds per task over visits.

The control panel supports the product; it is not the product. The product is the desk agent that teaches itself.

## What makes it hard (and worth judging)

- Turning raw observed HTTP traffic into safe, well-described, parameterised tools.
- Matching a new agent's free-text request to the right capability (semantic search over intents).
- Knowing when a capability is trustworthy (verification from real outcomes, not from the model's opinion).
- Enforcing developer rules as hard guardrails while the desk keeps changing itself.
- Staying generic: the same package, dropped into a store or an insurance site, learns both from zero.

## Not in scope today

- Payments on real money rails (demo uses a fake checkout).
- Authenticating visiting agents (identity is recorded, not verified).
- Multi-tenant hosting for many sites at once.
