# AgentDesk

**Drop it in. It knows nothing. Every agent that visits teaches it.**

AgentDesk is a front desk for AI agents. A developer drops it into any platform (an online store, an image generator, an insurance quote site) as an npm package or a container. On day one it is empty: no docs, no tool list, no config. It just starts accepting agent traffic.

Every agent that arrives teaches it something. The first agent asks "what can I do here?" and leaves without an answer. AgentDesk records why it failed, goes and learns the answer, and the next agent gets one. That agent then wants to add something to a cart and gets stuck. AgentDesk watches how the request finally got done, turns it into a capability, and the agent after that does it in one call.

The developer watches it learn in real time, and steers it: approve a capability, block one ("agents may not apply discount codes"), or correct an answer. Each correction becomes part of what AgentDesk knows.

## Why now

Consumer agents like OpenAI's dots and Meta's Muse now shop, book and fill forms on people's behalf, around the clock. They land on websites built for humans and burn minutes clicking through pages, or give up. Every platform needs a way to serve agent visitors, but nobody has time to hand-write an agent API for a site that keeps changing. AgentDesk writes its own, from real traffic.

## How it learns, visit by visit

| Visit | What the agent wants | What AgentDesk knows | Outcome |
|---|---|---|---|
| 1 | "What can I do here?" | Nothing | Agent leaves. Desk logs an unanswered question and learns what the site offers. |
| 2 | "What can I do here?" then "add the blue mug to my cart" | What the site does | Answer given. Cart fails, agent falls back to clicking the site. Desk watches the request that worked. |
| 3 | "Add the blue mug to my cart" | `add_to_cart` capability, unverified | Works in one call. Capability marked verified. |
| 10 | "Buy two mugs and ship to Austin" | Search, cart, checkout flow | Done in 3 calls, 5 seconds. |

The numbers that prove it: **task success rate, steps per task and seconds per task, plotted against visit count.**

## What is in this repo

- [docs/CONCEPT.md](docs/CONCEPT.md): the product, the learning loop, developer control
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): components, data model, memory, sponsor tools
- [docs/DEMO.md](docs/DEMO.md): the 3 minute stage demo and the 1 minute video
- [docs/PLAN.md](docs/PLAN.md): today's build plan, cut lines and fallbacks

## Hackathon fit

Built at the Harness Engineering & Model Wrangling #SFTechWeek Hackathon (MongoDB, 11 Oct 2026).

- **Recursive Harnessing:** AgentDesk evolves its own tools, answers and guardrails to fit the specific platform it was dropped into.
- **Long Horizon Engineering:** it keeps a memory of every visit, every failure and every correction, and optimises against hard numbers (success, steps, time).

## Hackathon tools we use

| Tool | What AgentDesk uses it for |
|---|---|
| **MongoDB Atlas** (hackathon sandbox cluster) | The desk's whole memory: episodes, tapped requests, knowledge, capabilities, rules and developer feedback, as flexible documents that fit any host platform |
| **Atlas Agent Engine: memory** | Episodic (each agent visit), semantic (facts about the platform), procedural (learned capabilities and flows), taxonomic (intents and agent families) |
| **Atlas Agent Engine: guardrails** | Developer rules ("no discount codes") compiled into content guardrails that block, modify or require review, live on the next request |
| **Atlas Agent Engine: Policy Engine** | Tool allowlist built from approved capabilities, plus caps on tool calls and tokens per visit, so a blocked capability cannot be called even if the model tries |
| **Atlas Agent Engine: traces** | Execution traces behind the desk's "why it happened" explanation for each visit |
| **Voyage AI + Atlas Vector Search** | Matching a visitor's free-text request to the right intent and capability |
| **Atlas change streams** | Live feed of visits and newly learned capabilities in the developer panel |
| **Raindrop** | Hard signals per visit (success, abandon, steps, seconds, unanswered questions, policy denials) and Experiments to A/B desk versions |
| **Modelence** | Hosts the demo store with AgentDesk inside, which is the public demo link |
| **Cursor, AWS Kiro, MongoDB MCP server** | Build tooling during the event |

If Atlas Agent Engine is not enabled in the sandbox, AgentDesk enforces the same rules and allowlist itself from its Atlas collections.

## Status

Concept stage. Code lands here during the event.
