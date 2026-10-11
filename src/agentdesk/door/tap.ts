// Written by the Store part and handed to the Door (CONTRACT.md v2: the tap is the Door's).
// Mount after body parsing: app.use(tap(db, siteId)).
import { randomBytes } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Db } from 'mongodb';
import { deskCollections } from '../contract/db';
import { ID_PREFIX, SESSION_COOKIE, SESSION_HEADER, type RequestDoc, type RequestSource } from '../contract/types';

const VALID_SESSION = /^[A-Za-z0-9_-]{8,64}$/;

// CONTRACT.md section 2: header first, then cookie.
export function sessionOf(req: Request): string | null {
  const cookie = req.headers.cookie
    ?.split(';')
    .map((p) => p.trim().split('='))
    .find(([k]) => k === SESSION_COOKIE)?.[1];
  return [req.get(SESSION_HEADER), cookie].find((v): v is string => !!v && VALID_SESSION.test(v)) ?? null;
}

// The Door marks its own capability replays with this header, so the tap sets source: "capability".
export const SOURCE_HEADER = 'x-agentdesk-source';
export const REQUEST_ID_HEADER = 'x-agentdesk-request';

// Not host-app traffic: static art, health checks and the Door's own endpoints.
const SKIP = /^\/(health$|img\/|favicon\.ico$|agent(desk)?(\/|$)|mcp(\/|$)|\.well-known\/)/;
const SECRET_KEY = /pass|card|cvc|cvv|secret|token|auth|ssn|_method/i;

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

export function shapeOf(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  return Object.fromEntries(
    Object.entries(body)
      .filter(([k]) => k !== '_method')
      .map(([k, v]) => [k, typeOf(v)]),
  );
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([k]) => k !== '_method')
      .map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v)]),
  );
}

export async function ensureTapIndexes(desk: Db) {
  const { requests } = deskCollections(desk);
  await Promise.all([
    requests.createIndex({ requestId: 1 }, { unique: true }),
    requests.createIndex({ sessionId: 1, timestamp: 1 }),
    requests.createIndex({ siteId: 1, timestamp: -1 }),
  ]);
}

// Records every host-app request into `requests` (CONTRACT.md section 3), after the
// response is sent, so the store never waits on it and a tap failure never breaks a page.
export function tap(desk: Db, siteId: string): RequestHandler {
  const { requests, episodes } = deskCollections(desk);
  return (req, res, next) => {
    const path = req.path;
    if (SKIP.test(path)) return next();
    const started = performance.now();
    const timestamp = new Date();
    const requestId = ID_PREFIX.request + randomBytes(8).toString('hex');
    res.setHeader(REQUEST_ID_HEADER, requestId);

    res.on('finish', () => {
      const sessionId = sessionOf(req);
      const source: RequestSource =
        req.get(SOURCE_HEADER) === 'capability' ? 'capability' : sessionId ? 'fallback' : 'direct';
      const record = async () => {
        const episode = sessionId
          ? await episodes.findOne({ sessionId }, { projection: { episodeId: 1 } })
          : null;
        const doc: RequestDoc = {
          requestId,
          siteId,
          sessionId,
          episodeId: episode?.episodeId ?? null,
          source,
          method: req.method,
          path,
          query: Object.fromEntries(
            Object.entries(req.query).filter((e): e is [string, string] => typeof e[1] === 'string'),
          ),
          bodyShape: shapeOf(req.body),
          body: req.body && Object.keys(req.body).length ? redact(req.body) : null,
          status: res.statusCode,
          durationMs: Math.round(performance.now() - started),
          timestamp,
          createdAt: new Date(),
        };
        await requests.insertOne(doc);
      };
      record().catch((err) => console.error('[tap] failed to record request', requestId, err));
    });
    next();
  };
}
