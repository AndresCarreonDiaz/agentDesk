import { GoogleGenAI } from "@google/genai";
import type { AgentDeskConfig } from "./config.js";
import { withRetry } from "./llm.js";
import type { EmbeddingSettings } from "./types.js";

// The only way any part makes an embedding (CONTRACT section 1).
// The provider is locked at first start in settings.embedding: vectors from two
// models cannot be compared, so never switch providers on an existing database.

export type EmbedKind = "query" | "document";

export interface Embedder {
  settings: EmbeddingSettings;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
  embedOne(text: string, kind: EmbedKind): Promise<number[]>;
}

export const VOYAGE_EMBEDDING: EmbeddingSettings = { provider: "voyage", model: "voyage-3.5", dims: 1024 };
export const GEMINI_EMBEDDING: EmbeddingSettings = { provider: "gemini", model: "gemini-embedding-001", dims: 768 };

/** What a brand new database gets locked to. */
export function chooseEmbedding(config: AgentDeskConfig): EmbeddingSettings {
  return config.voyageApiKey ? VOYAGE_EMBEDDING : GEMINI_EMBEDDING;
}

export function createEmbedder(settings: EmbeddingSettings, config: AgentDeskConfig): Embedder {
  let embedBatch: (texts: string[], kind: EmbedKind) => Promise<number[][]>;

  if (settings.provider === "voyage") {
    const key = config.voyageApiKey;
    if (!key) {
      throw new Error(
        "AgentDesk: this database is locked to Voyage embeddings but VOYAGE_API_KEY is missing. Add it back to .env.",
      );
    }
    // A key made in Atlas (AI Model APIs) only works on ai.mongodb.com; a key made on voyageai.com
    // only works on api.voyageai.com. Try Atlas first, switch once on an auth error, and remember.
    const endpoints = config.voyageBaseUrl
      ? [config.voyageBaseUrl]
      : ["https://ai.mongodb.com/v1/embeddings", "https://api.voyageai.com/v1/embeddings"];
    let working: string | null = config.voyageBaseUrl ?? null;

    const call = async (url: string, texts: string[], kind: EmbedKind) => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ input: texts, model: settings.model, input_type: kind, output_dimension: settings.dims }),
      });
      if (!r.ok) {
        const error = new Error(`Voyage embeddings failed at ${new URL(url).host}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
        (error as Error & { status: number }).status = r.status;
        throw error;
      }
      return (await r.json()) as { data: { embedding: number[]; index: number }[] };
    };

    embedBatch = async (texts, kind) => {
      const tryOrder = working ? [working] : endpoints;
      let lastError: unknown;
      for (const url of tryOrder) {
        try {
          const res = await withRetry(() => call(url, texts, kind));
          working = url;
          return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
        } catch (err) {
          lastError = err;
          const status = (err as { status?: number }).status;
          if (status !== 401 && status !== 403) throw err; // only an auth error means "wrong endpoint for this key"
        }
      }
      throw lastError;
    };
  } else {
    const key = config.geminiApiKey;
    if (!key) {
      throw new Error(
        "AgentDesk: this database is locked to Gemini embeddings but GEMINI_API_KEY is missing. Add it back to .env.",
      );
    }
    const ai = new GoogleGenAI({ apiKey: key });
    embedBatch = async (texts, kind) => {
      const res = await withRetry(() =>
        ai.models.embedContent({
          model: settings.model,
          contents: texts,
          config: {
            outputDimensionality: settings.dims,
            taskType: kind === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          },
        }),
      );
      const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
      if (vectors.length !== texts.length) {
        throw new Error(`Gemini embeddings returned ${vectors.length} vectors for ${texts.length} texts`);
      }
      // Below 3072 dimensions Gemini vectors are not normalised; cosine search expects unit length.
      return vectors.map(normalize);
    };
  }

  const BATCH = 64;
  async function embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      out.push(...(await embedBatch(texts.slice(i, i + BATCH), kind)));
    }
    return out;
  }

  return {
    settings,
    embed,
    async embedOne(text, kind) {
      const [vector] = await embed([text], kind);
      return vector;
    },
  };
}

export function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}
