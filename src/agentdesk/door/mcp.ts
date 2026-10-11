import express, { Router, type Request } from "express";
import type { IncomingHttpHeaders } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { AgentDeskContext } from "../contract/context.js";
import { newId } from "../contract/ids.js";
import type { Turn } from "../contract/types.js";
import { hostBaseUrl, runTool } from "./agent-route.js";
import { appendTurns, openEpisode } from "./episodes.js";
import { SESSION_HEADER } from "./sessions.js";
import { LIST_ACTIONS_HINT, type ToolName, type ToolResult } from "./tools.js";

// /mcp: the same five fixed tools over MCP (Streamable HTTP, JSON responses).
//
// Stateless on purpose: no in-memory sessions, so restarts and several instances are fine.
// On initialize the desk hands out an AgentDesk session id as Mcp-Session-Id; clients send it
// back on every request, and it is the same sessionId the episode and the tap use.

const MCP_SESSION_HEADER = "mcp-session-id";
const SESSION_ID = /^ses_[a-f0-9]{8,64}$/;

export function createMcpRouter(ctx: AgentDeskContext, version = "0.1.0"): Router {
  const router = Router();
  router.use(express.json({ limit: "256kb" }));

  // Teaching responses (Bubblio lesson): a browser or curl GET learns how to connect.
  router.get("/", (_req, res) => {
    res.status(405).set("Allow", "POST").json({
      error: "use_post",
      message: "This is an MCP endpoint (Streamable HTTP). Connect an MCP client to this URL with POST.",
      example: { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "my-agent", version: "1.0" } } },
      tools: ["about", "ask", "list_actions", "do", "done"],
    });
  });
  router.delete("/", (_req, res) => {
    res.status(204).end();
  });

  router.post("/", async (req, res) => {
    try {
      const fromHeader = req.headers[MCP_SESSION_HEADER];
      const given = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
      const sessionId = given && SESSION_ID.test(given) ? given : newId("ses");
      res.setHeader("Mcp-Session-Id", sessionId);
      res.setHeader(SESSION_HEADER, sessionId);

      const init = initializeClient(req.body);
      if (init) {
        // The client's own name is the best agent family we will get ("claude-code", "cursor", ...).
        await openEpisode(ctx, sessionId, withAgent(req.headers, init));
      }

      const server = buildServer(ctx, version, { sessionId, req });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      ctx.log.error("mcp: request failed", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "The desk had a problem. You can still use the website directly." }, id: null });
      }
    }
  });

  return router;
}

function buildServer(ctx: AgentDeskContext, version: string, call: { sessionId: string; req: Request }): McpServer {
  const server = new McpServer(
    { name: `agentdesk-${ctx.config.siteId}`, version },
    { instructions: `This site's front desk for AI agents. It learns from every visit. Start with about. ${LIST_ACTIONS_HINT} Finish with done.` },
  );

  const run = async (tool: ToolName, input: Record<string, unknown>, agentText: string) => {
    const episode = await openEpisode(ctx, call.sessionId, call.req.headers);
    const result = await runTool(ctx, episode, { tool, input, baseUrl: hostBaseUrl(call.req) });
    if (tool !== "done") {
      const now = new Date();
      const turns: Turn[] = [
        { role: "agent", text: agentText.slice(0, 2000), at: now },
        { role: "desk", text: result.reply.slice(0, 4000), at: now, ...(result.capability ? { capability: result.capability } : {}) },
      ];
      await appendTurns(ctx, episode.episodeId, turns).catch((err) => ctx.log.error("mcp: could not save turns", err));
    }
    return toMcp(result);
  };

  server.registerTool(
    "about",
    { title: "About this site", description: "What this site is, what it offers, which actions you can run, and lessons from earlier visits. Start here." },
    async () => run("about", {}, "about"),
  );
  server.registerTool(
    "ask",
    { title: "Ask the desk", description: "Ask a question about this site. The desk answers only from what it has learned and says so when it does not know.", inputSchema: { question: z.string().describe("Your question, in plain words") } },
    async ({ question }) => run("ask", { question }, question),
  );
  server.registerTool(
    "list_actions",
    { title: "List actions", description: `Actions you can run with do, learned from earlier visits, with their input schemas. ${LIST_ACTIONS_HINT}`, inputSchema: { query: z.string().optional().describe("Optional: what you want to do, to rank the actions") } },
    async ({ query }) => run("list_actions", { query }, query ? `list_actions: ${query}` : "list_actions"),
  );
  server.registerTool(
    "do",
    {
      title: "Run an action",
      description: "Run one action from list_actions with its input. Actions that change something need the site owner's approval; the desk tells you if one is not allowed.",
      inputSchema: {
        action: z.string().describe("The action name, exactly as list_actions returns it"),
        input: z.record(z.string(), z.unknown()).optional().describe("The action input, following its inputSchema"),
      },
    },
    async ({ action, input }) => run("do", { action, input: input ?? {} }, `do ${action} ${JSON.stringify(input ?? {})}`),
  );
  server.registerTool(
    "done",
    {
      title: "Finish the visit",
      description: "Tell the desk how your visit ended: did you reach your goal, and what did you want that did not work? This is how the desk learns. Call it at the end.",
      inputSchema: {
        goalSuccess: z.boolean().describe("Did you get what you came for?"),
        note: z.string().optional().describe("What you wanted and what happened, in your own words"),
      },
    },
    async ({ goalSuccess, note }) => run("done", { goalSuccess, note }, "done"),
  );

  return server;
}

function toMcp(result: ToolResult) {
  const text = result.data !== undefined ? `${result.reply}\n\n${JSON.stringify(result.data, null, 2)}` : result.reply;
  const failed = (result.data as { ok?: boolean } | undefined)?.ok === false;
  return { content: [{ type: "text" as const, text }], ...(failed ? { isError: true } : {}) };
}

/** The clientInfo name from an initialize request (single or batched), if this is one. */
function initializeClient(body: unknown): string | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const m of messages) {
    if (m && typeof m === "object" && (m as { method?: string }).method === "initialize") {
      const name = (m as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name;
      return typeof name === "string" ? name : "mcp";
    }
  }
  return null;
}

function withAgent(headers: IncomingHttpHeaders, clientName: string): IncomingHttpHeaders {
  const safe = clientName.toLowerCase().replace(/[^\w:.-]/g, "-").slice(0, 60) || "mcp";
  return { ...headers, "x-agentdesk-agent": headers["x-agentdesk-agent"] ?? safe };
}
