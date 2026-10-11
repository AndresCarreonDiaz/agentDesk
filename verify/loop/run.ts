// Frozen oracle for src/agentdesk/loop/core.ts. Workers must not edit verify/.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";

type Json = any;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const workdir = resolve(process.argv[2] ?? "");
const holdoutDir = process.env.AGENTDESK_HOLDOUT ?? join(homedir(), ".kliri/loops/agentdesk-loop/holdout");
const DATE_KEYS = new Set(["timestamp", "at", "createdAt"]);

function isObj(v: Json): boolean { return v !== null && typeof v === "object" && !Array.isArray(v); }

// Resolve {"$fixture": file, "pick": "episode"|"requests"|...} and optionally turn date strings into Date objects.
function resolveRefs(v: Json, dates: boolean, key = ""): Json {
  if (Array.isArray(v)) return v.map((x) => resolveRefs(x, dates, key));
  if (isObj(v)) {
    if (typeof v.$fixture === "string") {
      const f = JSON.parse(readFileSync(join(repoRoot, "fixtures", v.$fixture), "utf8"));
      return resolveRefs(v.pick ? f[v.pick] : f, dates);
    }
    const o: Json = {};
    for (const [k, x] of Object.entries(v)) o[k] = resolveRefs(x, dates, k);
    return o;
  }
  if (dates && typeof v === "string" && DATE_KEYS.has(key)) return new Date(v);
  return v;
}

function deepFreeze(v: Json): Json {
  if (v && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

function deepEq(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && deepEq(a[k], b[k]));
  }
  return false;
}

// Deep subset match. Matchers: {$oneOf:[..]}, {$nonEmptyString:true}, {$any:true}.
function subset(exp: Json, act: Json, ordered: boolean): boolean {
  if (isObj(exp)) {
    if (Array.isArray(exp.$oneOf)) return exp.$oneOf.some((e: Json) => subset(e, act, ordered));
    if (exp.$nonEmptyString) return typeof act === "string" && act.trim().length > 0;
    if (exp.$any) return act !== undefined;
    if (!isObj(act)) return false;
    return Object.keys(exp).every((k) => k in act && subset(exp[k], act[k], ordered));
  }
  if (Array.isArray(exp)) {
    if (!Array.isArray(act) || act.length !== exp.length) return false;
    if (ordered) return exp.every((e, i) => subset(e, act[i], ordered));
    return matchSet(exp, act, ordered);
  }
  return deepEq(exp, act);
}
function matchSet(exp: Json[], act: Json[], ordered: boolean): boolean {
  const used = new Array(act.length).fill(false);
  const go = (i: number): boolean => {
    if (i === exp.length) return true;
    for (let j = 0; j < act.length; j++) {
      if (!used[j] && subset(exp[i], act[j], ordered)) {
        used[j] = true;
        if (go(i + 1)) return true;
        used[j] = false;
      }
    }
    return false;
  };
  return go(0);
}

function check(exp: Json, act: Json): string | null {
  if ("equals" in exp && !deepEq(exp.equals, act)) return `not equal to expected (got ${short(act)})`;
  if (exp.isNull && act !== null) return `expected null, got ${short(act)}`;
  if ("partial" in exp && !subset(exp.partial, act, exp.ordered === true)) return `partial mismatch (got ${short(act)})`;
  if (exp.contains) {
    if (!Array.isArray(act)) return `contains needs an array, got ${short(act)}`;
    for (const item of exp.contains) if (!act.some((el: Json) => subset(item, el, exp.ordered === true))) return `missing item ${short(item)}`;
  }
  if ("length" in exp && !(act != null && act.length === exp.length)) return `length ${act?.length} != ${exp.length}`;
  if (exp.notContains) {
    if (!Array.isArray(act)) return `notContains needs an array`;
    for (const item of exp.notContains) if (act.some((el: Json) => subset(item, el, false))) return `unexpected item ${short(item)}`;
  }
  if (exp.also) for (const e of Array.isArray(exp.also) ? exp.also : [exp.also]) { const r = check(e, act); if (r) return r; }
  return null;
}
function short(v: Json): string { const s = JSON.stringify(v) ?? String(v); return s.length > 300 ? s.slice(0, 300) + "..." : s; }

function loadCases(dir: string, holdout: boolean): { name: string; c: Json; holdout: boolean }[] {
  if (!existsSync(dir)) return [];
  const out: { name: string; c: Json; holdout: boolean }[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const c of Array.isArray(parsed) ? parsed : [parsed]) out.push({ name: c.name, c, holdout });
  }
  return out;
}

const cases = [...loadCases(join(here, "cases"), false), ...loadCases(holdoutDir, true)];
let mod: Json = null;
let loadErr = "";
try {
  mod = await import(pathToFileURL(join(workdir, "src/agentdesk/loop/core.ts")).href);
} catch (e: any) {
  loadErr = String(e?.code ?? "load error");
}

let passed = 0;
for (const { name, c, holdout } of cases) {
  const label = holdout ? `holdout:${name}` : name;
  const fail = (why: string) => console.log(`FAIL ${label}: ${holdout && !/^(missing export|threw|function must)/.test(why) ? "result mismatch" : holdout ? why.replace(/ \(.*$/, "").replace(/^threw .*/, "threw") : why}`);
  const fn = mod?.[c.fn];
  if (typeof fn !== "function") { fail(`missing export ${c.fn}${loadErr ? ` (${loadErr})` : ""}`); continue; }
  try {
    const args = c.args.map((a: Json) => deepFreeze(resolveRefs(a, c.dates === "objects")));
    const r = fn(...args);
    if (r && typeof r.then === "function") { fail("function must be synchronous"); continue; }
    const why = check(c.expect, r);
    if (why) fail(why); else passed++;
  } catch (e: any) {
    fail(`threw ${String(e?.message ?? e).split("\n")[0]}`);
  }
}
console.log(`oracle: ${passed}/${cases.length} passed`);
process.exit(passed === cases.length && cases.length > 0 ? 0 : 1);
