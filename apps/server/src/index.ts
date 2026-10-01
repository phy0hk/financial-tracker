import { Hono } from 'hono';
import { cors } from 'hono/cors';
import auth from './routes/auth';
import sync from './routes/sync';
import admin from './routes/admin';
import type { Env } from './types';

const app = new Hono<Env>();

app.use('*', async (c, next) => {
  await cors({
    origin: c.env.CORS_ORIGIN ?? '*',
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  })(c, next);
});

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
