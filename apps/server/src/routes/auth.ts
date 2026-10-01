import jwt from 'jsonwebtoken';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { createDatabase } from '../db/client';
import { verifyClaims } from '../middleware/auth';
import type { Env } from '../types';

const auth = new Hono<Env>();

type Credentials = { email?: string; password?: string };
type RefreshRequest = { refreshToken?: string };
const encoder = new TextEncoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derivePassword(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function token(c: Context<Env>, userId: string, role: 'user' | 'admin', tokenType: 'access' | 'refresh'): string {
  const ttl = tokenType === 'access' ? c.env.ACCESS_TOKEN_TTL ?? '15m' : c.env.REFRESH_TOKEN_TTL ?? '30d';
  return jwt.sign({ userId, role, tokenType }, c.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: ttl as jwt.SignOptions['expiresIn'] });
}

function setAuthCookies(c: Context<Env>, accessToken: string, refreshToken?: string): void {
  const secure = c.env.COOKIE_SECURE !== 'false';
  setCookie(c, 'zt_access', accessToken, { httpOnly: true, secure, sameSite: 'Strict', path: '/', maxAge: 900 });
  if (refreshToken) {
    setCookie(c, 'zt_refresh', refreshToken, { httpOnly: true, secure, sameSite: 'Strict', path: '/auth/refresh', maxAge: 2_592_000 });
  }
}

function publicUser(user: typeof users.$inferSelect) {
  return { id: user.id, email: user.email, role: user.role, isActive: user.isActive, createdAt: user.createdAt, salt: user.salt };
}

auth.post('/register', async (c) => {
  const body: Credentials = await c.req.json<Credentials>().catch(() => ({} as Credentials));
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password || body.password.length < 8) return c.json({ error: 'Email and a password of at least 8 characters are required' }, 400);
  const database = createDatabase(c.env);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const id = crypto.randomUUID();
  const passwordHash = await derivePassword(body.password, salt);
  try {
    const [user] = await database.insert(users).values({ id, email, passwordHash, salt: bytesToBase64(salt) }).returning();
    const accessToken = token(c, user.id, user.role, 'access');
    const refreshToken = token(c, user.id, user.role, 'refresh');
    setAuthCookies(c, accessToken, refreshToken);
    return c.json({ user: publicUser(user), accessToken, refreshToken }, 201);
  } catch {
    return c.json({ error: 'Email is already registered' }, 409);
  }
});

auth.post('/login', async (c) => {
  const body: Credentials = await c.req.json<Credentials>().catch(() => ({} as Credentials));
  const email = body.email?.trim().toLowerCase();
  if (!email || !body.password) return c.json({ error: 'Email and password are required' }, 400);
  const database = createDatabase(c.env);
  const [user] = await database.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !user.isActive || (await derivePassword(body.password, base64ToBytes(user.salt))) !== user.passwordHash) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }
  const accessToken = token(c, user.id, user.role, 'access');
  const refreshToken = token(c, user.id, user.role, 'refresh');
  setAuthCookies(c, accessToken, refreshToken);
  return c.json({ user: publicUser(user), accessToken, refreshToken });
});

auth.post('/refresh', async (c) => {
  const body: RefreshRequest = await c.req.json<RefreshRequest>().catch(() => ({} as RefreshRequest));
  const refreshToken = body.refreshToken ?? getCookie(c, 'zt_refresh');
  if (!refreshToken) return c.json({ error: 'Refresh token required' }, 401);
  try {
    const claims = verifyClaims(refreshToken, c.env.JWT_SECRET, 'refresh');
    const database = createDatabase(c.env);
    const [user] = await database.select().from(users).where(eq(users.id, claims.userId)).limit(1);
    if (!user || !user.isActive) return c.json({ error: 'Account is inactive' }, 401);
    const accessToken = token(c, user.id, user.role, 'access');
    setAuthCookies(c, accessToken);
    return c.json({ accessToken });
  } catch {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }
});

auth.post('/logout', (c) => {
  deleteCookie(c, 'zt_access', { path: '/' });
  deleteCookie(c, 'zt_refresh', { path: '/auth/refresh' });
  return c.json({ success: true });
});

export default auth;
