import { Router } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { createAgentRouter } from "./agent-route.js";
import { SESSION_HEADER } from "./sessions.js";
import { createTap } from "./tap.js";
import { LIST_ACTIONS_HINT, TOOL_NAMES } from "./tools.js";

// Door: the tap, discovery, POST /agent, /mcp (docs/parts/door.md).

/** Paths the desk serves itself. Never the host's own files (llms.txt, robots.txt stay the host's). */
export const DOOR_PATHS = ["/agent", "/mcp", "/.well-known/agentdesk"];

export function createDoorRouter(ctx: AgentDeskContext): Router {
  const router = Router();
  router.use(createTap(ctx, { ownPaths: [...DOOR_PATHS, ctx.config.panelPath] }));

  router.get("/.well-known/agentdesk", (_req, res) => {
    res.json({
      name: "AgentDesk",
      description: "This site's front desk for AI agents. It starts knowing nothing and learns from every visit.",
      siteId: ctx.config.siteId,
      endpoints: { agent: "/agent", done: "/agent/done", mcp: "/mcp" },
      tools: TOOL_NAMES,
      howTo: [
        "Start with about.",
        LIST_ACTIONS_HINT,
        "Finish with done { goalSuccess, note }: say what you wanted and whether it worked.",
        `Send the ${SESSION_HEADER} header from the first response on every later call, and the agentdesk_session cookie if you fall back to the website.`,
      ],
    });
  });

  router.use("/agent", createAgentRouter(ctx));
  return router;
}
