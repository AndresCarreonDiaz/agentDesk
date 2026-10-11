import type { AgentDeskContext } from "../contract/context.js";
import { newId } from "../contract/ids.js";
import { DESK_DID_NOT_KNOW, EXPLORE_HEADER, EXPLORE_SECRET, hostBaseUrlFor } from "../contract/site.js";
import type { CapabilityDoc, EpisodeDoc, FailureKind, KnowledgeDoc, Reflection } from "../contract/types.js";
import { embedOrEmpty, nameCapability, withTimeout } from "./naming.js";

// The explorer: when an agent asked something the desk could not answer or do, the desk reads
// its own site and learns from it, so the next agent gets an answer through the MCP alone.
//   - facts from /llms.txt and the home page -> knowledge, source "site_read"
//   - actions from the site's HTML forms -> capabilities at stage "proposed"
// It only reads the host's own pages (same origin), with short timeouts and size limits.

type Learned = Reflection["learned"][number];

const EXPLORE_EVERY_MS = 2 * 60_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_PAGE_BYTES = 300_000;
const MAX_PAGES = 8;
const LLM_TIMEOUT_MS = 20_000;
const lastExplored = new Map<string, number>();

/** Explore after a visit the desk failed: the agent asked what the site is, or for something the desk could not do. */
export function shouldExplore(episode: Pick<EpisodeDoc, "turns">, failure: FailureKind | null): boolean {
  if (failure === "unknown_site" || failure === "unknown_steps") return true;
  // An agent that just left (no done) after "I don't know yet" is the same signal.
  return (episode.turns ?? []).some((t) => t.role === "desk" && DESK_DID_NOT_KNOW.test(t.text));
}

export async function exploreAfterVisit(
  ctx: AgentDeskContext,
  episode: EpisodeDoc,
  failure: FailureKind | null,
): Promise<Learned[]> {
  if (!shouldExplore(episode, failure)) return [];
  const base = hostBaseUrlFor(ctx);
  if (!base) {
    ctx.log.warn("explore: no host URL yet (set AGENTDESK_SITE_URL); skipping");
    return [];
  }
  const key = `${ctx.config.dbName}:${ctx.config.siteId}`;
  const last = lastExplored.get(key) ?? 0;
  if (Date.now() - last < EXPLORE_EVERY_MS) return [];
  lastExplored.set(key, Date.now());
  try {
    return await exploreSite(ctx, base, episode.episodeId);
  } catch (err) {
    ctx.log.error("explore: failed, will try again on a later visit", err);
    lastExplored.set(key, last);
    return [];
  }
}

/** Reads the site and saves what it learns. Exported for tests and for a manual run. */
export async function exploreSite(ctx: AgentDeskContext, base: string, episodeId: string): Promise<Learned[]> {
  const learned: Learned[] = [];
  const [llms, home, sitemap] = await Promise.all([read(base, "/llms.txt"), read(base, "/"), read(base, "/sitemap.xml")]);

  // ---- facts ----
  const haveFacts = await ctx.cols.knowledge.findOne({ siteId: ctx.config.siteId, source: "site_read" }, { projection: { _id: 1 } });
  if (!haveFacts) {
    const source = [llms ? `llms.txt:\n${llms.text}` : "", home ? `Home page text:\n${textOf(home.text)}` : ""].filter(Boolean).join("\n\n").slice(0, 12_000);
    if (source) {
      for (const id of await learnFacts(ctx, source, llms ? `${base}/llms.txt` : `${base}/`)) learned.push({ kind: "knowledge", id });
    }
  }

  // ---- actions from forms ----
  const pages = pickPages(base, [llms?.text ?? "", sitemap?.text ?? "", home?.text ?? ""]);
  const htmlPages = [home, ...(await Promise.all(pages.map((p) => read(base, p))))].filter((p): p is Page => Boolean(p && p.html));
  const forms = dedupeForms(htmlPages.flatMap((p) => formsOf(base, p)));
  const known = await ctx.cols.capabilities.find({ siteId: ctx.config.siteId }, { projection: { embedding: 0 } }).toArray();
  for (const form of forms) {
    if (known.some((c) => c.mappedRequests.some((m) => m.method === form.method && samePath(m.path, form.path)))) continue;
    const id = await saveFormCapability(ctx, form, episodeId);
    if (id) learned.push({ kind: "capability", id });
  }

  ctx.log.info(`explore: read ${htmlPages.length + (llms ? 1 : 0)} pages, learned ${learned.filter((l) => l.kind === "knowledge").length} facts and ${learned.filter((l) => l.kind === "capability").length} actions`);
  return learned;
}

// ---------- reading ----------

interface Page {
  path: string;
  text: string;
  html: boolean;
  title: string;
}

async function read(base: string, path: string): Promise<Page | null> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { [EXPLORE_HEADER]: EXPLORE_SECRET, accept: "text/html,text/plain,application/xml;q=0.9,*/*;q=0.5" },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text|xml|html/.test(type)) return null;
    const text = (await res.text()).slice(0, MAX_PAGE_BYTES);
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    return { path, text, html: /html/.test(type), title };
  } catch {
    return null;
  }
}

/**
 * The site's own origins: where the desk reads it (the local socket) and its public URL. Behind a host
 * like Modelence the pages link to the public URL (SITE_URL), which is the same site.
 */
function siteOrigins(base: string): string[] {
  const origins = [new URL(base).origin];
  for (const url of [process.env.SITE_URL, process.env.AGENTDESK_SITE_URL]) {
    try {
      if (url) origins.push(new URL(url).origin);
    } catch {
      // not a URL
    }
  }
  return origins;
}

/** Same-site pages worth reading for forms: one per kind of page (/products/:slug, /cart, /checkout...). */
export function pickPages(base: string, sources: string[]): string[] {
  const origins = siteOrigins(base);
  const found = new Set<string>();
  for (const s of sources) {
    for (const m of s.matchAll(/(?:href="|\]\(|<loc>)([^")<\s]+)/g)) {
      try {
        const u = new URL(m[1], base);
        if (!origins.includes(u.origin)) continue;
        if (/\.(png|jpe?g|gif|svg|css|js|xml|txt|ico|webp)$/i.test(u.pathname)) continue;
        found.add(u.pathname);
      } catch {
        // not a URL
      }
    }
  }
  const byKind = new Map<string, string>();
  for (const path of found) {
    const parts = path.split("/").filter(Boolean);
    const kind = parts.length > 1 ? `/${parts[0]}/*` : `/${parts[0] ?? ""}`;
    if (kind !== "/" && !byKind.has(kind)) byKind.set(kind, path);
  }
  return [...byKind.values()].slice(0, MAX_PAGES);
}

function textOf(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------- facts ----------

async function learnFacts(ctx: AgentDeskContext, source: string, sourceRef: string): Promise<string[]> {
  const answer = await withTimeout(
    ctx.llm.json<{ facts?: unknown }>(
      {
        system:
          "You are the front desk of a website learning about it from its own pages, so you can answer visiting AI agents. " +
          "Write 5 to 8 short, durable facts an agent would need: what the site is, what it sells or does, key items, " +
          "policies (shipping, returns, payments), and what an agent can do there. Only facts stated in the text. JSON only.",
        prompt: source,
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
      { type: "object", properties: { facts: { type: "array", items: { type: "string" } } }, required: ["facts"] },
    ),
    LLM_TIMEOUT_MS,
    "site facts",
  );
  const facts = (Array.isArray(answer.facts) ? answer.facts : [])
    .filter((f): f is string => typeof f === "string" && f.trim().length > 3)
    .map((f) => f.trim().slice(0, 300))
    .slice(0, 8);
  if (facts.length === 0) return [];

  let vectors: number[][] = [];
  try {
    vectors = await ctx.embedder.embed(facts, "document");
  } catch (err) {
    ctx.log.warn(`explore: could not embed facts (${(err as Error).message}); saving them without vectors`);
  }
  const now = new Date();
  const docs: KnowledgeDoc[] = facts.map((text, i) => ({
    siteId: ctx.config.siteId,
    createdAt: now,
    knowledgeId: newId("kn"),
    text,
    source: "site_read",
    sourceRef,
    intent: null,
    confidence: 0.8,
    embedding: vectors[i] ?? [],
  }));
  await ctx.cols.knowledge.insertMany(docs);
  return docs.map((d) => d.knowledgeId);
}

// ---------- actions from forms ----------

export interface FormFact {
  method: string;
  path: string;
  fields: { name: string; type: string; value: string | null }[];
  label: string;
  page: string;
  pageTitle: string;
}

/** Forms on a page, with the real method (a hidden _method turns POST into PATCH or DELETE). */
export function formsOf(base: string, page: Pick<Page, "path" | "text" | "title">): FormFact[] {
  const origins = siteOrigins(base);
  const out: FormFact[] = [];
  for (const m of page.text.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1];
    const inner = m[2];
    const action = attr(attrs, "action") ?? page.path;
    let url: URL;
    try {
      url = new URL(action, `${base}${page.path}`);
    } catch {
      continue;
    }
    if (!origins.includes(url.origin)) continue;
    let method = (attr(attrs, "method") ?? "GET").toUpperCase();
    const fields: FormFact["fields"] = [];
    for (const f of inner.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)) {
      const name = attr(f[2], "name");
      const type = (attr(f[2], "type") ?? (f[1].toLowerCase() === "input" ? "text" : f[1].toLowerCase())).toLowerCase();
      if (!name || ["submit", "button", "reset", "image", "file"].includes(type)) continue;
      if (name === "_method") {
        const override = attr(f[2], "value");
        if (override) method = override.toUpperCase();
        continue;
      }
      if (/csrf|authenticity|token/i.test(name)) continue;
      fields.push({ name, type, value: attr(f[2], "value") });
    }
    const label = textOf(inner.match(/<button\b[^>]*>([\s\S]*?)<\/button>/i)?.[1] ?? attr(inner.match(/<input\b[^>]*type="submit"[^>]*>/i)?.[0] ?? "", "value") ?? "");
    out.push({ method, path: url.pathname, fields, label, page: page.path, pageTitle: textOf(page.title) });
  }
  return out;
}

function dedupeForms(forms: FormFact[]): FormFact[] {
  const seen = new Map<string, FormFact>();
  for (const f of forms) {
    const key = `${f.method} ${f.path} ${f.fields.map((x) => x.name).sort().join(",")}`;
    if (!seen.has(key)) seen.set(key, f);
  }
  return [...seen.values()];
}

async function saveFormCapability(ctx: AgentDeskContext, form: FormFact, episodeId: string): Promise<string | null> {
  if (form.fields.length === 0 && form.method === "GET") return null; // a plain link, not an action
  const numberField = (t: string) => t === "number" || t === "range";
  const properties: Record<string, { type: string }> = {};
  const bodyTemplate: Record<string, string> = {};
  const example: Record<string, unknown> = {};
  for (const f of form.fields) {
    properties[f.name] = { type: numberField(f.type) ? "number" : "string" };
    bodyTemplate[f.name] = `{{${f.name}}}`;
    if (f.value !== null && f.value !== "") example[f.name] = numberField(f.type) && !Number.isNaN(Number(f.value)) ? Number(f.value) : f.value;
  }
  const steps = [{ method: form.method, path: form.path, bodyTemplate }];
  const words = await nameCapability(ctx, {
    steps,
    inputFields: form.fields.map((f) => f.name),
    goal: `a form on the page "${form.pageTitle || form.page}"${form.label ? ` with the button "${form.label}"` : ""}`,
    intents: [],
  });
  const now = new Date();
  const doc: CapabilityDoc = {
    siteId: ctx.config.siteId,
    createdAt: now,
    updatedAt: now,
    capabilityId: newId("cap"),
    name: words.name,
    description: words.description,
    kind: form.method === "GET" ? "read" : "write",
    inputSchema: {
      type: "object",
      properties,
      required: form.fields.filter((f) => f.type !== "checkbox").map((f) => f.name),
    },
    mappedRequests: steps,
    stage: "proposed",
    sourceEpisodeId: episodeId,
    sourceRequestId: `explore:${form.page}`,
    verifiedByEpisodeId: null,
    stats: { calls: 0, successes: 0 },
    examples: Object.keys(example).length ? [{ input: example, requestId: `explore:${form.page}` }] : [],
    embedding: await embedOrEmpty(ctx, `${words.name}: ${words.description}`),
  };
  // A name the site already has stays unique for agents: add_to_cart, add_to_cart_2...
  const taken = await ctx.cols.capabilities.countDocuments({ siteId: ctx.config.siteId, name: doc.name });
  if (taken > 0) doc.name = `${doc.name}_${taken + 1}`;
  await ctx.cols.capabilities.insertOne(doc);
  return doc.capabilityId;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").replace(/&amp;/g, "&") : null;
}

function samePath(a: string, b: string): boolean {
  const clean = (p: string) => p.replace(/\/+$/, "").toLowerCase() || "/";
  return clean(a) === clean(b);
}
