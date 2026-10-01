import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CloudPostgresAdapter, LocalSqliteAdapter, StorageMode, createIndexedDbConnection, generateId, type EncryptedCategory, type EncryptedExpense, type IDatabaseAdapter, type SQLiteConnection } from '@zerotracker/core/db';
import { decryptPayload, encryptPayload } from '@zerotracker/core/crypto';
import { useAuth } from './AuthContext';

export type DecryptedExpense = EncryptedExpense & { amount: number; income: boolean; description: string };
type StorageContextValue = {
  mode: StorageMode;
  expenses: DecryptedExpense[];
  setMode(mode: StorageMode): void;
  getExpenses(): Promise<EncryptedExpense[]>;
  reloadExpenses(): Promise<void>;
  addExpense(expense: { amount: number; income: boolean; description: string; categoryId: string | null; date: string }): Promise<EncryptedExpense>;
  updateExpense(expense: EncryptedExpense): Promise<EncryptedExpense>;
  deleteExpense(id: string): Promise<void>;
  getCategories(): Promise<EncryptedCategory[]>;
  addCategory(category: Omit<EncryptedCategory, 'id'>): Promise<EncryptedCategory>;
  triggerSync(): Promise<void>;
  isSyncing: boolean;
};

const StorageContext = createContext<StorageContextValue | undefined>(undefined);
const MODE_KEY = 'zerotracker.storageMode';

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';



type Props = { children: ReactNode; localConnection?: SQLiteConnection };
export function StorageProvider({ children, localConnection }: Props) {
  const { user, accessToken, masterKey } = useAuth();
  const [mode, setModeState] = useState<StorageMode>(() => (localStorage.getItem(MODE_KEY) as StorageMode | null) ?? StorageMode.LOCAL_ONLY);
  const [isSyncing, setIsSyncing] = useState(false);
  const [expenses, setExpenses] = useState<DecryptedExpense[]>([]);
  const [localAdapter] = useState<IDatabaseAdapter>(() => new LocalSqliteAdapter(localConnection ?? createIndexedDbConnection()));
  const [cloudAdapter] = useState(() => new CloudPostgresAdapter({ baseUrl: API_URL, getToken: () => localStorage.getItem('zerotracker.accessToken') ?? accessToken ?? '' }));
  useEffect(() => { if (localAdapter instanceof LocalSqliteAdapter) void localAdapter.init(); }, [localAdapter]);
  useEffect(() => { if (user?.isGuest) { setModeState(StorageMode.LOCAL_ONLY); localStorage.setItem(MODE_KEY, StorageMode.LOCAL_ONLY); } }, [user]);
  const setMode = useCallback((next: StorageMode) => { localStorage.setItem(MODE_KEY, next); setModeState(next); }, []);
  const adapter = mode === StorageMode.CLOUD_ONLY ? cloudAdapter : localAdapter;
  const getExpenses = useCallback(() => user ? adapter.getExpenses(user.id) : Promise.resolve([]), [adapter, user]);
  const reloadExpenses = useCallback(async () => {
    if (!user || !masterKey) { setExpenses([]); return; }
    const records = await adapter.getExpenses(user.id);
    const decrypted = await Promise.all(records.map(async (record) => {
      try {
        const payload = JSON.parse(await decryptPayload(record.encryptedAmount, record.iv, record.authTag, masterKey)) as { amount?: number; income?: boolean; description?: string };
        return { ...record, amount: Number(payload.amount ?? 0), income: Boolean(payload.income), description: payload.description ?? '' };
      } catch (err) {
        console.error('[StorageContext] Unable to decrypt expense', record.id, err);
        return null;
      }
    }));
    setExpenses(decrypted.filter((record): record is DecryptedExpense => record !== null));
  }, [adapter, masterKey, user]);
  useEffect(() => { void reloadExpenses().catch((err) => console.error('[StorageContext] Unable to reload expenses', err)); }, [reloadExpenses]);
  const addExpense = useCallback(async (expense: { amount: number; income: boolean; description: string; categoryId: string | null; date: string }) => {
    if (!user || !masterKey) throw new Error('Encryption key is not available');
    const payload = await encryptPayload(JSON.stringify({ amount: expense.amount, income: expense.income, description: expense.description }), masterKey);
    const record = await adapter.addExpense({ userId: user.id, categoryId: expense.categoryId, encryptedAmount: payload.ciphertext, encryptedDescription: null, iv: payload.iv, authTag: payload.authTag, date: expense.date, createdAt: new Date().toISOString() });
    await reloadExpenses();
    return record;
  }, [adapter, masterKey, reloadExpenses, user]);
  const updateExpense = useCallback((expense: EncryptedExpense) => adapter.updateExpense(expense), [adapter]);
  const deleteExpense = useCallback((id: string) => adapter.deleteExpense(id), [adapter]);
  const getCategories = useCallback(() => user ? adapter.getCategories(user.id) : Promise.resolve([]), [adapter, user]);
  const addCategory = useCallback((category: Omit<EncryptedCategory, 'id'>) => adapter.addCategory(category), [adapter]);
  const triggerSync = useCallback(async () => {
    if (!user || mode === StorageMode.LOCAL_ONLY) return;
    setIsSyncing(true);
    try { if (mode === StorageMode.HYBRID_SYNC) { const [expenses, categories] = await Promise.all([localAdapter.getExpenses(user.id), localAdapter.getCategories(user.id)]); await fetch(`${API_URL}/api/sync/push`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ expenses, categories, modules: [] }) }).then((response) => { if (!response.ok) throw new Error('Sync failed'); }); } else await cloudAdapter.getExpenses(user.id); } finally { setIsSyncing(false); }
  }, [accessToken, cloudAdapter, localAdapter, mode, user]);
  const value = useMemo(() => ({ mode, expenses, setMode, getExpenses, reloadExpenses, addExpense, updateExpense, deleteExpense, getCategories, addCategory, triggerSync, isSyncing }), [mode, expenses, setMode, getExpenses, reloadExpenses, addExpense, updateExpense, deleteExpense, getCategories, addCategory, triggerSync, isSyncing]);
  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}
export function useStorage(): StorageContextValue { const value = useContext(StorageContext); if (!value) throw new Error('useStorage must be used inside StorageProvider'); return value; }
export { StorageMode };
