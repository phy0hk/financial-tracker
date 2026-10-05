import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import sync from './routes/sync';
import admin from './routes/admin';
import type { Env } from './types';

const app = new Hono<Env>();

// The web client calls the API with `credentials: 'include'` (auth cookies +
// bearer token). The CORS spec forbids `Access-Control-Allow-Origin: *` on
// credentialed responses, so we must echo the request's own origin instead of
// the wildcard. `CORS_ORIGIN` may be `*` (allow/echo any origin, useful in dev)
// or a comma-separated allowlist of permitted origins for production.
function resolveCorsOrigin(requestOrigin: string, configured: string | undefined): string | null {
  const allowlist = (configured ?? '*').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (allowlist.includes('*')) return requestOrigin;
  return allowlist.includes(requestOrigin) ? requestOrigin : null;
}

app.use('*', cors({
  origin: (requestOrigin, c) => resolveCorsOrigin(requestOrigin, c.env.CORS_ORIGIN),
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));

app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/auth', auth);
app.route('/api/sync', sync);
app.route('/admin', admin);

app.notFound((c) => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => {
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

export default app;
