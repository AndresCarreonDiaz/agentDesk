// A tiny in-memory stand-in for the Atlas collections, enough for Door tests without a database.
// Supports equality filters, $in, sort by one or two fields, limit, $set/$push/$inc/$addToSet.
// Filters, $set and $inc take dotted paths ("stats.consecutiveFailures") like Mongo, creating missing fields.
import type { AgentDeskContext } from "../src/agentdesk/contract/context.js";

type Doc = Record<string, any>;

const getPath = (doc: Doc, path: string): any => path.split(".").reduce<any>((o, p) => o?.[p], doc);

function setPath(doc: Doc, path: string, value: unknown): void {
  const keys = path.split(".");
  const last = keys.pop()!;
  const parent = keys.reduce<Doc>((o, k) => (o[k] ??= {}), doc);
  parent[last] = value;
}

function matches(doc: Doc, filter: Doc = {}): boolean {
  return Object.entries(filter).every(([k, v]) => {
    const actual = getPath(doc, k);
    if (v && typeof v === "object" && !Array.isArray(v) && "$in" in v) return (v.$in as unknown[]).includes(actual);
    return actual === v;
  });
}

function applyUpdate(doc: Doc, update: Doc): void {
  for (const [k, v] of Object.entries(update.$set ?? {})) setPath(doc, k, v);
  for (const [k, v] of Object.entries(update.$inc ?? {})) setPath(doc, k, (getPath(doc, k) ?? 0) + (v as number));
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
  async insertMany(ds: Doc[]) { for (const d of ds) this.docs.push(structuredClone(d)); return { acknowledged: true }; }
  async countDocuments(f: Doc = {}) { return this.docs.filter((d) => matches(d, f)).length; }
  async findOne(f: Doc = {}) { return this.docs.find((d) => matches(d, f)) ?? null; }
  async updateOne(f: Doc, u: Doc) {
    const d = this.docs.find((x) => matches(x, f));
    if (d) applyUpdate(d, u);
    return { matchedCount: d ? 1 : 0 };
  }
  // Like the driver: the document before the update, unless returnDocument is "after".
  async findOneAndUpdate(f: Doc, u: Doc, o: Doc = {}) {
    const d = this.docs.find((x) => matches(x, f));
    if (!d) return null;
    const before = structuredClone(d);
    applyUpdate(d, u);
    return o.returnDocument === "after" ? structuredClone(d) : before;
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
    audit: new FakeCollection(),
  };
  const ctx = {
    config: { siteId, panelPath: "/agentdesk", dbName: siteId, autopilotDefault: false },
    cols,
    settings: { embedding: { provider: "gemini", model: "test", dims: 3 } },
    embedder: { embed: async (t: string[]) => t.map(() => [1, 0, 0]), embedOne: async () => [1, 0, 0] },
    llm: { provider: "gemini", model: "test", text: async () => "UNKNOWN", json: async () => ({ tool: "about" }) },
    log: { info() {}, warn() {}, error() {} },
  } as unknown as AgentDeskContext;
  return { ctx, cols };
}
