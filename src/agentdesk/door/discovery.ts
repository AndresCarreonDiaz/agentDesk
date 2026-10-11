import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AgentDeskContext } from "../contract/context.js";
import { LIST_ACTIONS_HINT, TOOL_NAMES } from "./tools.js";

// Auto-discovery: an agent that lands on any page of an AgentDesk site can find the desk.
//   - the site's own llms.txt gets a "For AI agents" section (agents read llms.txt first)
//   - /.well-known/mcp: an MCP server card pointing at /mcp
//   - a Link header on every page: </mcp>; rel="mcp"
// Nothing here changes what the host's pages say; it only adds pointers.

export const LINK_HEADER = '</mcp>; rel="mcp", </.well-known/agentdesk>; rel="agent-desk", </agent/about>; rel="agent-desk-about"';

/** The site's public base URL, as the visiting agent sees it (behind a proxy too). */
export function siteBase(req: Request): string {
  const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(",")[0]?.trim();
  const proto = first(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  const host = first(req.headers["x-forwarded-host"]) || req.headers.host || "localhost";
  return `${proto}://${host}`;
}

export function agentsSection(base: string): string {
  return [
    "",
    "## For AI agents",
    "",
    "This site has an AgentDesk front desk for AI agents. It answers questions about the site and runs actions for you, and it learns from every visit.",
    "",
    `- MCP (Streamable HTTP): ${base}/mcp (tools: ${TOOL_NAMES.join(", ")})`,
    `- Plain HTTP: POST ${base}/agent/<tool> with JSON, for example POST ${base}/agent/do {"action": "...", "input": {...}}`,
    `- Just reading: open ${base}/agent/about, ${base}/agent/list_actions or ${base}/agent/ask?question=...`,
    `- Discovery: ${base}/.well-known/agentdesk and ${base}/.well-known/mcp`,
    "",
    `Start with about. ${LIST_ACTIONS_HINT} Finish with done (POST ${base}/agent/done {"goalSuccess": true, "note": "..."}).`,
    "",
  ].join("\n");
}

export function mcpServerCard(ctx: AgentDeskContext, base: string) {
  return {
    name: `agentdesk/${ctx.config.siteId}`,
    title: `${ctx.config.siteId} front desk for AI agents`,
    description: "This site's front desk for AI agents. It starts knowing nothing and learns from every visit.",
    version: "1",
    remotes: [{ type: "streamable-http", url: `${base}/mcp` }],
    tools: TOOL_NAMES,
    alsoAvailable: { http: `${base}/agent`, discovery: `${base}/.well-known/agentdesk` },
  };
}

/** Adds the Link header to host pages and the agents section to the host's llms.txt. Never changes anything else. */
export function createDiscovery(): RequestHandler {
  return function discovery(req: Request, res: Response, next: NextFunction) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    try {
      if (!res.headersSent) res.append("Link", LINK_HEADER);
      if (req.path === "/llms.txt") appendToLlmsTxt(req, res);
    } catch {
      // Discovery is a courtesy: never let it break the host's response.
    }
    next();
  };
}

function appendToLlmsTxt(req: Request, res: Response): void {
  const send = res.send.bind(res);
  res.send = ((body?: unknown) => {
    res.send = send; // only once
    if (res.statusCode === 200 && typeof body === "string" && !body.includes("## For AI agents")) {
      return send(body.replace(/\s*$/, "\n") + agentsSection(siteBase(req)));
    }
    return send(body);
  }) as Response["send"];
}
