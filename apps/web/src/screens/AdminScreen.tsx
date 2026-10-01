import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Trash2, UserRoundCheck, UserRoundX } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type AdminUser = { id: string; email: string; role: string; isActive: boolean; createdAt: string };
type UserResponse = { users: AdminUser[]; page: number; pageSize: number; total: number };
const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export function AdminScreen() {
  const { user, accessToken } = useAuth();
  const [result, setResult] = useState<UserResponse>({ users: [], page: 1, pageSize: 25, total: 0 });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const headers = { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) };
  const loadUsers = useCallback(async (page = 1) => {
    if (user?.role !== 'admin') return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${API_URL}/admin/users?page=${page}&pageSize=25`, { credentials: 'include', headers });
      const payload = await response.json() as UserResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load users.');
      setResult(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load users.'); }
    finally { setLoading(false); }
  }, [accessToken, user?.role]);
  useEffect(() => { void loadUsers(); }, [loadUsers]);

  async function changeStatus(id: string) {
    const response = await fetch(`${API_URL}/admin/users/${id}/status`, { method: 'PATCH', credentials: 'include', headers });
    if (!response.ok) { setError('Unable to change account status.'); return; }
    await loadUsers(result.page);
  }
  async function deleteUser(id: string) {
    if (!window.confirm('Delete this user account permanently?')) return;
    const response = await fetch(`${API_URL}/admin/users/${id}`, { method: 'DELETE', credentials: 'include', headers });
    if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; setError(payload.error ?? 'Unable to delete user.'); return; }
    await loadUsers(result.page);
  }

  if (user?.role !== 'admin') return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><section className="mx-auto max-w-xl rounded-xl border border-rose-900 bg-slate-900 p-8"><h1 className="text-2xl font-semibold">Access denied</h1><p className="mt-2 text-slate-400">This dashboard requires the ROLE_ADMIN permission.</p></section></main>;
  const lastPage = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <main className="min-h-screen bg-slate-950 p-6 text-slate-100"><div className="mx-auto max-w-6xl"><header className="mb-8 flex items-center gap-3"><ShieldCheck className="text-cyan-300" /><div><h1 className="text-3xl font-semibold">Admin dashboard</h1><p className="text-sm text-slate-400">Manage ZeroTracker accounts without accessing encrypted financial data.</p></div></header>{error && <p className="mb-4 rounded-lg border border-rose-900 bg-rose-950/40 p-3 text-rose-300">{error}</p>}<section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"><div className="flex items-center justify-between border-b border-slate-800 p-4"><h2 className="font-medium">Users ({result.total})</h2>{loading && <span className="text-sm text-slate-400">Loading…</span>}</div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-950/60 text-slate-400"><tr><th className="p-4">Email</th><th className="p-4">Role</th><th className="p-4">Created</th><th className="p-4">Status</th><th className="p-4">Actions</th></tr></thead><tbody>{result.users.map((item) => <tr key={item.id} className="border-t border-slate-800"><td className="p-4">{item.email}</td><td className="p-4 uppercase">{item.role}</td><td className="p-4 text-slate-400">{new Date(item.createdAt).toLocaleDateString()}</td><td className="p-4"><span className={item.isActive ? 'text-emerald-300' : 'text-rose-300'}>{item.isActive ? 'Active' : 'Blocked'}</span></td><td className="flex gap-2 p-4"><button onClick={() => void changeStatus(item.id)} className="flex items-center gap-1 rounded bg-slate-800 px-3 py-2 text-xs">{item.isActive ? <UserRoundX size={14} /> : <UserRoundCheck size={14} />}{item.isActive ? 'Block' : 'Unblock'}</button><button disabled={item.id === user.id} onClick={() => void deleteUser(item.id)} className="flex items-center gap-1 rounded bg-rose-950 px-3 py-2 text-xs text-rose-200 disabled:opacity-40"><Trash2 size={14} />Delete</button></td></tr>)}</tbody></table></div>{!result.users.length && !loading && <p className="p-8 text-center text-slate-400">No users found.</p>}<div className="flex items-center justify-between border-t border-slate-800 p-4 text-sm text-slate-400"><span>Page {result.page} of {lastPage}</span><div className="flex gap-2"><button disabled={result.page <= 1} onClick={() => void loadUsers(result.page - 1)} className="rounded bg-slate-800 px-3 py-2 disabled:opacity-40">Previous</button><button disabled={result.page >= lastPage} onClick={() => void loadUsers(result.page + 1)} className="rounded bg-slate-800 px-3 py-2 disabled:opacity-40">Next</button></div></div></section></div></main>;
}
