import { Eye, EyeOff, Fuel, Waves, Wind } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { LogoMark } from '../shell/Logo';

/** Two-column layout shared by sign-in, sign-up and password-reset pages. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
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
      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark size={36} />
            <span className="text-[18px] font-semibold">AeroHydro-PINN</span>
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-[14px] text-muted">{subtitle}</p>
          {children}
          <p className="mt-8 text-center text-[11.5px] text-faint">AeroHydro-PINN · decision support only — no turbine control is executed from this platform.</p>
        </div>
      </section>
    </div>
  );
}

export function TextField({ label, type = 'text', value, onChange, autoComplete, placeholder, disabled, hint }: { label: string; type?: string; value: string; onChange: (v: string) => void; autoComplete?: string; placeholder?: string; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <input id={id} type={type} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} placeholder={placeholder} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[14px] outline-none focus:border-energy disabled:bg-subtle" />
      {hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

export function PasswordField({ label, value, onChange, autoComplete, disabled, hint }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; disabled?: boolean; hint?: ReactNode }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-ink-2">
        {label}
      </label>
      <div className="flex items-center rounded-lg border border-line bg-surface focus-within:border-energy">
        <input id={id} type={show ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-10 w-full rounded-lg bg-transparent px-3 text-[14px] outline-none disabled:bg-subtle" />
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} className="px-3 text-muted hover:text-ink">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}

/** Simple strength meter: length and character variety. */
export function PasswordStrength({ password }: { password: string }) {
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  const score = password.length < 10 ? 0 : Math.min(3, (password.length >= 14 ? 1 : 0) + Math.max(0, variety - 1));
  const labels = ['Too short (min. 10 characters)', 'Fair', 'Good', 'Strong'];
  const colors = ['#b42318', '#a15c07', '#0f8a6a', '#047857'];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1 flex-1 rounded" style={{ background: password && score > i ? colors[score] : '#e3e1da' }} />
        ))}
      </div>
      {password && <div className="mt-1 text-[11.5px]" style={{ color: colors[score] }}>{labels[score]}</div>}
    </div>
  );
}

export function FormAlert({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const cls = tone === 'error' ? 'bg-danger-soft text-danger' : tone === 'success' ? 'bg-energy-soft text-[#0b5a45]' : 'bg-wind-soft text-ink-2';
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed ${cls}`}>
      {children}
    </div>
  );
}
