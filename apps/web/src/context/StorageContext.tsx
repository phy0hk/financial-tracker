import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CloudPostgresAdapter, LocalSqliteAdapter, StorageMode, generateId, type EncryptedCategory, type EncryptedExpense, type IDatabaseAdapter, type SQLiteConnection } from '@zerotracker/core/db';
import { useAuth } from './AuthContext';

type StorageContextValue = {
  mode: StorageMode;
  setMode(mode: StorageMode): void;
  getExpenses(): Promise<EncryptedExpense[]>;
  addExpense(expense: Omit<EncryptedExpense, 'id'>): Promise<EncryptedExpense>;
  getCategories(): Promise<EncryptedCategory[]>;
  addCategory(category: Omit<EncryptedCategory, 'id'>): Promise<EncryptedCategory>;
  triggerSync(): Promise<void>;
  isSyncing: boolean;
};

const StorageContext = createContext<StorageContextValue | undefined>(undefined);
const MODE_KEY = 'zerotracker.storageMode';
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

class MemoryAdapter implements IDatabaseAdapter {
  private expenses: EncryptedExpense[] = [];
  private categories: EncryptedCategory[] = [];
  async getExpenses(userId: string) { return this.expenses.filter((item) => item.userId === userId); }
  async getExpenseById(id: string) { return this.expenses.find((item) => item.id === id) ?? null; }
  async addExpense(expense: Omit<EncryptedExpense, 'id'>) { const record = { id: generateId(), ...expense }; this.expenses.push(record); return record; }
  async updateExpense(expense: EncryptedExpense) { this.expenses = this.expenses.map((item) => item.id === expense.id ? expense : item); return expense; }
  async deleteExpense(id: string) { this.expenses = this.expenses.filter((item) => item.id !== id); }
  async getCategories(userId: string) { return this.categories.filter((item) => item.userId === userId); }
  async getCategoryById(id: string) { return this.categories.find((item) => item.id === id) ?? null; }
  async addCategory(category: Omit<EncryptedCategory, 'id'>) { const record = { id: generateId(), ...category }; this.categories.push(record); return record; }
  async updateCategory(category: EncryptedCategory) { this.categories = this.categories.map((item) => item.id === category.id ? category : item); return category; }
  async deleteCategory(id: string) { this.categories = this.categories.filter((item) => item.id !== id); }
  async getPendingSyncDeltas() { return {}; }
  async markSynced() { return undefined; }
}

type Props = { children: ReactNode; localConnection?: SQLiteConnection };

export function StorageProvider({ children, localConnection }: Props) {
  const { user, accessToken } = useAuth();
  const [mode, setModeState] = useState<StorageMode>(() => (localStorage.getItem(MODE_KEY) as StorageMode | null) ?? StorageMode.LOCAL_ONLY);
  const [isSyncing, setIsSyncing] = useState(false);
  const [localAdapter] = useState<IDatabaseAdapter>(() => localConnection ? new LocalSqliteAdapter(localConnection) : new MemoryAdapter());
  const [cloudAdapter] = useState(() => new CloudPostgresAdapter({ baseUrl: API_URL, getToken: () => localStorage.getItem('zerotracker.accessToken') ?? accessToken ?? '' }));

  useEffect(() => { if (localAdapter instanceof LocalSqliteAdapter) void localAdapter.init(); }, [localAdapter]);
  useEffect(() => {
    if (user?.isGuest) setModeState(StorageMode.LOCAL_ONLY);
    if (user?.isGuest) localStorage.setItem(MODE_KEY, StorageMode.LOCAL_ONLY);
  }, [user]);
  const setMode = useCallback((next: StorageMode) => { localStorage.setItem(MODE_KEY, next); setModeState(next); }, []);
  const adapter = mode === StorageMode.CLOUD_ONLY ? cloudAdapter : localAdapter;
  const getExpenses = useCallback(() => user ? adapter.getExpenses(user.id) : Promise.resolve([]), [adapter, user]);
  const getCategories = useCallback(() => user ? adapter.getCategories(user.id) : Promise.resolve([]), [adapter, user]);
  const addExpense = useCallback((expense: Omit<EncryptedExpense, 'id'>) => adapter.addExpense(expense), [adapter]);
  const addCategory = useCallback((category: Omit<EncryptedCategory, 'id'>) => adapter.addCategory(category), [adapter]);
  const triggerSync = useCallback(async () => {
    if (!user || mode === StorageMode.LOCAL_ONLY) return;
    setIsSyncing(true);
    try {
      if (mode === StorageMode.HYBRID_SYNC) {
        const [expenses, categories] = await Promise.all([localAdapter.getExpenses(user.id), localAdapter.getCategories(user.id)]);
        await fetch(`${API_URL}/api/sync/push`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify({ expenses, categories, modules: [] }) }).then(async (response) => { if (!response.ok) throw new Error('Sync failed'); });
      } else await cloudAdapter.getExpenses(user.id);
    } finally { setIsSyncing(false); }
  }, [accessToken, cloudAdapter, localAdapter, mode, user]);
  const value = useMemo(() => ({ mode, setMode, getExpenses, addExpense, getCategories, addCategory, triggerSync, isSyncing }), [mode, setMode, getExpenses, addExpense, getCategories, addCategory, triggerSync, isSyncing]);
  return <StorageContext.Provider value={value}>{children}</StorageContext.Provider>;
}

export function useStorage(): StorageContextValue {
  const value = useContext(StorageContext);
  if (!value) throw new Error('useStorage must be used inside StorageProvider');
  return value;
}

export { StorageMode };
