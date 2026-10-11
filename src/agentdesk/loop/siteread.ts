import type { AgentDeskContext } from "../contract/context.js";
import { newId } from "../contract/ids.js";
import type { KnowledgeDoc } from "../contract/types.js";
import { embedOrEmpty, withTimeout } from "./naming.js";

// Site reading (docs/CONTRACT.md "site_read"): the first visit asks "what can I do here?", the empty desk
// cannot answer, and this reads the site's public pages once so the next visit gets an answer.
// GET only, same origin only, never the desk's own routes or the cart API.

const FETCH_TIMEOUT_MS = 5_000;
const LLM_TIMEOUT_MS = 20_000;
const MAX_LINKS = 6;
const MAX_TOTAL_CHARS = 200_000;
const MAX_PAGE_CHARS = 40_000;
const MAX_FACTS = 10;
const CONFIDENCE = 0.7;
const SKIPPED_PREFIXES = ["/agentdesk", "/agent", "/mcp", "/api/cart"];
const NOT_A_PAGE = /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|pdf|zip|woff2?|ttf|mp4|mp3|xml|txt)$/i;

interface Page {
  path: string;
  title: string;
  text: string;
}

const inFlight = new Map<string, Promise<string[]>>();

export function siteOrigin(): string {
  const configured = process.env.AGENTDESK_SITE_URL?.trim();
  return new URL(configured || `http://localhost:${process.env.PORT ?? 3000}`).origin;
}

function skipped(path: string): boolean {
  const lower = path.toLowerCase();
  return SKIPPED_PREFIXES.some((p) => (p === "/api/cart" ? lower.startsWith(p) : lower === p || lower.startsWith(`${p}/`) || lower.startsWith(`${p}?`)));
}

function htmlToText(html: string): { title: string; text: string } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ");
  return { title: decode(title), text: decode(text) };
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/\s+/g, " ")
    .trim();
}

function sameOriginLinks(html: string, origin: string): string[] {
  const found = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const href = (m[1] ?? m[2] ?? "").trim();
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, `${origin}/`);
    } catch {
      continue;
    }
    if (url.origin !== origin) continue;
    const path = url.pathname;
    if (path === "/" || skipped(path) || NOT_A_PAGE.test(path)) continue;
    found.add(path);
    if (found.size >= MAX_LINKS) break;
  }
  return [...found];
}

async function get(origin: string, path: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}${path}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { accept: "text/html,text/plain,application/xml;q=0.9,*/*;q=0.5" },
    });
    if (!res.ok) return null;
    const final = new URL(res.url || `${origin}${path}`);
    if (final.origin !== origin || skipped(final.pathname)) return null;
    return (await res.text()).slice(0, MAX_PAGE_CHARS * 4);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPages(origin: string): Promise<Page[]> {
  const pages: Page[] = [];
  let budget = MAX_TOTAL_CHARS;
  const add = (path: string, raw: string, isHtml: boolean): void => {
    if (budget <= 0) return;
    const { title, text } = isHtml ? htmlToText(raw) : { title: "", text: decode(raw) };
    const clipped = text.slice(0, Math.min(MAX_PAGE_CHARS, budget));
    if (!clipped) return;
    budget -= clipped.length;
    pages.push({ path, title, text: clipped });
  };

  const home = await get(origin, "/");
  if (home === null) return [];
  add("/", home, true);
  const links = sameOriginLinks(home, origin);
  const extras = await Promise.all(["/llms.txt", "/sitemap.xml", ...links].map(async (p) => [p, await get(origin, p)] as const));
  for (const [path, body] of extras) {
    if (body !== null) add(path, body, !/\.(txt|xml)$/.test(path));
  }
  return pages;
}

function fallbackFacts(pages: Page[]): { text: string; page: string }[] {
  const home = pages.find((p) => p.path === "/") ?? pages[0];
  const sentences = home.text.match(/[^.!?]+[.!?]/g)?.map((s) => s.trim()).filter((s) => s.length > 15) ?? [];
  const facts: { text: string; page: string }[] = [];
  if (home.title) facts.push({ text: `The site is called "${home.title}".`, page: home.path });
  for (const s of sentences.slice(0, 3)) facts.push({ text: s.slice(0, 300), page: home.path });
  if (facts.length === 0 && home.text) facts.push({ text: home.text.slice(0, 300), page: home.path });
  return facts;
}

async function summarize(ctx: AgentDeskContext, pages: Page[]): Promise<{ text: string; page: string }[]> {
  const paths = new Set(pages.map((p) => p.path));
  try {
    const answer = await withTimeout(
      ctx.llm.json<{ facts?: { text?: unknown; page?: unknown }[] }>(
        {
          system:
            "You write the facts an AI agent needs to know about a website, for the site's help desk. " +
            "Use only what the fetched page text below states: never invent products, prices, policies or features. " +
            "Give 3 to 10 short, factual, self-contained statements (what the site is, what it sells or offers, prices, " +
            "shipping, returns and other policies, what a visitor can do). Name the page path each statement came from.",
          prompt: pages.map((p) => `### ${p.path}${p.title ? ` (title: ${p.title})` : ""}\n${p.text}`).join("\n\n"),
          temperature: 0.1,
          maxOutputTokens: 2048,
        },
        {
          type: "object",
          properties: {
            facts: {
              type: "array",
              items: {
                type: "object",
                properties: { text: { type: "string" }, page: { type: "string" } },
                required: ["text", "page"],
              },
            },
          },
          required: ["facts"],
        },
      ),
      LLM_TIMEOUT_MS,
      "site reading",
    );
    const seen = new Set<string>();
    const facts: { text: string; page: string }[] = [];
    for (const f of answer.facts ?? []) {
      if (typeof f.text !== "string") continue;
      const text = f.text.replace(/\s+/g, " ").trim();
      if (text.length < 10 || text.length > 400 || seen.has(text.toLowerCase())) continue;
      seen.add(text.toLowerCase());
      facts.push({ text, page: typeof f.page === "string" && paths.has(f.page) ? f.page : "/" });
      if (facts.length >= MAX_FACTS) break;
    }
    if (facts.length > 0) return facts;
  } catch (err) {
    ctx.log.warn(`loop: site reading fell back to the page text (${(err as Error).message})`);
  }
  return fallbackFacts(pages);
}

/** Reads the site's public pages once and writes `site_read` knowledge. Returns the new knowledge ids ([] when nothing was written). */
export function readSite(ctx: AgentDeskContext): Promise<string[]> {
  const siteId = ctx.config.siteId;
  const running = inFlight.get(siteId);
  if (running) return running;
  const work = doRead(ctx, siteId).finally(() => inFlight.delete(siteId));
  inFlight.set(siteId, work);
  return work;
}

async function doRead(ctx: AgentDeskContext, siteId: string): Promise<string[]> {
  if (await ctx.cols.knowledge.findOne({ siteId, source: "site_read" }, { projection: { knowledgeId: 1 } })) return [];
  const origin = siteOrigin();
  const pages = await fetchPages(origin);
  if (pages.length === 0) {
    ctx.log.warn(`loop: site reading found nothing readable at ${origin}`);
    return [];
  }
  const facts = await summarize(ctx, pages);
  const ids: string[] = [];
  for (const fact of facts) {
    const doc: KnowledgeDoc = {
      siteId,
      createdAt: new Date(),
      knowledgeId: newId("kn"),
      text: fact.text,
      source: "site_read",
      sourceRef: fact.page,
      intent: null,
      confidence: CONFIDENCE,
      embedding: await embedOrEmpty(ctx, fact.text),
    };
    await ctx.cols.knowledge.insertOne(doc);
    ids.push(doc.knowledgeId);
  }
  ctx.log.info(`loop: read ${origin} (${pages.length} pages) and learned ${ids.length} facts`);
  return ids;
}
