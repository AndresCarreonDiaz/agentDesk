import type { IncomingHttpHeaders } from "node:http";
import { randomBytes } from "node:crypto";
import type { AgentDeskContext } from "../contract/context.js";

// CONTRACT section 2: the session join between Door calls and fallback clicks.

export const SESSION_HEADER = "x-agentdesk-session";
export const SESSION_COOKIE = "agentdesk_session";
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

/** Never throws: a malformed cookie from any visitor must not break the host. */
export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

// sessionId -> episodeId, bounded. Positive hits come from the Door creating episodes or a
// database hit; misses are cached briefly in a separate small map so made-up ids cannot grow memory.
const MAX_POSITIVE = 10_000;
const MAX_NEGATIVE = 1_000;
const NEGATIVE_MS = 5_000;
const positive = new Map<string, string>();
const negative = new Map<string, number>();

function key(ctx: Pick<AgentDeskContext, "config">, sessionId: string): string {
  return `${ctx.config.siteId}:${sessionId}`;
}

function remember(map: Map<string, any>, k: string, v: unknown, max: number): void {
  map.delete(k);
  map.set(k, v);
  if (map.size > max) map.delete(map.keys().next().value as string);
}

export function rememberEpisode(sessionId: string, episodeId: string, ctx?: Pick<AgentDeskContext, "config">): void {
  const k = ctx ? key(ctx, sessionId) : `*:${sessionId}`;
  negative.delete(k);
  remember(positive, k, episodeId, MAX_POSITIVE);
}

export async function episodeForSession(ctx: AgentDeskContext, sessionId: string): Promise<string | null> {
  const k = key(ctx, sessionId);
  const hit = positive.get(k) ?? positive.get(`*:${sessionId}`);
  if (hit) return hit;
  const missAt = negative.get(k);
  if (missAt && Date.now() - missAt < NEGATIVE_MS) return null;

  const episode = await ctx.cols.episodes.findOne(
    { sessionId, siteId: ctx.config.siteId },
    { projection: { episodeId: 1 }, maxTimeMS: 1_000 },
  );
  if (episode?.episodeId) {
    remember(positive, k, episode.episodeId, MAX_POSITIVE);
    return episode.episodeId;
  }
  remember(negative, k, Date.now(), MAX_NEGATIVE);
  return null;
}
