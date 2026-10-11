import { GoogleGenAI } from "@google/genai";
import type { AgentDeskConfig } from "./config.js";

// The only way any part calls a model (CONTRACT section 1).

export interface LlmMessage {
  role: "user" | "model";
  text: string;
}

export interface LlmRequest {
  system?: string;
  /** A plain prompt, or a full conversation. */
  prompt?: string;
  messages?: LlmMessage[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface Llm {
  provider: AgentDeskConfig["llm"]["provider"];
  model: string;
  /** Plain text answer. */
  text(req: LlmRequest | string): Promise<string>;
  /** JSON answer, parsed. Pass a JSON Schema to constrain the shape. */
  json<T = unknown>(req: LlmRequest | string, schema?: object): Promise<T>;
}

export class LlmError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(`AgentDesk LLM: ${message}`);
    this.name = "LlmError";
  }
}

export function createLlm(config: AgentDeskConfig): Llm {
  const { provider, apiKey, model } = config.llm;
  if (provider !== "gemini") {
    // Honest gap: only Gemini is wired today (team default, CONTRACT v4).
    const fail = async (): Promise<never> => {
      throw new LlmError(`${provider} is not built yet. Set GEMINI_API_KEY for now.`);
    };
    return { provider, model, text: fail, json: fail };
  }

  const ai = new GoogleGenAI({ apiKey });

  async function generate(input: LlmRequest | string, schema?: object, asJson = false): Promise<string> {
    const req: LlmRequest = typeof input === "string" ? { prompt: input } : input;
    const contents = req.messages?.length
      ? req.messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] }))
      : [{ role: "user" as const, parts: [{ text: req.prompt ?? "" }] }];

    const response = await withRetry(() =>
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: req.system,
          temperature: req.temperature ?? 0.2,
          maxOutputTokens: req.maxOutputTokens,
          ...(asJson ? { responseMimeType: "application/json" } : {}),
          ...(schema ? { responseJsonSchema: schema } : {}),
        },
      }),
    );
    const text = response.text;
    if (text === undefined || text === null) {
      throw new LlmError("the model returned no text (blocked or empty response)");
    }
    return text;
  }

  return {
    provider,
    model,
    text: (req) => generate(req),
    async json<T>(req: LlmRequest | string, schema?: object): Promise<T> {
      const raw = await generate(req, schema, true);
      try {
        return JSON.parse(raw) as T;
      } catch (err) {
        throw new LlmError(`the model returned invalid JSON: ${raw.slice(0, 200)}`, err);
      }
    },
  };
}

/** Retries rate limits and server errors (Gemini returns 429 and 503 under load). */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw lastError;
}

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
  if (typeof status === "number") return status === 429 || status >= 500;
  const message = String((err as Error)?.message ?? err);
  return /\b(429|500|502|503|504)\b|overloaded|unavailable|ECONNRESET|ETIMEDOUT|fetch failed/i.test(message);
}
