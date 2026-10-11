import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { newId } from "../contract/ids.js";
import type { RequestDoc, RequestSource } from "../contract/types.js";
import { bodyShape, flatQuery, redact } from "./redact.js";
import { refusingRule } from "./rules.js";
import { REPLAY_HEADER, REPLAY_SECRET, episodeForSession, sessionFromHeaders } from "./sessions.js";

// The tap: records every request the host app handles into `requests` (CONTRACT section 3),
// and refuses agent fallback clicks that match an active rule (so a guardrail cannot be clicked around).
// It must never break the host app: every failure is logged and swallowed.

const STATIC_ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|txt)$/i;
const STATIC_PREFIX = /^\/(_next|static|assets|favicon)/i;
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface TapOptions {
  /** Paths the desk serves itself (discovery, /agent, /mcp, the panel): not host traffic. */
  ownPaths: string[];
}

export function createTap(ctx: AgentDeskContext, options: TapOptions): RequestHandler {
  // Parses JSON only for agent-session writes, so active rules can look at body fields.
  // body-parser marks the request as parsed, so the host's own express.json() skips it.
  const parseJson = express.json({ limit: "1mb" });

  return function tap(req: Request, res: Response, next: NextFunction) {
    const path = req.originalUrl.split("?")[0] || "/";
    if (isOwnPath(path, options.ownPaths) || STATIC_ASSET.test(path) || STATIC_PREFIX.test(path)) {
      return next();
    }

    const started = process.hrtime.bigint();
    const sessionId = sessionFromHeaders(req.headers);
    const source: RequestSource =
      req.headers[REPLAY_HEADER] === REPLAY_SECRET ? "capability" : sessionId ? "fallback" : "direct";
    const requestId = newId("req");

    res.on("finish", () => {
      record(ctx, req, res, { requestId, sessionId, source, path, started }).catch((err) =>
        ctx.log.error("tap: could not record a request", err),
      );
    });

    // Rules apply to agent fallback clicks here; capability calls are checked by `do` itself.
    if (source !== "fallback") return next();

    const enforce = () =>
      refusingRule(ctx, { method: req.method, path, body: req.body })
        .then((rule) => {
          if (!rule) return next();
          res.status(403).json({
            error: "blocked_by_rule",
            rule: rule.text,
            ruleId: rule.ruleId,
            message: `The site owner does not allow agents to do this: ${rule.text}`,
          });
        })
        .catch((err) => {
          ctx.log.error("tap: rule check failed, letting the request through", err);
          next();
        });

    if (WRITE_METHODS.has(req.method) && req.is("application/json")) {
      return parseJson(req, res, (err?: unknown) => (err ? next(err) : enforce()));
    }
    return enforce();
  };
}

async function record(
  ctx: AgentDeskContext,
  req: Request,
  res: Response,
  facts: { requestId: string; sessionId: string | null; source: RequestSource; path: string; started: bigint },
): Promise<void> {
  // Read the body at finish time: the host's own body parser has run by now.
  const body = req.body === undefined ? null : req.body;
  const now = new Date();
  const doc: RequestDoc = {
    siteId: ctx.config.siteId,
    createdAt: now,
    requestId: facts.requestId,
    sessionId: facts.sessionId,
    episodeId: facts.sessionId ? await episodeForSession(ctx, facts.sessionId) : null,
    source: facts.source,
    method: req.method,
    path: facts.path,
    query: flatQuery(req.query),
    bodyShape: bodyShape(body),
    body: redact(body),
    status: res.statusCode,
    durationMs: Number((process.hrtime.bigint() - facts.started) / 1_000_000n),
    timestamp: now,
  };
  await ctx.cols.requests.insertOne(doc);
}

function isOwnPath(path: string, own: string[]): boolean {
  return own.some((p) => path === p || path.startsWith(`${p}/`));
}
