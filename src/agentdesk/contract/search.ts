import type { Collection, Document, Filter, WithId } from "mongodb";
import { VECTOR_INDEX_NAME } from "./db.js";
import { cosine } from "./embed.js";

// Semantic search shared by every part. Uses Atlas Vector Search when the index is
// queryable, otherwise in-process cosine similarity over the site's documents
// (a new index takes about a minute to build, and free clusters cap index count).

export interface SearchOptions<T> {
  siteId: string;
  k?: number;
  /** Extra filter on fields declared in the vector index (db.ts VECTOR_FILTERS). */
  filter?: Filter<T>;
  /** Drop results below this cosine score (0 to 1). */
  minScore?: number;
}

export type Scored<T> = WithId<T> & { score: number };

const FALLBACK_SCAN_LIMIT = 2000;
const READY_CACHE_MS = 30_000;
const readyCache = new Map<string, { ready: boolean; at: number }>();

export async function vectorSearch<T extends Document & { embedding: number[] }>(
  col: Collection<T>,
  vector: number[],
  options: SearchOptions<T>,
): Promise<Scored<T>[]> {
  const k = options.k ?? 5;
  const filter = { siteId: options.siteId, ...(options.filter ?? {}) } as Filter<T>;
  const minScore = options.minScore ?? 0;

  let results: Scored<T>[];
  if (await indexReady(col)) {
    results = (await col
      .aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: "embedding",
            queryVector: vector,
            numCandidates: Math.max(50, k * 10),
            limit: k,
            filter,
          },
        },
        // Atlas reports cosine as (1 + cos) / 2; convert back so both paths return plain cosine.
        { $addFields: { score: { $subtract: [{ $multiply: [{ $meta: "vectorSearchScore" }, 2] }, 1] } } },
      ])
      .toArray()) as Scored<T>[];
  } else {
    const docs = (await col.find(filter).limit(FALLBACK_SCAN_LIMIT).toArray()) as WithId<T>[];
    results = docs
      .filter((d) => Array.isArray(d.embedding) && d.embedding.length === vector.length)
      .map((d) => ({ ...d, score: cosine(vector, d.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  return results.filter((r) => r.score >= minScore);
}

async function indexReady(col: Collection<any>): Promise<boolean> {
  const key = `${col.dbName}.${col.collectionName}`;
  const cached = readyCache.get(key);
  if (cached && Date.now() - cached.at < READY_CACHE_MS) return cached.ready;
  let ready = false;
  try {
    const [index] = (await col.listSearchIndexes(VECTOR_INDEX_NAME).toArray()) as { queryable?: boolean; status?: string }[];
    ready = Boolean(index && (index.queryable === true || index.status === "READY"));
  } catch {
    ready = false;
  }
  readyCache.set(key, { ready, at: Date.now() });
  return ready;
}
