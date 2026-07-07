import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { changePassword } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { Spinner } from "@/components/ui";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const setOperator = useAuth((s) => s.setOperator);
  const operator = useAuth((s) => s.operator);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      // The current session stays valid; just clear the must-change flag so the
      // guard lets us through.
      if (operator) setOperator({ ...operator, must_change_password: false });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold">
            Set a new password
          </h1>
          <p className="mt-1 text-sm text-fog-300">
            {operator?.must_change_password
              ? "Your account uses a temporary password. Choose your own to continue."
              : "Update your password."}
          </p>
        </div>
        <div>
          <label className="label">Current password</label>
          <input
            type="password"
            autoComplete="current-password"
            className="input"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">New password</label>
          <input
            type="password"
            autoComplete="new-password"
            className="input"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-fog-400">
            Min 8 characters, with an uppercase letter and a number.
          </p>
        </div>
        <div>
          <label className="label">Confirm new password</label>
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
          {busy ? <Spinner className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
          Update password
        </button>
      </form>
    </div>
  );
}
