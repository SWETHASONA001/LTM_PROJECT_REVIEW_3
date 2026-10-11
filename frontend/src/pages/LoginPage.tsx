import { Eye, EyeOff, Loader2, LogIn, ShieldCheck, Wind, Waves, Fuel } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { LogoMark } from '../components/shell/Logo';
import { backend, useBackendStatus } from '../services/api';
import { sessionValid, useAuthStore } from '../store/authStore';

export default function LoginPage() {
  const session = useAuthStore((s) => s.session);
  const signIn = useAuthStore((s) => s.signIn);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/';
  const [status] = useBackendStatus();
  const authAvailable = status.state === 'online' && !!status.health.capabilities.auth;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localName, setLocalName] = useState('');

  if (sessionValid(session)) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await backend.login(email.trim(), password);
      signIn({ user: r.user, mode: 'backend', token: r.token, expiresAt: r.expires_at, signedInAt: new Date().toISOString() });
      nav(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const continueLocal = () => {
    const name = localName.trim() || 'Local engineer';
    signIn({ user: { name, email: 'local workspace', role: 'local' }, mode: 'local', signedInAt: new Date().toISOString() });
    nav(next, { replace: true });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-gradient-to-br from-[#0b1f33] via-[#0f3350] to-[#0f5a52] p-12 text-white lg:flex lg:flex-col">
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-90" viewBox="0 0 800 900" preserveAspectRatio="xMidYMax slice" aria-hidden>
          <path d="M0 760 C 160 700 300 740 420 700 S 680 640 800 680 L800 900 L0 900 Z" fill="#14476b" opacity="0.55" />
          <path d="M0 820 C 180 780 340 820 500 790 S 700 760 800 780 L800 900 L0 900 Z" fill="#0f8a6a" opacity="0.35" />
          {[
            [560, 600, 1],
            [690, 650, 0.8],
            [470, 690, 0.65],
            [760, 620, 0.9],
          ].map(([x, y, s], i) => (
            <g key={i} opacity={0.35 + s * 0.45}>
              <line x1={x} y1={y} x2={x} y2={y + 300 * s} stroke="#e6f0f7" strokeWidth={4 * s} />
              <g transform={`translate(${x} ${y})`}>
                <g className="animate-[spin_10s_linear_infinite] motion-reduce:animate-none" style={{ transformBox: 'fill-box', transformOrigin: 'center', animationDuration: `${8 + i * 2}s` }}>
                  {[0, 120, 240].map((a) => (
                    <path key={a} d={`M0 0 L${5 * s} ${-70 * s} L0 ${-78 * s} Z`} fill="#e6f0f7" transform={`rotate(${a})`} />
                  ))}
                </g>
                <circle r={5 * s} fill="#fff" />
              </g>
            </g>
          ))}
        </svg>
        <div className="relative flex items-center gap-3">
          <LogoMark size={40} />
          <div>
            <div className="text-[19px] font-semibold tracking-tight">AeroHydro-PINN</div>
            <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/60">Physics-AI · Wind · Hydro · H₂</div>
          </div>
        </div>
        <div className="relative mt-20 max-w-md">
          <h1 className="text-[34px] font-semibold leading-tight tracking-tight">Wake-aware renewable intelligence for engineering teams.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/75">Digital twins, turbine siting, physics-informed models and green-hydrogen planning — every number labeled by where it came from.</p>
          <ul className="mt-8 space-y-3 text-[14px] text-white/85">
            {[
              [<Wind key="w" size={16} />, 'Onshore & offshore digital twins with FLORIS-validated wakes'],
              [<Waves key="h" size={16} />, 'Tidal-current resource and hydrokinetic modeling'],
              [<Fuel key="f" size={16} />, 'Hydrogen dispatch on a measured electrolyzer curve'],
            ].map(([icon, text], i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-[#7dd3b0]">{icon}</span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark size={36} />
            <span className="text-[18px] font-semibold">AeroHydro-PINN</span>
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-[14px] text-muted">Use your AeroHydro platform account.</p>

          <form onSubmit={submit} className="card mt-6 space-y-4 p-6" noValidate>
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Email
              </label>
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} disabled={!authAvailable} placeholder="you@company.com" className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-energy disabled:bg-subtle" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-2">
                Password
              </label>
              <div className="flex items-center rounded-lg border border-line bg-surface focus-within:border-energy">
                <input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} disabled={!authAvailable} className="h-10 w-full rounded-lg bg-transparent px-3 text-[14px] outline-none disabled:bg-subtle" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="px-3 text-muted hover:text-ink">
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && (
              <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
                {error}
              </div>
            )}
            <button type="submit" disabled={!authAvailable || busy || !email || !password} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink text-[14px] font-semibold text-white hover:bg-[#13304d] disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              Sign in
            </button>
            <div className="flex items-start gap-2 text-[12px] text-muted">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-energy" />
              {authAvailable
                ? 'Passwords are verified by the AeroHydro backend; sessions expire after 12 hours.'
                : status.state === 'checking'
                  ? 'Checking the authentication service…'
                  : status.state === 'online'
                    ? 'The backend has no user accounts yet (create one with backend/create_user.py).'
                    : 'The authentication service (backend) is not reachable.'}
            </div>
          </form>

          {!authAvailable && status.state !== 'checking' && (
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
          <p className="mt-8 text-center text-[11.5px] text-faint">AeroHydro-PINN · decision support only — no turbine control is executed from this platform.</p>
        </div>
      </section>
    </div>
  );
}
