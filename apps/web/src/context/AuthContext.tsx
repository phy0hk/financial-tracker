import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
  loginAsGuest(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
const TOKEN_KEY = 'zerotracker.accessToken';
const SALT_PREFIX = 'zerotracker.keySalt.';

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? 'Authentication request failed');
  }
  return response.json() as Promise<T>;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [accessToken, setAccessToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [isLoading, setIsLoading] = useState(false);

  const authenticate = useCallback(async (path: '/auth/login' | '/auth/register', email: string, password: string, masterPassword = password) => {
    setIsLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const response = await request<AuthResponse>(path, { method: 'POST', body: JSON.stringify({ email: normalizedEmail, password }) });
      const salt = response.user.salt ?? localStorage.getItem(`${SALT_PREFIX}${normalizedEmail}`) ?? generateSalt();
      localStorage.setItem(`${SALT_PREFIX}${normalizedEmail}`, salt);
      const key = await deriveMasterKey(masterPassword, salt);
      setUser(response.user);
      setMasterKey(key);
      if (response.accessToken) {
        localStorage.setItem(TOKEN_KEY, response.accessToken);
        setAccessToken(response.accessToken);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback((email: string, password: string, masterPassword?: string) => authenticate('/auth/login', email, password, masterPassword), [authenticate]);
  const register = useCallback((email: string, password: string, masterPassword?: string) => authenticate('/auth/register', email, password, masterPassword), [authenticate]);
  const loginAsGuest = useCallback(async () => {
    setIsLoading(true);
    try {
      const deviceSecretKey = 'zerotracker.deviceSecret';
      const deviceSecret = localStorage.getItem(deviceSecretKey) ?? (() => {
        const secret = generateSalt();
        localStorage.setItem(deviceSecretKey, secret);
        return secret;
      })();
      const key = await deriveMasterKey(deviceSecret, 'zerotracker.local-only.v1');
      setUser({ id: 'local-guest', email: 'guest@local', role: 'user', isActive: true, createdAt: new Date().toISOString(), isGuest: true });
      setMasterKey(key);
      setAccessToken(null);
      localStorage.removeItem(TOKEN_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setMasterKey(null);
    setUser(null);
    setAccessToken(null);
    localStorage.removeItem(TOKEN_KEY);
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ user, masterKey, accessToken, isLoading, login, register, logout, loginAsGuest }), [user, masterKey, accessToken, isLoading, login, register, logout, loginAsGuest]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
