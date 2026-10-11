import { Router, type NextFunction, type Request, type Response } from "express";
import { AgentDeskConfigError, type AgentDeskOptions } from "./contract/config.js";
import { consoleLogger, createContext, type AgentDeskContext, type Logger } from "./contract/context.js";
import { DOOR_PATHS, createDoorRouter } from "./door/index.js";
import { startLoop } from "./loop/index.js";
import { startPanel } from "./panel/index.js";

export type { AgentDeskOptions } from "./contract/config.js";
export type { AgentDeskContext } from "./contract/context.js";

// The whole install: app.use(agentdesk()). Put it before your own routes so the tap sees them.
//
// It never takes the host app down. Missing keys turn AgentDesk off (the site keeps working,
// agent endpoints answer 503). That is the toggle: remove the key and it is off.

type State =
  | { kind: "booting"; ready: Promise<void> }
  | { kind: "ready"; handler: Router; ctx: AgentDeskContext }
  | { kind: "off"; reason: string };

const BOOT_WAIT_MS = 3_000;

export function agentdesk(options: AgentDeskOptions = {}, log: Logger = consoleLogger): Router {
  const panelPath = options.panelPath ?? "/agentdesk";
  const ownPaths = [...DOOR_PATHS, panelPath];
  let state: State;

  const ready = boot().catch((err) => {
    const reason = err instanceof AgentDeskConfigError ? err.message : `could not start: ${(err as Error).message}`;
    state = { kind: "off", reason };
    log.error(`AgentDesk is off. ${reason}`, err instanceof AgentDeskConfigError ? undefined : err);
  });
  state = { kind: "booting", ready };

  async function boot(): Promise<void> {
    const { ctx, adminToken } = await createContext(options, log);
    const handler = Router();
    handler.use(createDoorRouter(ctx));
    handler.use(ctx.config.panelPath, startPanel(ctx));
    await startLoop(ctx);
    state = { kind: "ready", handler, ctx };

    log.info(`ready for site "${ctx.config.siteId}" (database "${ctx.config.dbName}", ${ctx.llm.provider} ${ctx.llm.model}, ${ctx.settings.embedding.provider} embeddings)`);
    if (adminToken) {
      log.info(`your private panel link (shown once, keep it): ${ctx.config.panelPath}?token=${adminToken}`);
    }
  }

  const outer = Router();
  outer.use((req: Request, res: Response, next: NextFunction) => {
    if (state.kind === "ready") return state.handler(req, res, next);
    if (state.kind === "off") return offOrPassThrough(req, res, next, state.reason);

    // Still booting: wait briefly so the first requests are tapped too, then let the host answer.
    const timeout = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), BOOT_WAIT_MS).unref());
    Promise.race([state.ready, timeout]).then(() => {
      if (state.kind === "ready") return state.handler(req, res, next);
      return offOrPassThrough(req, res, next, state.kind === "off" ? state.reason : "AgentDesk is still starting.");
    });
  });

  function offOrPassThrough(req: Request, res: Response, next: NextFunction, reason: string) {
    const path = req.path;
    if (ownPaths.some((p) => path === p || path.startsWith(`${p}/`))) {
      res.status(503).json({ error: "agentdesk_unavailable", message: reason });
      return;
    }
    next();
  }

  return outer;
}

export default agentdesk;
