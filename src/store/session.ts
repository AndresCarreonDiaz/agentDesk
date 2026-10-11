import { randomBytes } from 'node:crypto';
import type { RequestHandler, Response } from 'express';

export const SESSION_COOKIE = 'harbor_sid';
export const SESSION_HEADER = 'x-session-id';
const VALID_SID = /^[A-Za-z0-9_-]{8,64}$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of header?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

// Guest session: browsers get the harbor_sid cookie; agents and Playwright may send
// x-session-id instead. The AgentDesk tap reads res.locals.sessionId.
export function session(): RequestHandler {
  return (req, res, next) => {
    const header = req.get(SESSION_HEADER);
    const cookie = readCookie(req.headers.cookie, SESSION_COOKIE);
    let sid = [header, cookie].find((v): v is string => !!v && VALID_SID.test(v));
    if (!sid) {
      sid = randomBytes(24).toString('hex');
      res.cookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: WEEK_MS });
    }
    res.locals.sessionId = sid;
    next();
  };
}

export function sessionId(res: Response): string {
  return res.locals.sessionId as string;
}
