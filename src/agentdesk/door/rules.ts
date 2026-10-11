import type { AgentDeskContext } from "../contract/context.js";
import type { RuleDoc, RuleMatch } from "../contract/types.js";

// Active-rule enforcement, shared by the tap (fallback clicks) and `do` (capability calls).
// CONTRACT section 3: only status "active" rules are enforced; proposed rules never are.

const CACHE_MS = 3_000;
let cache: { siteId: string; at: number; rules: RuleDoc[] } | null = null;

export async function activeRules(ctx: AgentDeskContext): Promise<RuleDoc[]> {
  const siteId = ctx.config.siteId;
  if (cache && cache.siteId === siteId && Date.now() - cache.at < CACHE_MS) return cache.rules;
  const rules = await ctx.cols.rules.find({ siteId, status: "active", enabled: true }).toArray();
  cache = { siteId, at: Date.now(), rules };
  return rules;
}

/** For tests and for the panel right after it activates a rule. */
export function clearRuleCache(): void {
  cache = null;
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
  if (method && method.toUpperCase() !== req.method.toUpperCase()) return false;
  if (path && !pathMatches(path, req.path)) return false;
  if (bodyField && !hasField(req.body, bodyField)) return false;
  return true;
}

/** "/cart/items" exact, "/quote/:id/submit" with params, "/admin/*" with a trailing wildcard. */
export function pathMatches(pattern: string, path: string): boolean {
  const clean = (p: string) => p.replace(/\/+$/, "") || "/";
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
