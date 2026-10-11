import type { MappedRequest } from "../contract/types.js";
import { REPLAY_HEADER, REPLAY_SECRET, SESSION_COOKIE, SESSION_HEADER } from "./sessions.js";

// `do` runs a capability by replaying its mappedRequests through the host app, in order
// (CONTRACT section 3). Templates: "{{input.sku}}" from the agent's input, and
// "{{steps[0].body.quoteId}}" from an earlier step's response.

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
  const parts = expr.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
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
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text.length > 2000 ? `${text.slice(0, 2000)}...` : text;
    }
    const result: StepResult = { method, path, status: res.status, body: parsed };
    rc.steps.push(result);
    if (res.status >= 400) break; // later steps depend on earlier ones
  }
  return rc.steps;
}
