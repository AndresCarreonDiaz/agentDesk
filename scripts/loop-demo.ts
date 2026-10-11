// Shows the Loop core learning from the fixtures, step by step. Run: npx tsx scripts/loop-demo.ts
import { readFileSync } from "node:fs";
import { closeEpisode, buildCapability, diffEpisodes, nextStage, proposeRules } from "../src/agentdesk/loop/core.js";

const load = (f: string) => JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), "utf8"));
const fail = load("episode-cart-prior-fail.json");
const win = load("episode-cart-fail.json");
const say = (s: string) => console.log(s);

say("\n1. Visit A: an agent tries to add the blue mug and gets a 400");
const closeA = closeEpisode(fail.episode, fail.requests, []);
say(`   siteSuccess=${closeA.siteSuccess}  outcome=${closeA.outcome}  steps=${closeA.steps}`);
say(`   capability learned: ${buildCapability(fail.episode, fail.requests) ?? "none (the write failed)"}`);

say("\n2. Visit B: the next agent clicks through the site and it works");
const failedA = { ...fail.episode, ...closeA };
const closeB = closeEpisode(win.episode, win.requests, [failedA]);
say(`   siteSuccess=${closeB.siteSuccess}  steps=${closeB.steps}  seconds=${closeB.durationMs / 1000}  priorFailureId=${closeB.priorFailureId}`);

say("\n3. The reflector compares the failure with the success");
for (const c of diffEpisodes(fail.requests, win.requests).changes) say(`   ${JSON.stringify(c)}`);

say("\n4. It turns the working request into a capability");
const cap = buildCapability(win.episode, win.requests)!;
say(`   ${cap.mappedRequests.map((r) => `${r.method} ${r.path}`).join(" -> ")}  input=${JSON.stringify(cap.inputSchema.properties)}`);
let stage = nextStage(cap.stage, []);
say(`   stage: ${cap.stage} -> ${stage}`);

say("\n5. An agent uses it and SAYS it worked, but the site returned 400");
stage = nextStage(stage, [{ goalSuccess: true, siteSuccess: false }]);
say(`   stage stays: ${stage}  (the agent's word alone does not verify)`);

say("\n6. An agent uses it, and the site confirms the write");
stage = nextStage(stage, [{ goalSuccess: true, siteSuccess: false }, { goalSuccess: true, siteSuccess: true }]);
say(`   stage: ${stage}`);

say("\n7. Two different agents try a discount code and the site refuses both");
const disc = (ep: string, ses: string) => ({
  requestId: `req_${ep}`, sessionId: ses, episodeId: ep, siteId: "demo-store", source: "fallback",
  method: "POST", path: "/cart/discount", query: {}, bodyShape: { code: "string" }, body: null,
  status: 403, durationMs: 20, timestamp: "2026-10-11T19:40:00Z", createdAt: "2026-10-11T19:40:00Z",
});
const rules = proposeRules([], [disc("ep_d1", "ses_d1"), disc("ep_d2", "ses_d2")]);
for (const r of rules) say(`   proposed rule: "${r.text}"  status=${r.status}  evidence=${r.evidence.join(", ")}`);
say("");
