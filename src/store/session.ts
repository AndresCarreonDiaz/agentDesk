import { randomBytes } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { SESSION_COOKIE as AGENT_COOKIE, SESSION_HEADER as AGENT_HEADER } from '../agentdesk/contract/types';

export const SHOPPER_COOKIE = 'harbor_sid';
const VALID_ID = /^[A-Za-z0-9_-]{8,64}$/;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of req.headers.cookie?.split(';') ?? []) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) {
      try {
        return decodeURIComponent(v.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

const valid = (v: string | undefined): v is string => !!v && VALID_ID.test(v);

// CONTRACT.md section 2: an agent visit is named by x-agentdesk-session (header first, then cookie).
export function agentSessionOf(req: Request): string | null {
  return [req.get(AGENT_HEADER), readCookie(req, AGENT_COOKIE)].find(valid) ?? null;
}

// Who owns the cart. During an agent visit it is the AgentDesk session, so the visitor's
// website fallback and the Door's capability calls share one cart. Humans get harbor_sid.
export function session(): RequestHandler {
  return (req, res, next) => {
    const agent = agentSessionOf(req);
    let shopper = agent ?? readCookie(req, SHOPPER_COOKIE);
    if (!valid(shopper)) {
      shopper = randomBytes(24).toString('hex');
      res.cookie(SHOPPER_COOKIE, shopper, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: WEEK_MS });
    }
    res.locals.shopperId = shopper;
    res.locals.agentSessionId = agent;
    next();
  };
}

export function shopperId(res: Response): string {
  return res.locals.shopperId as string;
}
