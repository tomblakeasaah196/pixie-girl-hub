import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { UserPlus, CheckCircle2 } from "lucide-react";
import { acceptInvite } from "@/lib/api";
import { Spinner } from "@/components/ui";

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await acceptInvite(token, password);
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 1600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept invite");
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card max-w-sm text-center">
          <p className="text-fog-100">This invitation link is missing its token.</p>
          <Link to="/login" className="btn-ghost mt-4 inline-flex">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="card flex max-w-sm flex-col items-center gap-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-signal-green" />
          <p className="font-display text-lg">Account activated</p>
          <p className="text-sm text-fog-300">Redirecting you to sign in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold">
            Activate your Kaizen account
          </h1>
          <p className="mt-1 text-sm text-fog-300">Choose a password to finish.</p>
        </div>
        <div>
          <label className="label">Password</label>
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-fog-400">
            Min 8 characters, with an uppercase letter and a number.
          </p>
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && (
          <p className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          Activate account
        </button>
      </form>
    </div>
  );
}
