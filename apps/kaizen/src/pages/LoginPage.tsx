import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { login } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { Spinner } from "@/components/ui";

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { operator, access_token } = await login(email.trim(), password);
      setAuth(access_token, operator);
      navigate(operator.must_change_password ? "/change-password" : "/", {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-amber to-signal-red shadow-[0_0_28px_rgba(245,166,35,0.45)]" />
          <div>
            <h1 className="font-display text-2xl font-semibold">
              Kai<span className="text-amber">zen</span>
            </h1>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-fog-400">
              Ops Console
            </p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? <Spinner className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
            Sign in
          </button>

          <div className="text-center">
            <a
              href="/forgot-password"
              className="text-sm text-fog-300 hover:text-fog-200"
            >
              Forgot your password?
            </a>
          </div>
        </form>

        <p className="mt-6 text-center text-xs text-fog-400">
          JBS Praxis maintenance access only.
        </p>
      </div>
    </div>
  );
}
