import express, { Router, type Request } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import type { EpisodeDoc, Turn } from "../contract/types.js";
import { route } from "./brain.js";
import { appendTurns, markDone, openEpisode } from "./episodes.js";
import { SESSION_HEADER, sessionFromHeaders } from "./sessions.js";
import { about, ask, doAction, listActions, TOOL_NAMES, type ToolName, type ToolResult } from "./tools.js";

// POST /agent: the five tools over plain HTTP (CONTRACT section 4, parts/door.md).
//   { sessionId?, message }        plain language, the desk brain picks the tool
//   { sessionId?, tool, input }    a tool directly (scripted agents, MCP)
//   POST /agent/<tool> { sessionId?, ...input }   the same, shorter
//   POST /agent/done { sessionId, goalSuccess, note? }
// Every response carries the x-agentdesk-session header.

export interface RunArgs {
  tool: ToolName;
  input: Record<string, unknown>;
  baseUrl: string;
}

/** Shared by POST /agent and /mcp, so both doors behave the same. */
export async function runTool(ctx: AgentDeskContext, episode: EpisodeDoc, args: RunArgs): Promise<ToolResult> {
  const { tool, input } = args;
  switch (tool) {
    case "about":
      return about(ctx);
    case "ask":
      return ask(ctx, String(input.question ?? input.message ?? ""));
    case "list_actions":
      return listActions(ctx, typeof input.query === "string" ? input.query : undefined);
    case "do": {
      const action = String(input.action ?? "");
      const actionInput = (input.input && typeof input.input === "object" ? input.input : {}) as Record<string, unknown>;
      if (!action) return { reply: "do needs an action name. Call list_actions first.", unknown: true, data: { ok: false, error: "missing_action" } };
      return doAction(ctx, episode, args.baseUrl, action, actionInput);
    }
    case "done": {
      const goalSuccess = input.goalSuccess === true || input.goalSuccess === "true";
      const note = typeof input.note === "string" ? input.note : null;
      await markDone(ctx, episode.sessionId, goalSuccess, note);
      return { reply: "Thanks. Your feedback helps the next visitor.", data: { ok: true } };
    }
  }
}

/** Where `do` replays requests: the host app itself, on the local socket (skips proxies and TLS). */
export function hostBaseUrl(req: Request): string {
  const port = req.socket.localPort;
  if (port) return `http://127.0.0.1:${port}`;
  return `${req.protocol}://${req.get("host")}`;
}

const USAGE = {
  about: "POST /agent { \"message\": \"what can I do here?\" }",
  tools: TOOL_NAMES,
  direct: "POST /agent { \"tool\": \"list_actions\" } or POST /agent/do { \"action\": \"add_to_cart\", \"input\": { ... } }",
  done: "POST /agent/done { \"sessionId\": \"ses_...\", \"goalSuccess\": true, \"note\": \"...\" }",
  session: `Send the ${SESSION_HEADER} header (or sessionId in the body) from the first response on every later call, and as the agentdesk_session cookie if you use the website.`,
  mcp: "The same five tools over MCP at /mcp.",
};

export function createAgentRouter(ctx: AgentDeskContext): Router {
  const router = Router();
  router.use(express.json({ limit: "256kb" }));

  // Teaching response (Bubblio lesson): a GET explains how to use the door.
  router.get("/", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ error: "use_post", usage: USAGE });
  });

  router.post(["/", "/:tool"], async (req, res) => {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    try {
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : sessionFromHeaders(req.headers);
      const pathTool = req.params.tool as string | undefined;
      const tool = (pathTool ?? body.tool) as string | undefined;
      const message = typeof body.message === "string" ? body.message.slice(0, 4000) : null;

      if (tool !== undefined && !TOOL_NAMES.includes(tool as ToolName)) {
        res.status(400).json({ error: "unknown_tool", message: `Tools are: ${TOOL_NAMES.join(", ")}.`, usage: USAGE });
        return;
      }
      if (!tool && !message) {
        res.status(400).json({ error: "missing_message", message: "Send { message } in plain words, or { tool, input }.", usage: USAGE });
        return;
      }
      if (tool === "done" && !sessionId) {
        res.status(400).json({ error: "missing_session", message: "done needs the sessionId from your first call.", usage: USAGE });
        return;
      }

      const episode = await openEpisode(ctx, sessionId, req.headers);
      res.setHeader(SESSION_HEADER, episode.sessionId);

      let routed: { tool: ToolName; input: Record<string, unknown>; goal: string | null };
      if (tool) {
        const { sessionId: _sid, tool: _tool, ...rest } = body;
        const input = pathTool ? rest : ((body.input as Record<string, unknown>) ?? {});
        routed = { tool: tool as ToolName, input: tool === "do" && pathTool ? { action: body.action, input: body.input } : input, goal: typeof body.goal === "string" ? body.goal : null };
      } else {
        routed = await route(ctx, message!);
      }

      const result = await runTool(ctx, episode, { tool: routed.tool, input: routed.input, baseUrl: hostBaseUrl(req) });

      const now = new Date();
      const agentTurn: Turn = { role: "agent", text: message ?? `${routed.tool} ${JSON.stringify(routed.input)}`.slice(0, 2000), at: now };
      const deskTurn: Turn = { role: "desk", text: result.reply.slice(0, 4000), at: now, ...(result.capability ? { capability: result.capability } : {}) };
      if (routed.tool !== "done") {
        await appendTurns(ctx, episode.episodeId, [agentTurn, deskTurn], { goal: routed.goal });
      }

      res.json({
        sessionId: episode.sessionId,
        tool: routed.tool,
        reply: result.reply,
        ...(result.data !== undefined ? { data: result.data } : {}),
        ...(result.capability ? { capabilityCalls: [result.capability] } : {}),
      });
    } catch (err) {
      ctx.log.error("agent: request failed", err);
      if (!res.headersSent) res.status(500).json({ error: "desk_error", message: "The desk had a problem. You can still use the website directly." });
    }
  });

  return router;
}
