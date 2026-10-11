import { randomBytes } from "node:crypto";
import type { AgentDeskContext } from "./context.js";

// What the Loop needs to know about the host site it lives in, shared through the contract
// so the Loop never imports the Door.

const baseUrls = new Map<string, string>();

/** The Door records where the host app answers (its local socket), on every desk request. */
export function rememberHostBaseUrl(ctx: Pick<AgentDeskContext, "config">, url: string): void {
  baseUrls.set(ctx.config.siteId, url.replace(/\/+$/, ""));
}

/** Where the explorer reads the site from. Falls back to AGENTDESK_SITE_URL / SITE_URL before any request arrives. */
export function hostBaseUrlFor(ctx: Pick<AgentDeskContext, "config">): string | null {
  return baseUrls.get(ctx.config.siteId) ?? (process.env.AGENTDESK_SITE_URL || process.env.SITE_URL || null)?.replace(/\/+$/, "") ?? null;
}

/** The explorer sends this header so the tap does not record the desk reading its own site as traffic. */
export const EXPLORE_HEADER = "x-agentdesk-explore";
export const EXPLORE_SECRET = randomBytes(16).toString("hex");

/** How the Door words "I could not help" (door/tools.ts). The Loop uses it to spot a visit the desk failed. */
export const DESK_DID_NOT_KNOW = /^(I don't know yet|No actions learned yet|There is no action named)/;
