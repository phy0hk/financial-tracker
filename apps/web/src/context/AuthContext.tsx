import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { deriveMasterKey, generateSalt } from '@zerotracker/core/crypto';

export type AuthUser = {
  id: string;
  email: string;
  role: 'user' | 'admin';
  isActive: boolean;
  createdAt: string;
  isGuest?: boolean;
  salt?: string;
};

type AuthResponse = { user: AuthUser; accessToken?: string; refreshToken?: string };
type AuthContextValue = {
  user: AuthUser | null;
  masterKey: CryptoKey | null;
  accessToken: string | null;
  isLoading: boolean;
  login(email: string, password: string, masterPassword?: string): Promise<void>;
  register(email: string, password: string, masterPassword?: string): Promise<void>;
  logout(): Promise<void>;
  clearSession(): Promise<void>;
  loginAsGuest(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const TOKEN_KEY = 'zerotracker.accessToken';
const SALT_PREFIX = 'zerotracker.keySalt.';
const GUEST_SESSION_KEY = 'zt_guest_session';
const GUEST_SALT_KEY = 'zt_guest_salt';
const DEVICE_SECRET_KEY = 'zt_guest_device_secret';

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Authentication request failed');
  }
  return response.json() as Promise<T>;
}

function getOrCreateLocalSecret(): string {
  const existing = localStorage.getItem(DEVICE_SECRET_KEY);
  if (existing) return existing;
  const secret = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : generateSalt();
  localStorage.setItem(DEVICE_SECRET_KEY, secret);
  return secret;
}

function getOrCreateGuestSalt(): string {
  const existing = localStorage.getItem(GUEST_SALT_KEY);
  if (existing) return existing;
  const salt = generateSalt();
  localStorage.setItem(GUEST_SALT_KEY, salt);
  return salt;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function hydrateGuest() {
      try {
        const rawSession = localStorage.getItem(GUEST_SESSION_KEY);
        const salt = localStorage.getItem(GUEST_SALT_KEY);
        const deviceSecret = localStorage.getItem(DEVICE_SECRET_KEY);
        if (!rawSession || !salt || !deviceSecret) return;
        const session = JSON.parse(rawSession) as Partial<AuthUser>;
        if (session.id !== 'local-guest' || session.email !== 'guest@local' || session.role !== 'user') throw new Error('Invalid guest session');
        const key = await deriveMasterKey(deviceSecret, salt);
        const guest: AuthUser = {
          id: 'local-guest', email: 'guest@local', role: 'user', isActive: true,
          createdAt: session.createdAt ?? new Date().toISOString(), isGuest: true,
        };
        if (active) { setUser(guest); setMasterKey(key); setAccessToken(null); }
      } catch {
        localStorage.removeItem(GUEST_SESSION_KEY);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void hydrateGuest();
    return () => { active = false; };
  }, []);

  const authenticate = useCallback(async (path: '/auth/login' | '/auth/register', email: string, password: string, masterPassword = password) => {
    setIsLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await request<AuthResponse>(path, { method: 'POST', body: JSON.stringify({ email: normalizedEmail, password }) });
      const salt = response.user.salt ?? localStorage.getItem(`${SALT_PREFIX}${normalizedEmail}`) ?? generateSalt();
      localStorage.setItem(`${SALT_PREFIX}${normalizedEmail}`, salt);
      const key = await deriveMasterKey(masterPassword, salt);
      setUser(response.user); setMasterKey(key);
      if (response.accessToken) { localStorage.setItem(TOKEN_KEY, response.accessToken); setAccessToken(response.accessToken); }
    } finally { setIsLoading(false); }
  }, []);

  const login = useCallback((email: string, password: string, masterPassword?: string) => authenticate('/auth/login', email, password, masterPassword), [authenticate]);
  const register = useCallback((email: string, password: string, masterPassword?: string) => authenticate('/auth/register', email, password, masterPassword), [authenticate]);
  const loginAsGuest = useCallback(async () => {
    setIsLoading(true);
    try {
      const guestSalt = getOrCreateGuestSalt();
      const deviceSecret = getOrCreateLocalSecret();
      const key = await deriveMasterKey(deviceSecret, guestSalt);
      const guest: AuthUser = { id: 'local-guest', email: 'guest@local', role: 'user', isActive: true, createdAt: new Date().toISOString(), isGuest: true };
      localStorage.setItem(GUEST_SALT_KEY, guestSalt);
      localStorage.setItem(DEVICE_SECRET_KEY, deviceSecret);
      localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify({ id: 'local-guest', email: 'guest@local', role: 'user' }));
      localStorage.removeItem(TOKEN_KEY);
      setUser(guest); setMasterKey(key); setAccessToken(null);
    } finally { setIsLoading(false); }
  }, []);

  const clearSession = useCallback(async () => {
    setMasterKey(null); setUser(null); setAccessToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GUEST_SESSION_KEY);
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  }, []);
  const logout = clearSession;
  const value = useMemo(() => ({ user, masterKey, accessToken, isLoading, login, register, logout, clearSession, loginAsGuest }), [user, masterKey, accessToken, isLoading, login, register, logout, clearSession, loginAsGuest]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
