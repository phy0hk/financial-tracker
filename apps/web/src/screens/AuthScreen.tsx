import { useState, type FormEvent } from 'react';
import { KeyRound, LoaderCircle, LockKeyhole, WifiOff } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

function goToDashboard() { window.history.pushState({}, '', '/dashboard'); window.dispatchEvent(new PopStateEvent('popstate')); }

export function AuthScreen() {
  const { login, register, loginAsGuest, isLoading } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try { await (isRegistering ? register(email, password, masterPassword) : login(email, password, masterPassword)); goToDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to authenticate.'); }
  }
  async function continueOffline() {
    setError('');
    try { await loginAsGuest(); goToDashboard(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start local-only mode.'); }
  }
  return <main className="hero min-h-screen bg-base-300 px-4 py-10"><section className="card w-full max-w-md bg-base-100 shadow-2xl"><div className="card-body p-7 sm:p-9">
    <div className="mb-6 flex items-center gap-3"><div className="rounded-2xl bg-primary/15 p-3 text-primary"><LockKeyhole size={24} /></div><div><h1 className="card-title text-2xl">ZeroTracker</h1><p className="text-sm text-base-content/60">Private finances, encrypted by default.</p></div></div>
    <div className="mb-5 flex items-center gap-2"><span className="badge badge-success badge-sm">E2EE</span><span className="badge badge-outline badge-sm">Local-first</span></div>
    <button type="button" onClick={() => void continueOffline()} disabled={isLoading} className="btn btn-accent mb-5 w-full"><WifiOff size={18} />⚡ Continue Offline in Local-Only Mode</button>
    <div className="divider my-2 text-xs uppercase tracking-widest text-base-content/50">or use an account</div>
    <div className="join mb-5 grid grid-cols-2"><button type="button" className={`btn join-item ${!isRegistering ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setIsRegistering(false)}>Sign in</button><button type="button" className={`btn join-item ${isRegistering ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setIsRegistering(true)}>Create account</button></div>
    <form className="space-y-4" onSubmit={submit}><label className="form-control w-full"><span className="label-text">Email</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="input input-bordered w-full" /></label><label className="form-control w-full"><span className="label-text">Password</span><input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="input input-bordered w-full" /></label><label className="form-control w-full"><span className="label-text">Master password</span><input required minLength={8} type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} className="input input-bordered w-full" /><span className="label-text-alt mt-1 text-base-content/50">Used only on this device to derive your encryption key.</span></label>{error && <div role="alert" className="alert alert-error text-sm">{error}</div>}<button disabled={isLoading} className="btn btn-primary w-full">{isLoading ? <><LoaderCircle className="animate-spin" size={18} />Working…</> : <><KeyRound size={18} />{isRegistering ? 'Create encrypted account' : 'Unlock ZeroTracker'}</>}</button></form>
  </div></section></main>;
}
