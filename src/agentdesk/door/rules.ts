import type { AgentDeskContext } from "../contract/context.js";
import type { RuleDoc, RuleMatch } from "../contract/types.js";

// Active-rule enforcement, shared by the tap (fallback clicks) and `do` (capability calls).
// CONTRACT section 3: only status "active" rules are enforced; proposed rules never are.
//
// The tap calls this on agent requests, so it must be fast and must not hang the host:
// one shared in-flight query, a short server timeout, and the last known rules on error.

const FRESH_MS = 3_000;
const QUERY_TIMEOUT_MS = 500;
const caches = new Map<string, { at: number; rules: RuleDoc[]; inflight?: Promise<RuleDoc[]> }>();

export async function activeRules(ctx: AgentDeskContext): Promise<RuleDoc[]> {
  const k = `${ctx.config.dbName}:${ctx.config.siteId}`;
  const cached = caches.get(k);
  if (cached && Date.now() - cached.at < FRESH_MS) return cached.rules;
  if (cached?.inflight) return cached.inflight;

  const inflight = ctx.cols.rules
    .find({ siteId: ctx.config.siteId, status: "active", enabled: true }, { maxTimeMS: QUERY_TIMEOUT_MS })
    .toArray()
    .then((rules) => {
      caches.set(k, { at: Date.now(), rules });
      return rules;
    })
    .catch((err) => {
      // Keep enforcing what we knew; try again shortly instead of on every request.
      ctx.log.error("rules: could not load active rules, using the last known ones", err);
      const stale = cached?.rules ?? [];
      caches.set(k, { at: Date.now() - FRESH_MS + 1_000, rules: stale });
      return stale;
    });
  caches.set(k, { at: cached?.at ?? 0, rules: cached?.rules ?? [], inflight });
  return inflight;
}

/** For tests and for the panel right after it activates a rule. */
export function clearRuleCache(): void {
  caches.clear();
}

export interface RequestFacts {
  method: string;
  path: string;
  body: unknown;
}

/** A rule with a match applies when every field it sets matches. A match with no fields never applies. */
export function matchesRequest(match: RuleMatch | undefined, req: RequestFacts): boolean {
  if (!match) return false;
  const { method, path, bodyField } = match;
  if (!method && !path && !bodyField) return false;
  if (!matchesRoute(match, req)) return false;
  if (bodyField && !hasField(req.body, bodyField)) return false;
  return true;
}

/** Method and path only: used to decide whether the tap needs to look at the body at all. */
export function matchesRoute(match: RuleMatch, req: Pick<RequestFacts, "method" | "path">): boolean {
  if (match.method && match.method.toUpperCase() !== req.method.toUpperCase()) return false;
  if (match.path && !pathMatches(match.path, req.path)) return false;
  return true;
}

/** "/cart/items" exact, "/quote/:id/submit" with params, "/admin/*" with a trailing wildcard. */
export function pathMatches(pattern: string, path: string): boolean {
  const clean = (p: string) => safeDecode(p).replace(/\/+$/, "") || "/";
  const pat = clean(pattern).split("/");
  const got = clean(path).split("/");
  for (let i = 0; i < pat.length; i++) {
    if (pat[i] === "*") return true;
    if (i >= got.length) return false;
    if (pat[i].startsWith(":")) {
      if (!got[i]) return false;
      continue;
    }
    if (pat[i].toLowerCase() !== got[i].toLowerCase()) return false;
  }
  return pat.length === got.length;
}

function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

function hasField(body: unknown, field: string): boolean {
  if (!body || typeof body !== "object") return false;
  let cur: unknown = body;
  for (const part of field.split(".")) {
    if (!cur || typeof cur !== "object" || !(part in (cur as object))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur !== undefined && cur !== null && cur !== "";
}

/** The first active rule that refuses this request, if any. */
export async function refusingRule(ctx: AgentDeskContext, req: RequestFacts): Promise<RuleDoc | null> {
  const rules = await activeRules(ctx);
  return rules.find((r) => matchesRequest(r.compiled.match, req)) ?? null;
}
