import { ArrowLeft, Loader2, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AuthLayout, FormAlert, TextField } from '../components/auth/AuthLayout';
import { backend, useBackendStatus } from '../services/api';

export default function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [status] = useBackendStatus();
  const online = status.state === 'online';
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ message: string; delivery: 'email' | 'outbox' } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await backend.forgotPassword(email.trim(), `${window.location.origin}/reset-password`);
      setDone({ message: r.message, delivery: r.delivery });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your account email and we’ll send you a link to choose a new password.">
      <form onSubmit={submit} className="card mt-6 space-y-4 p-6" noValidate>
        {done ? (
          <>
            <FormAlert tone="success">{done.message}</FormAlert>
            {done.delivery === 'outbox' && (
              <FormAlert tone="info">
                Email delivery is not configured on this server, so the link was written to the development outbox: <code className="rounded bg-white/70 px-1">backend/storage/outbox.log</code>. Open that file and paste the link into your browser.
              </FormAlert>
            )}
            <button type="button" onClick={() => setDone(null)} className="h-9 w-full rounded-lg border border-line bg-surface text-[13px] font-medium hover:bg-subtle">
              Send another link
            </button>
          </>
        ) : (
          <>
            <TextField label="Email" type="email" value={email} onChange={setEmail} autoComplete="email" placeholder="you@company.com" disabled={status.state !== 'checking' && !online} />
            {error && <FormAlert tone="error">{error}</FormAlert>}
            <button type="submit" disabled={!online || busy || !email.includes('@')} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink text-[14px] font-semibold text-white hover:bg-[#13304d] disabled:opacity-50">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              Send reset link
            </button>
            {!online && status.state !== 'checking' && <p className="text-[12px] text-muted">The authentication service (backend) is not reachable.</p>}
          </>
        )}
      </form>
      <Link to="/login" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-energy hover:underline">
        <ArrowLeft size={14} /> Back to sign in
      </Link>
    </AuthLayout>
  );
}
