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
    embedBatch = async (texts, kind) => {
      const res = await withRetry(async () => {
        const r = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({
            input: texts,
            model: settings.model,
            input_type: kind,
            output_dimension: settings.dims,
          }),
        });
        if (!r.ok) {
          const error = new Error(`Voyage embeddings failed: HTTP ${r.status} ${await r.text()}`);
          (error as Error & { status: number }).status = r.status;
          throw error;
        }
        return (await r.json()) as { data: { embedding: number[]; index: number }[] };
      });
      return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
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
