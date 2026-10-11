import type { AgentDeskContext } from "./context.js";
import { newId } from "./ids.js";
import type { AuditDoc } from "./types.js";

// Autopilot (CONTRACT section 4): learned everyday writes go live for agents without waiting
// for approval; anything that moves money still waits. Everything autopilot runs unreviewed is
// written to `audit`, so the developer can review it later and approve or block.
//
// The setting lives in Atlas (settings.autopilot) so the panel can flip it live.

const CACHE_MS = 3_000;
const cache = new Map<string, { at: number; on: boolean }>();

export async function autopilotOn(ctx: AgentDeskContext): Promise<boolean> {
  const fallback = ctx.config.autopilotDefault ?? false;
  const key = `${ctx.config.dbName}:${ctx.config.siteId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.on;
  let on = fallback;
  try {
    const settings = await ctx.cols.settings?.findOne({ _id: "settings" }, { projection: { autopilot: 1 } });
    on = typeof settings?.autopilot === "boolean" ? settings.autopilot : fallback;
  } catch (err) {
    ctx.log.warn(`autopilot: could not read the setting (${(err as Error).message}); using the default`);
  }
  cache.set(key, { at: Date.now(), on });
  return on;
}

/** For the panel's toggle. Writes the setting and an audit line; takes effect within a few seconds. */
export async function setAutopilot(ctx: AgentDeskContext, on: boolean): Promise<void> {
  await ctx.cols.settings.updateOne({ _id: "settings" }, { $set: { autopilot: on } });
  cache.delete(`${ctx.config.dbName}:${ctx.config.siteId}`);
  await recordAudit(ctx, {
    actor: "developer",
    action: on ? "autopilot_on" : "autopilot_off",
    detail: on ? "Autopilot turned on: learned everyday actions go live; money still asks." : "Autopilot turned off: every learned write waits for approval.",
  });
}

export async function recordAudit(
  ctx: AgentDeskContext,
  entry: Pick<AuditDoc, "actor" | "action" | "detail"> & Partial<Pick<AuditDoc, "capabilityId" | "capabilityName" | "episodeId" | "sessionId" | "ok">>,
): Promise<void> {
  const doc: AuditDoc = {
    siteId: ctx.config.siteId,
    createdAt: new Date(),
    auditId: newId("aud"),
    capabilityId: null,
    capabilityName: null,
    episodeId: null,
    sessionId: null,
    ok: null,
    ...entry,
  };
  try {
    await ctx.cols.audit.insertOne(doc);
  } catch (err) {
    ctx.log.error("audit: could not record an entry", err);
  }
}

/** For tests and right after the panel flips the toggle. */
export function clearAutopilotCache(): void {
  cache.clear();
}
