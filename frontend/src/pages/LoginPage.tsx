import clsx from 'clsx';
import { Loader2, LogIn, ShieldCheck, UserPlus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout, FormAlert, PasswordField, PasswordStrength, TextField } from '../components/auth/AuthLayout';
import { backend, useBackendStatus } from '../services/api';
import { sessionValid, useAuthStore } from '../store/authStore';

type Mode = 'signin' | 'signup';

export default function LoginPage() {
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signIn);
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const next = params.get('next') || '/';
  const mode: Mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const [status] = useBackendStatus();
  const online = status.state === 'online';
  const authAvailable = online && !!status.health.capabilities.auth;
  const signupAvailable = online && !!status.health.capabilities.signup;
  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localName, setLocalName] = useState('');
  const notice = params.get('notice');

  if (sessionValid(session)) return <Navigate to={next} replace />;

  const setMode = (m: Mode) => {
    setError(null);
    const p = new URLSearchParams(params);
    if (m === 'signup') p.set('mode', 'signup');
    else p.delete('mode');
    p.delete('notice');
    setParams(p, { replace: true });
  };

  const finish = (r: { token: string; expires_at: number; user: { email: string; name: string; role: string } }) => {
    signIn({ user: r.user, mode: 'backend', token: r.token, expiresAt: r.expires_at, signedInAt: new Date().toISOString() });
    nav(next, { replace: true });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'signup') {
      if (password.length < 10) return setError('Password must be at least 10 characters.');
      if (password !== confirm) return setError('Passwords do not match.');
    }
    setBusy(true);
    try {
      finish(mode === 'signup' ? await backend.register(name.trim(), email.trim(), password) : await backend.login(email.trim(), password));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const continueLocal = () => {
    signIn({ user: { name: localName.trim() || 'Local engineer', email: 'local workspace', role: 'local' }, mode: 'local', signedInAt: new Date().toISOString() });
    nav(next, { replace: true });
  };

  // Inputs stay editable while the backend check is running; only submission waits for it.
  const unavailable = mode === 'signup' ? !signupAvailable : !authAvailable;
  const disabled = status.state !== 'checking' && unavailable;

  return (
    <AuthLayout title={mode === 'signup' ? 'Create your account' : 'Sign in'} subtitle={mode === 'signup' ? 'Join your team’s AeroHydro workspace.' : 'Use your AeroHydro platform account.'}>
      <div className="mt-6 inline-flex w-full rounded-lg border border-line bg-subtle p-0.5" role="tablist" aria-label="Account">
        {(['signin', 'signup'] as Mode[]).map((m) => (
          <button key={m} role="tab" type="button" aria-selected={mode === m} onClick={() => setMode(m)} className={clsx('h-9 flex-1 rounded-md text-[13.5px] font-medium', mode === m ? 'bg-surface text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink')}>
            {m === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="card mt-4 space-y-4 p-6" noValidate>
        {notice === 'reset' && <FormAlert tone="success">Your password was changed. Sign in with the new password.</FormAlert>}
        {mode === 'signup' && <TextField label="Full name" value={name} onChange={setName} autoComplete="name" disabled={disabled} placeholder="Ada Lovelace" />}
        <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete={mode === 'signup' ? 'email' : 'username'} disabled={disabled} placeholder="you@company.com" />
        <div>
          <PasswordField label="Password" value={password} onChange={setPassword} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} disabled={disabled} />
          {mode === 'signup' && <PasswordStrength password={password} />}
          {mode === 'signin' && (
            <div className="mt-1.5 text-right">
              <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-[12.5px] font-medium text-energy hover:underline">
                Forgot password?
              </Link>
            </div>
          )}
        </div>
        {mode === 'signup' && <PasswordField label="Confirm password" value={confirm} onChange={setConfirm} autoComplete="new-password" disabled={disabled} />}
        {error && <FormAlert tone="error">{error}</FormAlert>}
        <button
          type="submit"
          disabled={unavailable || busy || !email || !password || (mode === 'signup' && (!name || !confirm))}
          className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink text-[14px] font-semibold text-white hover:bg-[#13304d] disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : mode === 'signup' ? <UserPlus size={16} /> : <LogIn size={16} />}
          {mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
        <div className="flex items-start gap-2 text-[12px] text-muted">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-energy" />
          {status.state === 'checking'
            ? 'Checking the authentication service…'
            : !online
              ? 'The authentication service (backend) is not reachable.'
              : mode === 'signup'
                ? signupAvailable
                  ? 'Passwords are stored only as salted hashes on the AeroHydro backend.'
                  : 'Self-registration is disabled on this server. Ask an administrator for an account.'
                : 'Passwords are verified by the AeroHydro backend; sessions expire after 12 hours.'}
        </div>
      </form>

      {!online && status.state !== 'checking' && (
        <div className="mt-5 rounded-xl border border-dashed border-line-strong bg-white/70 p-5">
          <div className="text-[14px] font-semibold">Continue without an account</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted">Opens a local workspace in this browser. No password is checked and nothing is shared — use it only on your own machine.</p>
          <div className="mt-3 flex gap-2">
            <input aria-label="Your name" value={localName} onChange={(e) => setLocalName(e.target.value)} placeholder="Your name (optional)" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-[13px] outline-none focus:border-energy" />
            <button type="button" onClick={continueLocal} className="h-9 shrink-0 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium hover:bg-subtle">
              Open local workspace
            </button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
