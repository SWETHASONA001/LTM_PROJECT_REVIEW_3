import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AuthLayout, FormAlert, PasswordField, PasswordStrength } from '../components/auth/AuthLayout';
import { backend } from '../services/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError('Password must be at least 10 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const r = await backend.resetPassword(token, password);
      nav(`/login?notice=reset&email=${encodeURIComponent(r.user.email)}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Choose a new password" subtitle="Reset links are single-use and expire 30 minutes after they are sent.">
      {!token ? (
        <div className="mt-6 space-y-4">
          <FormAlert tone="error">This page needs the link from your reset email. Request a new link to continue.</FormAlert>
          <Link to="/forgot-password" className="inline-flex h-10 items-center rounded-lg bg-ink px-4 text-[14px] font-semibold text-white">
            Request a reset link
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="card mt-6 space-y-4 p-6" noValidate>
          <div>
            <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
            <PasswordStrength password={password} />
          </div>
          <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
          {error && (
            <FormAlert tone="error">
              {error}{' '}
              {error.includes('expired') && (
                <Link to="/forgot-password" className="font-semibold underline">
                  Request a new link
                </Link>
              )}
            </FormAlert>
          )}
          <button type="submit" disabled={busy || !password || !confirm} className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-ink text-[14px] font-semibold text-white hover:bg-[#13304d] disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            Update password
          </button>
        </form>
      )}
      <Link to="/login" className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-energy hover:underline">
        <ArrowLeft size={14} /> Back to sign in
      </Link>
    </AuthLayout>
  );
}
