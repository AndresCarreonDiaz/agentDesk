import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { EXPLORE_HEADER, EXPLORE_SECRET } from "../contract/site.js";
import { newId } from "../contract/ids.js";
import type { RequestDoc, RequestSource, RuleDoc } from "../contract/types.js";
import { bodyShape, flatQuery, storableBody } from "./redact.js";
import { activeRules, matchesRequest, matchesRoute } from "./rules.js";
import { REPLAY_HEADER, REPLAY_SECRET, episodeForSession, sessionFromHeaders } from "./sessions.js";

// The tap: records every request the host app handles into `requests` (CONTRACT section 3),
// and refuses agent fallback clicks that match an active rule (so a guardrail cannot be clicked around).
//
// It must never break the host app:
// - it never reads a request body unless an active rule needs a body field on this exact route;
// - it never answers a host request with its own error (parse errors skip the check, not the request);
// - every recording failure is logged and swallowed.

const STATIC_ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|otf|txt)$/i;
const STATIC_PREFIX = /^\/(_next|static|assets|favicon)/i;

export interface TapOptions {
  /** Paths the desk serves itself (discovery, /agent, /mcp, the panel): not host traffic. */
  ownPaths: string[];
}

export function isStaticAsset(path: string): boolean {
  return STATIC_ASSET.test(path) || STATIC_PREFIX.test(path);
}

// Only used when a rule needs a body field and the host has not parsed the body yet.
const keepRaw = (req: Request, _res: Response, buf: Buffer) => {
  (req as Request & { rawBody?: Buffer }).rawBody = buf;
};
const parseJson = express.json({ limit: "10mb", verify: keepRaw });
const parseForm = express.urlencoded({ extended: true, limit: "10mb", verify: keepRaw });

export function createTap(ctx: AgentDeskContext, options: TapOptions): RequestHandler {
  return function tap(req: Request, res: Response, next: NextFunction) {
    let source: RequestSource;
    let path: string;
    try {
      path = req.originalUrl.split("?")[0] || "/";
      if (isOwnPath(path, options.ownPaths) || isStaticAsset(path)) return next();
      if (req.headers[EXPLORE_HEADER] === EXPLORE_SECRET) return next(); // the desk reading its own site

      const started = process.hrtime.bigint();
      const sessionId = sessionFromHeaders(req.headers);
      source = req.headers[REPLAY_HEADER] === REPLAY_SECRET ? "capability" : sessionId ? "fallback" : "direct";
      const requestId = newId("req");
      const recordedSource = source;
      res.on("finish", () => {
        record(ctx, req, res, { requestId, sessionId, source: recordedSource, path, started }).catch((err) =>
          ctx.log.error("tap: could not record a request", err),
        );
      });
    } catch (err) {
      ctx.log.error("tap: skipped a request", err);
      return next();
    }

    // Rules apply to agent fallback clicks here; capability calls are checked by `do` itself.
    if (source !== "fallback") return next();
    enforce(ctx, req, res, next, path).catch((err) => {
      ctx.log.error("tap: rule check failed, letting the request through", err);
      next();
    });
  };
}

async function enforce(ctx: AgentDeskContext, req: Request, res: Response, next: NextFunction, path: string): Promise<void> {
  const rules = await activeRules(ctx);
  const route = { method: req.method, path };
  const onRoute = rules.filter((r) => r.compiled.match && matchesRoute(r.compiled.match, route));
  if (onRoute.length === 0) return next();

  const routeOnly = onRoute.find((r) => !r.compiled.match?.bodyField);
  if (routeOnly) return refuse(res, routeOnly);

  // Some rule needs a body field. Use the host's parsed body if it already ran, else parse a copy.
  if (req.body !== undefined) return checkBody(req.body);
  const parser = req.is("application/json") ? parseJson : req.is("application/x-www-form-urlencoded") ? parseForm : null;
  if (!parser) {
    // A body we cannot read (multipart, binary) on a route a body-field rule guards: refuse
    // rather than let an agent click around the guardrail with a different encoding.
    return refuse(res, onRoute[0]);
  }
  parser(req, res, (err?: unknown) => {
    if (err) {
      ctx.log.warn(`tap: could not read a body to check rules (${(err as Error).message}); letting it through`);
      return next();
    }
    checkBody(req.body);
  });

  function checkBody(body: unknown) {
    const rule = onRoute.find((r) => matchesRequest(r.compiled.match, { ...route, body }));
    return rule ? refuse(res, rule) : next();
  }
}

function refuse(res: Response, rule: RuleDoc): void {
  res.status(403).json({
    error: "blocked_by_rule",
    rule: rule.text,
    ruleId: rule.ruleId,
    message: `The site owner does not allow agents to do this: ${rule.text}`,
  });
}

async function record(
  ctx: AgentDeskContext,
  req: Request,
  res: Response,
  facts: { requestId: string; sessionId: string | null; source: RequestSource; path: string; started: bigint },
): Promise<void> {
  // Read the body at finish time: the host's own body parser has run by now.
  const body = req.body;
  const now = new Date();
  const doc: RequestDoc = {
    siteId: ctx.config.siteId,
    createdAt: now,
    requestId: facts.requestId,
    sessionId: facts.sessionId,
    episodeId: facts.sessionId ? await episodeForSession(ctx, facts.sessionId).catch(() => null) : null,
    source: facts.source,
    method: req.method,
    path: facts.path,
    query: flatQuery(req.query),
    bodyShape: bodyShape(body),
    body: storableBody(body),
    status: res.statusCode,
    durationMs: Number((process.hrtime.bigint() - facts.started) / 1_000_000n),
    timestamp: now,
  };
  try {
    await ctx.cols.requests.insertOne(doc);
  } catch (err) {
    // Still record that the request happened, without the parts that can make a document invalid.
    ctx.log.warn(`tap: stored a request without its body (${(err as Error).message})`);
    await ctx.cols.requests.insertOne({ ...doc, query: {}, bodyShape: {}, body: null });
  }
}

function isOwnPath(path: string, own: string[]): boolean {
  return own.some((p) => path === p || path.startsWith(`${p}/`));
}
