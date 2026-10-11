import { Router, type NextFunction, type Request, type Response } from "express";
import { AgentDeskConfigError, normalizePath, type AgentDeskOptions } from "./contract/config.js";
import { consoleLogger, createContext, type AgentDeskContext, type Logger } from "./contract/context.js";
import { createDoorRouter } from "./door/index.js";
import { isStaticAsset } from "./door/tap.js";
import { TOOL_NAMES } from "./door/tools.js";
import { startLoop } from "./loop/index.js";
import { startPanel } from "./panel/index.js";

export type { AgentDeskOptions } from "./contract/config.js";
export type { AgentDeskContext } from "./contract/context.js";

// The whole install: app.use(agentdesk()). Put it before your own routes so the tap sees them.
//
// It never takes the host app down. Missing keys turn AgentDesk off (the site keeps working,
// agent endpoints answer 503). That is the toggle: remove the key and it is off.
// A network error at boot keeps the site working and retries in the background.

type State =
  | { kind: "booting" }
  | { kind: "ready"; handler: Router; ctx: AgentDeskContext }
  | { kind: "off"; reason: string };

const BOOT_WAIT_MS = 3_000;
const RETRY_MS = [5_000, 30_000, 120_000];

/** The installed middleware. `ready` resolves to true once the desk is serving (false if it is off). */
export type AgentDeskMiddleware = Router & { ready: Promise<boolean> };

export function agentdesk(options: AgentDeskOptions = {}, log: Logger = consoleLogger): AgentDeskMiddleware {
  const panelPath = normalizePath(options.panelPath);
  const deadline = Date.now() + BOOT_WAIT_MS;
  let state: State = { kind: "booting" };
  let firstBoot: Promise<void>;

  const attempt = (retry: number): Promise<void> =>
    boot().catch((err) => {
      if (err instanceof AgentDeskConfigError) {
        state = { kind: "off", reason: err.message };
        log.error(`AgentDesk is off. ${err.message}`);
        return;
      }
      const wait = RETRY_MS[Math.min(retry, RETRY_MS.length - 1)];
      state = { kind: "off", reason: `AgentDesk could not start (${(err as Error).message}); retrying.` };
      log.error(`AgentDesk could not start; the site keeps working, retrying in ${wait / 1000}s.`, err);
      setTimeout(() => attempt(retry + 1), wait).unref();
    });

  async function boot(): Promise<void> {
    const started = Date.now();
    const { ctx, adminToken } = await createContext({ ...options, panelPath }, log);
    // Print the link before any other part runs, so a failing part can never lose it.
    if (adminToken) log.info(`your private panel link (shown once, keep it): ${ctx.config.panelPath}?token=${adminToken}`);

    const handler = Router();
    handler.use(createDoorRouter(ctx));
    try {
      handler.use(ctx.config.panelPath, startPanel(ctx));
    } catch (err) {
      log.error("panel failed to start; agents are still served", err);
    }
    state = { kind: "ready", handler, ctx };
    log.info(`ready in ${Date.now() - started} ms for site "${ctx.config.siteId}" (database "${ctx.config.dbName}", ${ctx.llm.provider} ${ctx.llm.model}, ${ctx.settings.embedding.provider} embeddings)`);

    // The Loop runs in the background: it never gates the door.
    Promise.resolve()
      .then(() => startLoop(ctx))
      .catch((err) => log.error("loop failed to start; agents are still served", err));
  }

  firstBoot = attempt(0);

  const outer = Router();
  outer.use((req: Request, res: Response, next: NextFunction) => {
    if (state.kind === "ready") return state.handler(req, res, next);
    if (state.kind === "off") return offOrPassThrough(req, res, next, state.reason);

    // Still booting: hold requests until one shared deadline so the first ones are tapped too.
    const remaining = deadline - Date.now();
    if (remaining <= 0 || req.method === "HEAD" || req.method === "OPTIONS" || isStaticAsset(req.path)) {
      return offOrPassThrough(req, res, next, "AgentDesk is still starting.");
    }
    const timeout = new Promise<void>((r) => setTimeout(r, remaining).unref());
    Promise.race([firstBoot, timeout]).then(() => {
      if (state.kind === "ready") return state.handler(req, res, next);
      return offOrPassThrough(req, res, next, state.kind === "off" ? state.reason : "AgentDesk is still starting.");
    });
  });

  /** When not ready, answer 503 only on the exact routes the desk serves; everything else is the host's. */
  function offOrPassThrough(req: Request, res: Response, next: NextFunction, reason: string) {
    if (isDeskRoute(req.path, panelPath)) {
      res.status(503).json({ error: "agentdesk_unavailable", message: reason });
      return;
    }
    next();
  }

  return Object.assign(outer, { ready: firstBoot.then(() => (state as State).kind === "ready") });
}

function isDeskRoute(path: string, panelPath: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (p === "/.well-known/agentdesk" || p === "/mcp" || p === "/agent") return true;
  if (p.startsWith("/agent/") && (TOOL_NAMES as readonly string[]).includes(p.slice("/agent/".length))) return true;
  return p === panelPath || p.startsWith(`${panelPath}/`);
}

export default agentdesk;
