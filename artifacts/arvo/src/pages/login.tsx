import { useState, type FormEvent } from 'react';
import { Command } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Login failed. Check your credentials.');
        return;
      }
      onSuccess();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#1b242e] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-[#394757] bg-[#273544] p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#f0ca63] text-[#263342]">
            <Command size={19} strokeWidth={2.4} />
          </span>
          <span className="font-[Manrope] text-[20px] font-extrabold tracking-[-0.06em] text-[#fffaf0]">
            arvo<span className="text-[#f0ca63]">.</span>
          </span>
        </div>
        <h1 className="mb-1 text-lg font-semibold text-[#fffaf0]">Admin sign in</h1>
        <p className="mb-6 text-sm text-[#9ba7b3]">
          This dashboard is restricted. Sign in to continue.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-[#b5bec7]">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border-[#394757] bg-[#1f2a36] text-[#fffaf0]"
              data-testid="input-login-email"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-[#b5bec7]">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-[#394757] bg-[#1f2a36] text-[#fffaf0]"
              data-testid="input-login-password"
            />
          </div>
          {error ? (
            <p className="text-sm text-[#d48378]" data-testid="text-login-error">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            disabled={submitting}
            className="w-full"
            data-testid="button-login-submit"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
