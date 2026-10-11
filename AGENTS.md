# AGENTS.md

Instructions for every coding agent working in this repo (Claude Code, Codex, Cursor, Kiro).

## Read first

1. [README.md](README.md): what AgentDesk is.
2. [docs/CONTRACT.md](docs/CONTRACT.md): the shared document shapes, IDs and capability lifecycle. Every part codes against it.
3. Your part's doc: [store](docs/parts/store.md), [door](docs/parts/door.md) or [loop](docs/parts/loop.md).

Background, when you need it: [CONCEPT](docs/CONCEPT.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [DEMO](docs/DEMO.md), [PLAN](docs/PLAN.md).

## Rules

- Everything a developer installs lives in one package, `src/agentdesk/`. Installing must stay one line plus env keys (minimum `MONGODB_URI` and `GEMINI_API_KEY`; `VOYAGE_API_KEY` optional): never add a setup step for the developer.
- Call a model only through `src/agentdesk/contract/llm.ts` and embed only through `src/agentdesk/contract/embed.ts`. Never call Gemini, Voyage or any provider directly from a part.
- Work only in your part's folder: Door `src/agentdesk/index.ts` + `src/agentdesk/door/`, Loop `src/agentdesk/loop/`, Store `src/store/` + `src/agentdesk/panel/`. Talk to other parts only through `src/agentdesk/contract/` or HTTP.
- Agents always see the same five tools (`about`, `ask`, `list_actions`, `do`, `done`). Never add a tool per capability; capabilities are data.
- Do not change `docs/CONTRACT.md` or `src/agentdesk/contract/` without the team agreeing. A contract change is its own commit with a changelog line.
- Until another part is live, test against `fixtures/`, not against a mock you invent.
- When you reach a step in your part's Order, update its **Status** section, so the other parts know what is live.
- This repo is public. Run `./scripts/setup-hooks.sh` once before your first commit. Never commit keys or `.env` files.

## Build order across parts

Each part follows the Order in its own doc. These hand-offs connect them:

1. **All:** `src/agentdesk/contract/` types and Atlas connection. Atlas, Voyage and the vector index working is the first risk to clear.
2. **Door → Loop:** `agentdesk()` boots and the tap writes real `requests`. Loop switches from fixtures to real data.
3. **Door → Store:** the install line works in the demo store, sessions and `done` work. Visitor agents run real visits.
4. **Loop → Door:** capabilities reach `proposed`. The Door offers them.
5. **Loop → Store:** closed episodes and metrics. The panel goes live.
6. **All:** deploy and run the full demo (DEMO.md).

Cut order if late: second host site, Raindrop Experiments, MCP endpoint, Agent Engine guardrails. Never cut: empty start, visit-by-visit learning, the learning curve, one developer block that visibly works.
