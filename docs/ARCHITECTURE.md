# Architecture

## Components

```
              visiting agents (dots, Muse, Claude, scripted shoppers)
                     |                         |
           POST /agent, /mcp          normal website (fallback)
                     |                         |
   +-----------------v-------------------------v------------------+
   |                 host platform (demo store)                   |
   |   +--------------------------------------------------------+ |
   |   |  AgentDesk middleware                                  | |
   |   |   - door: discovery, /agent, /mcp (dynamic tools)      | |
   |   |   - tap: records every request and response            | |
   |   +--------------------------------------------------------+ |
   +------------------------------|-------------------------------+
                                  |
                     +------------v-------------+
                     |  Desk brain (agent)      |  answers agents, calls capabilities
                     |  Reflector (agent)       |  after each episode: why, what to learn
                     +------------|-------------+
                                  |
                     +------------v-------------+       +------------------+
                     |  MongoDB Atlas           |<----->| Developer panel  |
                     |  memory, capabilities,   | change|  live feed,      |
                     |  rules, episodes         | stream|  approve/block   |
                     +--------------------------+       +------------------+
```

1. **Door:** how agents find and talk to the desk. Discovery file, a chat endpoint, and an MCP server whose tool list is rebuilt from the `capabilities` collection (MCP's tool-list-changed notification tells connected agents when it grows).
2. **Tap:** middleware that records every request to the host app with its session, so a fallback to the human website can be tied back to the agent visit that failed at the desk.
3. **Desk brain:** the agent that answers visitors. It retrieves relevant knowledge and capabilities for each request, answers, and calls approved capabilities.
4. **Reflector:** runs after each episode. It classifies the failure, writes knowledge, proposes or repairs capabilities, and records its reasoning ("why it happened").
5. **Developer panel:** reads the same collections, live, and writes feedback and rules back.

## Data model (MongoDB Atlas)

| Collection | What it holds |
|---|---|
| `episodes` | One per agent visit: agent family, intents, turns, desk answers, outcome, duration, steps, reflection |
| `requests` | Tapped HTTP traffic: method, path, body shape, status, session id, linked episode |
| `knowledge` | Facts about the platform (what it sells, policies, limits) with source and confidence |
| `capabilities` | Learned tools: name, description, input schema, mapped request, stage, success stats, examples |
| `intents` | Taxonomy of what agents ask for, with Voyage embeddings for matching |
| `rules` | Developer rules in plain language plus their compiled guardrail form |
| `feedback` | Developer corrections, approvals and blocks, linked to what they changed |

Episodes and capabilities are documents with flexible shape, so a store and an insurance site use the same schema with different fields.

## Memory mapping (Atlas Agent Engine)

| Memory type | AgentDesk use |
|---|---|
| Episodic | Each agent visit, what happened and how it ended |
| Semantic | Facts about the host platform |
| Procedural | Capabilities and multi-step flows (search, then cart, then checkout) |
| Taxonomic | The intent taxonomy and agent families |

Retrieval uses Voyage AI embeddings with Atlas Vector Search: a visitor's request is matched against intents and capability descriptions, so "put two of the blue ones in my basket" finds `add_to_cart`.

## Governance

- Developer rules compile into **Atlas Agent Engine content guardrails** (block, modify, or require review), which apply on the next request.
- Approved capabilities feed the **Policy Engine tool allowlist**, so the desk physically cannot call a capability the developer blocked, even if the model tries.
- Write or spend capabilities default to `require_review` until approved.
- Fallback if Agent Engine is not enabled in the hackathon sandbox: the same rules and allowlist are enforced by AgentDesk itself from the `rules` and `capabilities` collections.

## Signals and learning curve

Every episode emits hard signals to **Raindrop**: success or abandon, steps, seconds, unanswered questions, policy denials. Raindrop Experiments compare desk versions (for example, two descriptions of the same capability), which is how the desk picks what to keep. The learning curve in the panel comes from the same numbers stored in `episodes`.

## Sponsor tools

| Tool | Use |
|---|---|
| MongoDB Atlas (sandbox) | All memory and state, change streams for the live panel |
| Atlas Agent Engine | Memory types, guardrails, policy allowlists, execution traces |
| Voyage AI + Vector Search | Intent and capability matching |
| Raindrop | Episode signals, issue detection, A/B of desk versions |
| Modelence | Hosts the demo store with AgentDesk inside (the public demo link) |

## Stack

TypeScript and Node for the middleware, desk brain and visitor agents. Playwright for the visitor agents' fallback browsing. A small demo store as the host platform, plus a second host (a quote form) to show the same package learning a different site from zero.

Demo store contract: [STORE_PRD.md](./STORE_PRD.md) and [STORE_SPEC.md](./STORE_SPEC.md). Commerce data lives in Atlas database `harbor`; desk memory stays in `desk`.
