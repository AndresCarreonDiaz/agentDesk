import type { RequestDoc } from "./types.js";

// Everything agentdesk() accepts. All optional: the install stays one line.
export interface AgentDeskOptions {
  db?: string;
  siteId?: string;
  panelPath?: string;
  success?: (requests: RequestDoc[]) => boolean;
  /** Read env from here instead of process.env (tests). */
  env?: Record<string, string | undefined>;
}

export type LlmProvider = "gemini" | "anthropic" | "openai";

export interface AgentDeskConfig {
  mongoUri: string;
  dbName: string;
  siteId: string;
  panelPath: string;
  llm: { provider: LlmProvider; apiKey: string; model: string };
  geminiApiKey: string | null; // Gemini embeddings need it even if another LLM thinks
  voyageApiKey: string | null;
  success?: (requests: RequestDoc[]) => boolean;
  /** AGENTDESK_RESET_ADMIN_TOKEN=1: rotate the panel token and print a new link once (lost link recovery). */
  resetAdminToken: boolean;
}

export const DEFAULT_MODEL: Record<LlmProvider, string> = {
  gemini: "gemini-3.8-flash",
  anthropic: "",
  openai: "",
};

export class AgentDeskConfigError extends Error {
  constructor(message: string) {
    super(`AgentDesk: ${message}`);
    this.name = "AgentDeskConfigError";
  }
}

export function resolveConfig(options: AgentDeskOptions = {}): AgentDeskConfig {
  const env = options.env ?? process.env;
  const mongoUri = env.MONGODB_URI?.trim();
  if (!mongoUri) {
    throw new AgentDeskConfigError(
      "MONGODB_URI is missing. Add your Atlas connection string to .env; AgentDesk keeps its memory in its own database there.",
    );
  }

  // CONTRACT section 1: first key found, in this order.
  const gemini = env.GEMINI_API_KEY?.trim() || null;
  const anthropic = env.ANTHROPIC_API_KEY?.trim() || null;
  const openai = env.OPENAI_API_KEY?.trim() || null;
  let llm: AgentDeskConfig["llm"];
  if (gemini) llm = { provider: "gemini", apiKey: gemini, model: "" };
  else if (anthropic) llm = { provider: "anthropic", apiKey: anthropic, model: "" };
  else if (openai) llm = { provider: "openai", apiKey: openai, model: "" };
  else {
    throw new AgentDeskConfigError(
      "no LLM key found. Add GEMINI_API_KEY (or ANTHROPIC_API_KEY / OPENAI_API_KEY) to .env; the desk thinks with your own key.",
    );
  }
  llm.model = env.AGENTDESK_MODEL?.trim() || DEFAULT_MODEL[llm.provider];

  const voyageApiKey = env.VOYAGE_API_KEY?.trim() || null;
  if (!voyageApiKey && !gemini) {
    throw new AgentDeskConfigError(
      "embeddings need VOYAGE_API_KEY or GEMINI_API_KEY. Add one of them to .env.",
    );
  }

  const dbName = options.db || env.AGENTDESK_DB?.trim() || "agentdesk";
  const siteId = options.siteId || env.AGENTDESK_SITE_ID?.trim() || dbName;
  const panelPath = normalizePath(options.panelPath);

  return {
    mongoUri,
    dbName,
    siteId,
    panelPath,
    llm,
    geminiApiKey: gemini,
    voyageApiKey,
    success: options.success,
    resetAdminToken: env.AGENTDESK_RESET_ADMIN_TOKEN === "1",
  };
}

/** "/agentdesk" style, no trailing slash. Empty or "/" falls back to "/agentdesk": the panel must not shadow the site. */
export function normalizePath(p: string | undefined): string {
  const trimmed = (p ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "/agentdesk";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
