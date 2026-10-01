import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ArrowDownRight, ArrowUpRight, Plus, WalletCards, X } from 'lucide-react';
import { decryptPayload, encryptPayload } from '@zerotracker/core/crypto';
import type { EncryptedExpense } from '@zerotracker/core/db';
import { useAuth } from '../context/AuthContext';
import { StorageMode, useStorage } from '../context/StorageContext';

type PlainExpense = { id: string; amount: number; description: string; income: boolean; date: string; category: string };
const categories = ['Food', 'Rent', 'Salary', 'Utilities', 'Entertainment', 'Custom'];
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

async function decryptRecord(expense: EncryptedExpense, key: CryptoKey): Promise<PlainExpense> {
  try {
    const payload = JSON.parse(await decryptPayload(expense.encryptedAmount, expense.iv, expense.authTag, key)) as { amount?: number; income?: boolean; description?: string };
    return { id: expense.id, amount: Number(payload.amount ?? 0), income: Boolean(payload.income), description: payload.description ?? '', date: expense.date, category: expense.categoryId ?? 'Uncategorized' };
  } catch {
    return { id: expense.id, amount: 0, income: false, description: 'Encrypted record unavailable', date: expense.date, category: expense.categoryId ?? 'Uncategorized' };
  }
}

export function DashboardScreen() {
  const { user, masterKey } = useAuth();
  const { mode, getExpenses, addExpense } = useStorage();
  const [expenses, setExpenses] = useState<PlainExpense[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ amount: '', type: 'expense', category: 'Food', description: '', date: new Date().toISOString().slice(0, 10) });

  const refresh = useCallback(async () => {
    if (!user || !masterKey) return;
    const rows = await getExpenses();
    setExpenses(await Promise.all(rows.map((row) => decryptRecord(row, masterKey))));
  }, [getExpenses, masterKey, user]);

  useEffect(() => { void refresh().catch(() => setError('Unable to load encrypted records.')); }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!masterKey || !user || Number(form.amount) <= 0) return;
    setIsSaving(true); setError('');
    try {
      const encrypted = await encryptPayload(JSON.stringify({ amount: Number(form.amount), income: form.type === 'income', description: form.description.trim() }), masterKey);
      await addExpense({ userId: user.id, categoryId: form.category, encryptedAmount: encrypted.ciphertext, encryptedDescription: null, iv: encrypted.iv, authTag: encrypted.authTag, date: form.date, createdAt: new Date().toISOString() });
      setForm({ amount: '', type: 'expense', category: 'Food', description: '', date: new Date().toISOString().slice(0, 10) });
      setIsModalOpen(false);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save transaction.'); }
    finally { setIsSaving(false); }
  }

  const income = useMemo(() => expenses.filter((item) => item.income).reduce((sum, item) => sum + item.amount, 0), [expenses]);
  const spending = useMemo(() => expenses.filter((item) => !item.income).reduce((sum, item) => sum + item.amount, 0), [expenses]);

  return <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6"><div className="mx-auto max-w-6xl">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-2 text-sm text-cyan-300">Welcome back, {user?.isGuest ? 'Guest' : user?.email}</p><h1 className="text-3xl font-bold tracking-tight">Financial overview</h1><p className="mt-1 text-sm text-slate-400">Your transactions stay encrypted on this device.</p></div><button onClick={() => setIsModalOpen(true)} className="flex items-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-cyan-300"><Plus size={19} />Add Transaction</button></header>
    <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />{mode === StorageMode.LOCAL_ONLY ? 'Local-only mode • data never syncs to the cloud' : `Storage mode: ${mode}`}</div>
    {error && <p role="alert" className="mb-5 rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
    <div className="mb-8 grid gap-4 md:grid-cols-3"><Metric label="Total Spent" value={spending} icon={<ArrowDownRight className="text-rose-300" />} /><Metric label="Total Income" value={income} icon={<ArrowUpRight className="text-emerald-300" />} /><Metric label="Net Balance" value={income - spending} icon={<WalletCards className="text-cyan-300" />} /></div>
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"><div className="flex items-center justify-between border-b border-slate-800 px-5 py-4"><h2 className="font-semibold">Recent transactions</h2><span className="text-sm text-slate-500">{expenses.length} total</span></div>{expenses.length === 0 ? <div className="px-5 py-16 text-center text-slate-500">No transactions yet. Add your first one to start tracking.</div> : <div className="divide-y divide-slate-800">{[...expenses].sort((a, b) => b.date.localeCompare(a.date)).map((item) => <div key={item.id} className="flex items-center justify-between gap-4 px-5 py-4"><div className="min-w-0"><p className="truncate font-medium">{item.description || item.category}</p><p className="mt-1 text-xs text-slate-500">{item.category} · {item.date}</p></div><p className={`shrink-0 font-semibold ${item.income ? 'text-emerald-300' : 'text-slate-100'}`}>{item.income ? '+' : '-'}{money.format(item.amount)}</p></div>)}</div>}</section>
    {isModalOpen && <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true"><section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"><div className="mb-6 flex items-center justify-between"><div><h2 className="text-xl font-bold">Add transaction</h2><p className="text-sm text-slate-400">Encrypted locally before it is saved.</p></div><button onClick={() => setIsModalOpen(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white" aria-label="Close"><X size={20} /></button></div><form onSubmit={submit} className="grid gap-4"><label className="text-sm text-slate-300">Amount ($)<input required min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="field" /></label><label className="text-sm text-slate-300">Type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="field"><option value="expense">Expense</option><option value="income">Income</option></select></label><label className="text-sm text-slate-300">Category<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="field">{categories.map((category) => <option key={category}>{category}</option>)}</select></label><label className="text-sm text-slate-300">Description / Merchant name<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="e.g. Neighborhood market" className="field" /></label><label className="text-sm text-slate-300">Date<input required type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="field" /></label><button disabled={isSaving} className="mt-2 rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 disabled:opacity-60">{isSaving ? 'Encrypting…' : 'Save transaction'}</button></form></section></div>}
  </div></main>;
}

function Metric({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5"><div className="mb-4 flex justify-between text-sm text-slate-400"><span>{label}</span>{icon}</div><p className="text-2xl font-bold">{money.format(value)}</p></div>; }
