import { Router } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { createTap } from "./tap.js";

// Door: the tap, discovery, POST /agent, /mcp (docs/parts/door.md).
// Order step 1 is here (tap). Steps 2 to 5 add discovery, the five tools, intent match and /mcp.

export const DOOR_PATHS = ["/agent", "/mcp", "/.well-known/agentdesk", "/llms.txt"];

export function createDoorRouter(ctx: AgentDeskContext): Router {
  const router = Router();
  router.use(createTap(ctx, { ownPaths: [...DOOR_PATHS, ctx.config.panelPath] }));

  // Minimal discovery until Order step 2 fills it in.
  router.get("/.well-known/agentdesk", (_req, res) => {
    res.json({
      name: "AgentDesk",
      siteId: ctx.config.siteId,
      status: "learning",
      endpoints: { agent: "/agent", mcp: "/mcp" },
      tools: ["about", "ask", "list_actions", "do", "done"],
    });
  });

  return router;
}
