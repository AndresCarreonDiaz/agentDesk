import type { AgentDeskContext } from "../contract/context.js";
import { listActions, TOOL_NAMES, type ToolName } from "./tools.js";

// The desk brain: turns an agent's plain-language message into one of the five tools.
// Agents that already know the tools (MCP, scripted visitors) skip this and call a tool directly.

export interface Routed {
  tool: ToolName;
  input: Record<string, unknown>;
  /** What the agent says it wants, when it says so. Saved as the episode goal. */
  goal: string | null;
}

const ROUTE_SCHEMA = {
  type: "object",
  properties: {
    tool: { type: "string", enum: [...TOOL_NAMES] },
    question: { type: "string", description: "for ask: the question" },
    action: { type: "string", description: "for do: the exact action name from the list" },
    input: { type: "object", description: "for do: the action input, following its inputSchema" },
    goalSuccess: { type: "boolean", description: "for done" },
    note: { type: "string", description: "for done: what happened" },
    goal: { type: "string", description: "what the agent wants to achieve on this site, if it says so" },
  },
  required: ["tool"],
};

export async function route(ctx: AgentDeskContext, message: string): Promise<Routed> {
  const actions = ((await listActions(ctx)).data as { actions?: unknown[] } | undefined)?.actions ?? [];
  const decided = await ctx.llm.json<{
    tool: ToolName;
    question?: string;
    action?: string;
    input?: Record<string, unknown>;
    goalSuccess?: boolean;
    note?: string;
    goal?: string;
  }>(
    {
      system:
        "You route a visiting AI agent's message to one tool of a website's front desk.\n" +
        "Tools: about (what the site is and offers), ask (a question about the site), list_actions (what actions can be run), " +
        "do (run one action from the list, with its input), done (the agent says it finished, with goalSuccess and a note).\n" +
        "Pick do ONLY if the message asks for something one listed action does, and fill input from the message using the action's inputSchema. " +
        "If the agent wants something no listed action does, pick list_actions. Greetings and 'what can I do here' are about.",
      prompt: `Actions available right now: ${JSON.stringify(actions)}\n\nAgent message: ${message}`,
      temperature: 0,
    },
    ROUTE_SCHEMA,
  );

  const tool = TOOL_NAMES.includes(decided.tool) ? decided.tool : "about";
  const input: Record<string, unknown> =
    tool === "ask" ? { question: decided.question || message }
    : tool === "do" ? { action: decided.action ?? "", input: decided.input ?? {} }
    : tool === "done" ? { goalSuccess: decided.goalSuccess ?? false, note: decided.note ?? message }
    : tool === "list_actions" ? { query: message }
    : {};
  return { tool, input, goal: decided.goal?.trim() || null };
}
