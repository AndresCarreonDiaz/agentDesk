import type { MappedRequest } from "../contract/types.js";
import { REPLAY_HEADER, REPLAY_SECRET, SESSION_COOKIE, SESSION_HEADER } from "./sessions.js";

// `do` runs a capability by replaying its mappedRequests through the host app, in order
// (CONTRACT section 3). Templates: "{{input.sku}}" (or the Loop's bare "{{sku}}") from the
// agent's input, and "{{steps[0].body.quoteId}}" from an earlier step's response.

export interface StepResult {
  method: string;
  path: string;
  status: number;
  body: unknown;
}

export interface ReplayContext {
  input: Record<string, unknown>;
  steps: StepResult[];
}

const WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
const INLINE = /\{\{\s*([^}]+?)\s*\}\}/g;

/** Fills templates. A string that is one whole template keeps the value's type (a number stays a number). */
export function fillTemplate(template: unknown, rc: ReplayContext): unknown {
  if (typeof template === "string") {
    const whole = template.match(WHOLE);
    if (whole) return lookup(whole[1], rc);
    return template.replace(INLINE, (_m, expr: string) => {
      const v = lookup(expr, rc);
      return v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(template)) return template.map((t) => fillTemplate(t, rc));
  if (template && typeof template === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      const filled = fillTemplate(v, rc);
      if (filled !== undefined) out[k] = filled;
    }
    return out;
  }
  return template;
}

function lookup(expr: string, rc: ReplayContext): unknown {
  // input.sku | steps[0].body.quoteId | steps.0.body.quoteId
  // A bare name ({{sku}}, what the Loop's buildCapability writes) means input.sku.
  const parts = expr.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  if (parts[0] !== "input" && parts[0] !== "steps") parts.unshift("input");
  let cur: unknown = rc;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Path params come from input too: "/quote/:id/submit" with input.id, or a template in the path. */
export function fillPath(path: string, rc: ReplayContext): string {
  const templated = String(fillTemplate(path, rc));
  return templated.replace(/:([A-Za-z_]\w*)/g, (m, name: string) => {
    const v = rc.input[name];
    return v === undefined || v === null ? m : encodeURIComponent(String(v));
  });
}

export async function replay(
  baseUrl: string,
  sessionId: string,
  steps: MappedRequest[],
  input: Record<string, unknown>,
): Promise<StepResult[]> {
  const rc: ReplayContext = { input, steps: [] };
  for (const step of steps) {
    const method = step.method.toUpperCase();
    const path = fillPath(step.path, rc);
    const hasBody = !["GET", "HEAD", "DELETE"].includes(method);
    let url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    let body: string | undefined;
    if (hasBody) {
      body = JSON.stringify(fillTemplate(step.bodyTemplate ?? {}, rc));
    } else if (step.bodyTemplate && typeof step.bodyTemplate === "object") {
      // For reads, a body template becomes the query string.
      const query = fillTemplate(step.bodyTemplate, rc) as Record<string, unknown>;
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)]),
      ).toString();
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }

    const res = await fetch(url, {
      method,
      headers: {
        ...(hasBody ? { "content-type": "application/json" } : {}),
        accept: "application/json",
        [SESSION_HEADER]: sessionId,
        cookie: `${SESSION_COOKIE}=${sessionId}`,
        [REPLAY_HEADER]: REPLAY_SECRET,
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const type = res.headers.get("content-type") ?? "";
    const text = await res.text();
    let parsed: unknown;
    if (/html/i.test(type) && !/^\s*[[{]/.test(text)) {
      // An HTML page is a wall of markup for an agent: give it the readable text and the form values instead.
      parsed = readablePage(text);
    } else {
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
      }
    }
    const result: StepResult = { method, path, status: res.status, body: parsed };
    rc.steps.push(result);
    if (res.status >= 400) break; // later steps depend on earlier ones
  }
  return rc.steps;
}

/** What an agent needs from an HTML page: its title, its readable text, and the values its forms carry (SKUs, ids). */
export function readablePage(html: string): { title: string; text: string; forms: string[] } {
  const title = strip(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = strip(body.replace(/<(script|style|svg|head)[\s\S]*?<\/\1>/gi, " "));
  const forms: string[] = [];
  for (const m of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const action = m[1].match(/\baction\s*=\s*"([^"]*)"/i)?.[1] ?? "";
    const method = (m[1].match(/\bmethod\s*=\s*"([^"]*)"/i)?.[1] ?? "get").toUpperCase();
    const values = [...m[2].matchAll(/<input\b[^>]*>/gi)]
      .map((i) => [i[0].match(/\bname\s*=\s*"([^"]*)"/i)?.[1], i[0].match(/\bvalue\s*=\s*"([^"]*)"/i)?.[1]])
      .filter(([n, v]) => n && v !== undefined && !/csrf|token/i.test(n))
      .map(([n, v]) => `${n}=${v}`);
    if (values.length) forms.push(`${method} ${action} ${values.join(" ")}`.trim());
    if (forms.length >= 30) break;
  }
  return { title, text: text.length > 1500 ? `${text.slice(0, 1500)}...` : text, forms };
}

function strip(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
