// A tiny in-memory stand-in for the Atlas collections, enough for Door tests without a database.
// Supports equality filters, $in, sort by one or two fields, limit, $set/$push/$inc/$addToSet.
import type { AgentDeskContext } from "../src/agentdesk/contract/context.js";

type Doc = Record<string, any>;

function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const actual = k.split(".").reduce<any>((o, p) => o?.[p], doc);
    if (v && typeof v === "object" && !Array.isArray(v) && "$in" in v) return (v.$in as unknown[]).includes(actual);
    return actual === v;
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [k, v] of Object.entries(update.$set ?? {})) doc[k] = v;
  for (const [k, v] of Object.entries(update.$inc ?? {})) {
    const [a, b] = k.split(".");
    if (b) doc[a][b] = (doc[a][b] ?? 0) + (v as number);
    else doc[a] = (doc[a] ?? 0) + (v as number);
  }
  for (const [k, v] of Object.entries(update.$push ?? {})) {
    doc[k] = [...(doc[k] ?? []), ...((v as Doc)?.$each ?? [v])];
  }
  for (const [k, v] of Object.entries(update.$addToSet ?? {})) {
    for (const x of (v as Doc)?.$each ?? [v]) if (!(doc[k] ?? []).includes(x)) doc[k] = [...(doc[k] ?? []), x];
  }
}

export class FakeCollection {
  docs: Doc[] = [];
  async insertOne(d: Doc) { this.docs.push(structuredClone(d)); return { acknowledged: true }; }
  async findOne(f: Doc = {}) { return this.docs.find((d) => matches(d, f)) ?? null; }
  async updateOne(f: Doc, u: Doc) {
    const d = this.docs.find((x) => matches(x, f));
    if (d) applyUpdate(d, u);
    return { matchedCount: d ? 1 : 0 };
  }
  async findOneAndUpdate(f: Doc, u: Doc) {
    const d = this.docs.find((x) => matches(x, f));
    if (d) applyUpdate(d, u);
    return d ?? null;
  }
  find(f: Doc = {}) {
    let rows = this.docs.filter((d) => matches(d, f));
    const cursor = {
      sort: (s: Doc) => {
        const keys = Object.entries(s);
        rows = [...rows].sort((a, b) => {
          for (const [k, dir] of keys) if (a[k] !== b[k]) return (a[k] > b[k] ? 1 : -1) * (dir as number);
          return 0;
        });
        return cursor;
      },
      limit: (n: number) => { rows = rows.slice(0, n); return cursor; },
      toArray: async () => rows,
    };
    return cursor;
  }
}

export function fakeCtx(siteId = "test-site"): { ctx: AgentDeskContext; cols: Record<string, FakeCollection> } {
  const cols = {
    requests: new FakeCollection(),
    episodes: new FakeCollection(),
    capabilities: new FakeCollection(),
    knowledge: new FakeCollection(),
    intents: new FakeCollection(),
    rules: new FakeCollection(),
    feedback: new FakeCollection(),
    settings: new FakeCollection(),
  };
  const ctx = {
    config: { siteId, panelPath: "/agentdesk", dbName: siteId },
    cols,
    settings: { embedding: { provider: "gemini", model: "test", dims: 3 } },
    embedder: { embed: async (t: string[]) => t.map(() => [1, 0, 0]), embedOne: async () => [1, 0, 0] },
    llm: { provider: "gemini", model: "test", text: async () => "UNKNOWN", json: async () => ({ tool: "about" }) },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as AgentDeskContext;
  return { ctx, cols };
}
