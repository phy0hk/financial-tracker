import { useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function goToDashboard() {
  window.history.pushState({}, '', '/dashboard');
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function AuthScreen() {
  const { login, register, loginAsGuest, isLoading } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await (isRegistering ? register(email, password, masterPassword) : login(email, password, masterPassword));
      goToDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to authenticate.');
    }
  }

  async function continueOffline() {
    setError('');
    try {
      await loginAsGuest();
      goToDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start local-only mode.');
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-100">
      <section className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/95 p-7 shadow-2xl shadow-cyan-950/20 sm:p-9">
        <div className="mb-8 flex items-center gap-3">
          <div className="rounded-2xl bg-cyan-400/10 p-3 text-cyan-300"><LockKeyhole size={24} /></div>
          <div><h1 className="text-2xl font-bold tracking-tight">ZeroTracker</h1><p className="text-sm text-slate-400">Private finances, encrypted by default.</p></div>
        </div>
        <button type="button" onClick={() => void continueOffline()} disabled={isLoading} className="mb-6 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-4 py-3.5 text-sm font-bold text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-60">
          <WifiOff size={18} />⚡ Continue Offline in Local-Only Mode (No Account Required)
        </button>
        <div className="mb-6 flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500"><span className="h-px flex-1 bg-slate-800" />or use an account<span className="h-px flex-1 bg-slate-800" /></div>
        <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-950 p-1">
          <button type="button" className={`rounded-lg px-3 py-2 text-sm font-medium ${!isRegistering ? 'bg-slate-700 text-white' : 'text-slate-400'}`} onClick={() => setIsRegistering(false)}>Sign in</button>
          <button type="button" className={`rounded-lg px-3 py-2 text-sm font-medium ${isRegistering ? 'bg-slate-700 text-white' : 'text-slate-400'}`} onClick={() => setIsRegistering(true)}>Create account</button>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <label className="block text-sm text-slate-300">Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none transition focus:border-cyan-400" /></label>
          <label className="block text-sm text-slate-300">Password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none transition focus:border-cyan-400" /></label>
          <label className="block text-sm text-slate-300">Master password<input required minLength={8} type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none transition focus:border-cyan-400" /><span className="mt-1.5 block text-xs text-slate-500">Used locally to derive your encryption key. It never leaves this device.</span></label>
          {error && <p role="alert" className="rounded-xl border border-rose-900 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
          <button disabled={isLoading} className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-4 py-3 font-bold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60">{isLoading ? <><LoaderCircle className="animate-spin" size={18} />Working…</> : <><KeyRound size={18} />{isRegistering ? 'Create encrypted account' : 'Unlock ZeroTracker'}</>}</button>
        </form>
      </section>
    </main>
  );
}
