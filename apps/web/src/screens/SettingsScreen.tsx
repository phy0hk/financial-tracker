import { useRef, useState } from 'react';
import { Cloud, Download, LoaderCircle, RefreshCw, Upload } from 'lucide-react';
import { BackupEngine, ConflictStrategy } from '@zerotracker/core/backup';
import { StorageMode, useStorage } from '../context/StorageContext';
import { useAuth } from '../context/AuthContext';

type ModuleOption = { id: string; name: string; description: string };
const modules: ModuleOption[] = [
  { id: 'budgets', name: 'Budgets', description: 'Plan spending limits for each category.' },
  { id: 'recurring', name: 'Recurring expenses', description: 'Track subscriptions and scheduled payments.' },
  { id: 'reports', name: 'Advanced reports', description: 'Unlock additional trends and summaries.' },
];

export function SettingsScreen() {
  const { user, masterKey } = useAuth();
  const { mode, setMode, getExpenses, getCategories, addExpense, addCategory, triggerSync, isSyncing } = useStorage();
  const [message, setMessage] = useState('');
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => JSON.parse(localStorage.getItem('zerotracker.modules') ?? '{}') as Record<string, boolean>);
  const input = useRef<HTMLInputElement>(null);
  const backup = new BackupEngine();

  async function exportData() {
    if (!user) return;
    const data = { expenses: await getExpenses(), categories: await getCategories() };
    const content = await backup.exportToZTBak(data, masterKey ?? (() => { throw new Error('Unlock your account first'); })());
    const blob = new Blob([content], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `zerotracker-${new Date().toISOString().slice(0, 10)}.ztbak`; link.click(); URL.revokeObjectURL(url); setMessage('Encrypted backup downloaded.');
  }
  async function importData(file: File) {
    try {
      const result = await backup.importFromBackup(await file.text(), ConflictStrategy.SKIP, masterKey ?? undefined, { userId: user?.id });
      let imported = 0;
      for (const record of result.records.expenses ?? []) { await addExpense(record.data as never); imported += 1; }
      for (const record of result.records.categories ?? []) { await addCategory(record.data as never); imported += 1; }
      setMessage(`Imported ${imported} records.`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Import failed.'); }
  }
  function toggleModule(id: string) { const next = { ...enabled, [id]: !enabled[id] }; setEnabled(next); localStorage.setItem('zerotracker.modules', JSON.stringify(next)); }
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><div className="mx-auto max-w-3xl"><h1 className="mb-8 text-3xl font-semibold">Settings</h1><section className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-1 text-lg font-medium">Storage mode</h2><p className="mb-4 text-sm text-slate-400">Choose where encrypted records are stored. The server never receives plaintext.</p><div className="grid gap-3 sm:grid-cols-3">{[[StorageMode.LOCAL_ONLY, 'Local only'], [StorageMode.CLOUD_ONLY, 'Cloud only'], [StorageMode.HYBRID_SYNC, 'Hybrid sync']].map(([value, label]) => <button key={value} onClick={() => setMode(value as StorageMode)} className={`rounded-lg border p-3 text-left ${mode === value ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-700'}`}><Cloud size={18} className="mb-2 text-cyan-300" /><span className="block text-sm font-medium">{label}</span></button>)}</div><button onClick={() => void triggerSync()} disabled={isSyncing || mode === StorageMode.LOCAL_ONLY} className="mt-4 flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm disabled:opacity-50">{isSyncing ? <LoaderCircle className="animate-spin" size={16} /> : <RefreshCw size={16} />}Sync now</button></section><section className="mb-6 rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-1 text-lg font-medium">Encrypted backup</h2><p className="mb-4 text-sm text-slate-400">Backups are encrypted with your in-memory master key before download.</p><div className="flex flex-wrap gap-3"><button onClick={() => void exportData()} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950"><Download size={16} />Export .ztbak</button><button onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm"><Upload size={16} />Import backup</button><input ref={input} type="file" accept=".ztbak,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void importData(file); }} /></div>{message && <p className="mt-3 text-sm text-cyan-300">{message}</p>}</section><section className="rounded-xl border border-slate-800 bg-slate-900 p-5"><h2 className="mb-1 text-lg font-medium">Installed modules</h2><p className="mb-4 text-sm text-slate-400">Enable optional features without exposing your financial data.</p><div className="space-y-3">{modules.map((module) => <label key={module.id} className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-800 p-3"><span><span className="block text-sm font-medium">{module.name}</span><span className="text-xs text-slate-500">{module.description}</span></span><input type="checkbox" checked={Boolean(enabled[module.id])} onChange={() => toggleModule(module.id)} className="h-5 w-5 accent-cyan-400" /></label>)}</div></section></div></main>;
}
