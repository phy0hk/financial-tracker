import { Hono } from 'hono';
import { and, eq, gt, sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/auth';
import { createDatabase } from '../db/client';
import { categories, expenses, userModules } from '../db/schema';
import type { Env } from '../types';

const sync = new Hono<Env>();
sync.use('*', authMiddleware);

type SyncBody = {
  categories: Array<{
    id: string;
    encryptedName: string;
    encryptedIcon?: string | null;
    encryptedColor?: string | null;
    createdAt?: string;
  }>;
  expenses: Array<{
    id: string;
    categoryId?: string | null;
    encryptedAmount: string;
    encryptedDescription?: string | null;
    iv: string;
    authTag: string;
    date: string;
    createdAt?: string;
  }>;
  modules: Array<{ moduleId: string; isEnabled: boolean; updatedAt?: string }>;
};

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

sync.post('/push', async (c) => {
  const userId = c.get('user').id;
  const body = await c.req.json<SyncBody>().catch(() => null);
  if (!body || !Array.isArray(body.categories) || !Array.isArray(body.expenses) || !Array.isArray(body.modules)) {
    return c.json({ error: 'categories, expenses, and modules arrays are required' }, 400);
  }
  if (body.categories.some((item) => !isText(item.id) || !isText(item.encryptedName)) || body.expenses.some((item) => !isText(item.id) || !isText(item.encryptedAmount) || !isText(item.iv) || !isText(item.authTag) || !isText(item.date)) || body.modules.some((item) => !isText(item.moduleId) || typeof item.isEnabled !== 'boolean')) {
    return c.json({ error: 'Invalid encrypted sync record' }, 400);
  }
  const categoryItems = body.categories ?? [];
  const expenseItems = body.expenses ?? [];
  const moduleItems = body.modules ?? [];
  const database = createDatabase(c.env);
  await database.transaction(async (tx) => {
    if (categoryItems.length) {
      await tx.insert(categories).values(body.categories.map((item) => ({
        id: item.id,
        userId,
        encryptedName: item.encryptedName,
        encryptedIcon: item.encryptedIcon ?? null,
        encryptedColor: item.encryptedColor ?? null,
        ...(item.createdAt ? { createdAt: new Date(item.createdAt) } : {}),
      }))).onConflictDoUpdate({ target: categories.id, set: { encryptedName: sql`excluded.encrypted_name`, encryptedIcon: sql`excluded.encrypted_icon`, encryptedColor: sql`excluded.encrypted_color` } });
    }
    if (body.expenses.length) {
      await tx.insert(expenses).values(body.expenses.map((item) => ({
        id: item.id,
        userId,
        categoryId: item.categoryId ?? null,
        encryptedAmount: item.encryptedAmount,
        encryptedDescription: item.encryptedDescription ?? null,
        iv: item.iv,
        authTag: item.authTag,
        date: new Date(item.date),
        ...(item.createdAt ? { createdAt: new Date(item.createdAt) } : {}),
      }))).onConflictDoUpdate({ target: expenses.id, set: { encryptedAmount: sql`excluded.encrypted_amount`, encryptedDescription: sql`excluded.encrypted_description`, iv: sql`excluded.iv`, authTag: sql`excluded.auth_tag`, categoryId: sql`excluded.category_id`, date: sql`excluded.date` } });
    }
    if (body.modules.length) {
      await tx.insert(userModules).values(body.modules.map((item) => ({ userId, moduleId: item.moduleId, isEnabled: item.isEnabled, ...(item.updatedAt ? { updatedAt: new Date(item.updatedAt) } : {}) }))).onConflictDoUpdate({ target: [userModules.userId, userModules.moduleId], set: { isEnabled: sql`excluded.is_enabled`, updatedAt: sql`excluded.updated_at` } });
    }
  });
  return c.json({ success: true, syncedAt: new Date().toISOString() });
});

sync.get('/pull', async (c) => {
  const userId = c.get('user').id;
  const rawSince = c.req.query('lastSyncedAt');
  const since = rawSince ? new Date(rawSince) : new Date(0);
  if (Number.isNaN(since.getTime())) return c.json({ error: 'lastSyncedAt must be an ISO timestamp' }, 400);
  const database = createDatabase(c.env);
  const [categoryRows, expenseRows, moduleRows] = await Promise.all([
    database.select().from(categories).where(and(eq(categories.userId, userId), gt(categories.createdAt, since))),
    database.select().from(expenses).where(and(eq(expenses.userId, userId), gt(expenses.createdAt, since))),
    database.select().from(userModules).where(eq(userModules.userId, userId)),
  ]);
  return c.json({ categories: categoryRows, expenses: expenseRows, modules: moduleRows, syncedAt: new Date().toISOString() });
});

export default sync;
