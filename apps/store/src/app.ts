import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import type { Db } from 'mongodb';
import { collections } from './db';
import { HttpError } from './errors';
import { body, isForm } from './http';
import { apiRouter } from './routes/api';
import { pagesRouter } from './routes/pages';
import { session } from './session';
import { layout } from './views/layout';
import { notFoundPage } from './views/pages';

export interface AppOptions {
  siteUrl: string;
  // AgentDesk mounts its tap here: runs after the session is known, before store routes.
  // Its own routes (/agent, /mcp, /.well-known/agentdesk) are reserved and unused by the store.
  beforeRoutes?: RequestHandler[];
}

// HTML forms can only POST; a hidden _method field turns them into PATCH/DELETE
// so they reach the same handlers JSON clients use.
const formMethodOverride: RequestHandler = (req, _res, next) => {
  const m = body(req)._method;
  if (req.method === 'POST' && isForm(req) && typeof m === 'string' && ['PATCH', 'DELETE'].includes(m.toUpperCase())) {
    req.method = m.toUpperCase();
  }
  next();
};

function safeBackPath(referer: string | undefined): string {
  try {
    const path = referer ? new URL(referer).pathname : '/cart';
    return path.startsWith('/') && !path.startsWith('//') ? path : '/cart';
  } catch {
    return '/cart';
  }
}

const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = err instanceof HttpError;
  const parseError = (err as { type?: string }).type === 'entity.parse.failed';
  const status = known ? err.status : parseError ? 400 : 500;
  const code = known ? err.code : parseError ? 'bad_request' : 'internal';
  const message = known ? err.message : parseError ? 'Request body is not valid JSON.' : 'Unexpected error.';
  if (!known && !parseError) console.error(err);

  if (isForm(req)) return res.redirect(303, `${safeBackPath(req.get('referer'))}?error=${code}`);
  if (req.method === 'GET' && !req.path.startsWith('/api') && req.accepts(['json', 'html']) === 'html') {
    return res.status(status).type('html').send(layout({ title: 'Not found', cartCount: 0 }, notFoundPage(message)));
  }
  res.status(status).json({ error: code, message });
};

export function createApp(db: Db, opts: AppOptions): Express {
  const c = collections(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.get('/health', async (_req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ ok: true, mongo: true });
    } catch {
      res.status(503).json({ ok: false, mongo: false });
    }
  });

  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(formMethodOverride);
  app.use(session());
  for (const mw of opts.beforeRoutes ?? []) app.use(mw);

  app.use(apiRouter(c));
  app.use(pagesRouter(c, opts.siteUrl));

  app.use((req, _res, next) => next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}.`)));
  app.use(errorHandler);
  return app;
}
