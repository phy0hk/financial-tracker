import { Hono } from 'hono';
import { desc, eq, sql } from 'drizzle-orm';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { createDatabase } from '../db/client';
import { users } from '../db/schema';
import type { Env } from '../types';

const admin = new Hono<Env>();
admin.use('*', authMiddleware, requireAdmin);

admin.get('/users', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, Number(c.req.query('pageSize') ?? '25') || 25));
  const database = createDatabase(c.env);
  const [rows, count] = await Promise.all([
    database.select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt }).from(users).orderBy(desc(users.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    database.select({ total: sql<number>`count(*)::int` }).from(users),
  ]);
  return c.json({ users: rows, page, pageSize, total: count[0]?.total ?? 0 });
});

admin.patch('/users/:id/status', async (c) => {
  const id = c.req.param('id');
  const database = createDatabase(c.env);
  const [current] = await database.select({ isActive: users.isActive }).from(users).where(eq(users.id, id)).limit(1);
  if (!current) return c.json({ error: 'User not found' }, 404);
  const [updated] = await database.update(users).set({ isActive: !current.isActive }).where(eq(users.id, id)).returning({ id: users.id, isActive: users.isActive });
  return c.json({ user: updated });
});

admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'An administrator cannot delete their own account' }, 400);
  const database = createDatabase(c.env);
  const deleted = await database.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  if (!deleted.length) return c.json({ error: 'User not found' }, 404);
  return c.json({ success: true });
});

export default admin;
