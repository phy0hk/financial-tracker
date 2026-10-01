import jwt from 'jsonwebtoken';
import type { Context, Next } from 'hono';
import type { Env } from '../types';

export type AuthClaims = {
  userId: string;
  role: 'user' | 'admin';
  tokenType?: 'access' | 'refresh';
};

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function getToken(request: Request): string | undefined {
  const authorization = request.headers.get('Authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();
  return readCookie(request, 'zt_access');
}

export function verifyClaims(token: string, secret: string, expectedType: 'access' | 'refresh' = 'access'): AuthClaims {
  const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload & Partial<AuthClaims>;
  if (
    typeof payload.userId !== 'string' ||
    (payload.role !== 'user' && payload.role !== 'admin') ||
    (payload.tokenType && payload.tokenType !== expectedType)
  ) {
    throw new Error('Invalid token claims');
  }
  return { userId: payload.userId, role: payload.role, tokenType: payload.tokenType };
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const token = getToken(c.req.raw);
  if (!token) return c.json({ error: 'Authentication required' }, 401);
  try {
    const claims = verifyClaims(token, c.env.JWT_SECRET);
    c.set('user', { id: claims.userId, role: claims.role });
    await next();
  } catch {
    return c.json({ error: 'Invalid or expired access token' }, 401);
  }
}

export async function requireAdmin(c: Context<Env>, next: Next): Promise<Response | void> {
  const user = c.get('user');
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin access required' }, 403);
  await next();
}
