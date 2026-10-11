import type { IncomingHttpHeaders } from "node:http";
import { randomBytes } from "node:crypto";
import type { AgentDeskContext } from "../contract/context.js";
import { SESSION_COOKIE, SESSION_HEADER } from "../contract/types.js";

// CONTRACT section 2: the session join between Door calls and fallback clicks.

export { SESSION_COOKIE, SESSION_HEADER };
export const REPLAY_HEADER = "x-agentdesk-replay";

/** Per-process secret the Door sends on capability replays, so the tap can trust source "capability". */
export const REPLAY_SECRET = randomBytes(16).toString("hex");

const SESSION_ID = /^ses_[a-f0-9]{8,64}$/;

export function sessionFromHeaders(headers: IncomingHttpHeaders): string | null {
  const header = headers[SESSION_HEADER];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (fromHeader && SESSION_ID.test(fromHeader)) return fromHeader;
  const fromCookie = readCookie(headers.cookie, SESSION_COOKIE);
  if (fromCookie && SESSION_ID.test(fromCookie)) return fromCookie;
  return null;
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

// sessionId -> episodeId. The Door fills it when it creates an episode; misses go to the database.
const episodeBySession = new Map<string, { episodeId: string | null; at: number }>();
const NEGATIVE_CACHE_MS = 5_000;

export function rememberEpisode(sessionId: string, episodeId: string): void {
  episodeBySession.set(sessionId, { episodeId, at: Date.now() });
}

export async function episodeForSession(ctx: AgentDeskContext, sessionId: string): Promise<string | null> {
  const hit = episodeBySession.get(sessionId);
  if (hit && (hit.episodeId || Date.now() - hit.at < NEGATIVE_CACHE_MS)) return hit.episodeId;
  const episode = await ctx.cols.episodes.findOne(
    { sessionId, siteId: ctx.config.siteId },
    { projection: { episodeId: 1 } },
  );
  const episodeId = episode?.episodeId ?? null;
  episodeBySession.set(sessionId, { episodeId, at: Date.now() });
  return episodeId;
}
