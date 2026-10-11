import { Router } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { verifyAdminToken } from "../contract/db.js";

// STUB created by Door so agentdesk() can mount the panel today.
// Owned by Store (Sebastian): replace this file freely. Keep the export name and signature:
// startPanel(ctx) returns a Router that agentdesk() mounts at ctx.config.panelPath.
// Auth: the admin token from the first-start link, checked with verifyAdminToken.

export function startPanel(ctx: AgentDeskContext): Router {
  const router = Router();
  router.get("/", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    if (!verifyAdminToken(token, ctx.settings)) {
      res.status(401).send("AgentDesk panel: open the private link printed in your server log at first start.");
      return;
    }
    res.type("text/plain").send(`AgentDesk panel for ${ctx.config.siteId}: not built yet (stub).`);
  });
  return router;
}
