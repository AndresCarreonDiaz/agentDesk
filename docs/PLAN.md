# Build plan (11 Oct 2026, submissions due 5:00 PM PDT)

## Timeline

| Time | Goal | Done when |
|---|---|---|
| 11:15 to 12:00 | Scaffold | Atlas sandbox connected, demo store runs, middleware tap logs requests to `requests` |
| 12:00 to 1:30 | Learning loop v1 | Episodes recorded, reflector writes knowledge after an unanswered question |
| 1:30 to 2:30 | Capabilities | Fallback request turned into a capability; `/agent` and `/mcp` serve it; vector match on intents |
| 2:30 to 3:30 | Developer control | Live feed, approve/block, rules compiled to guardrails |
| 3:30 to 4:15 | Ship | Deployed on Modelence, Raindrop signals flowing, second host site learns from zero |
| 4:15 to 5:00 | Submit | 1 minute video, README updated, repo public, form submitted |

## Cut lines (drop in this order if late)

1. Second host site (keep the store only)
2. Raindrop Experiments (keep basic signals)
3. MCP endpoint (keep `POST /agent`)
4. Agent Engine guardrails (enforce rules in AgentDesk itself)

Never cut: empty start, visit-by-visit learning, the learning curve, one developer block that visibly works.

## Checks first thing

- Ask the MongoDB table whether the sandbox has Atlas Agent Engine enabled (it is in public preview).
- Claim credits: Cursor, ElevenLabs (not needed), Modelence account at cloud.modelence.com.
- Set up Raindrop with its CLI and write key.

## Rules to respect

- New code only, written today, in this public repo.
- Build in the provided Atlas sandbox cluster.
- Not a dashboard project: the panel supports the desk agent, it is not the pitch.
