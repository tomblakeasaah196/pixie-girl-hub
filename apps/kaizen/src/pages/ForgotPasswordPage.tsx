import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, KeyRound, Mail, ShieldCheck } from "lucide-react";
import {
  requestPasswordReset,
  resetPasswordWithCode,
  verifyResetCode,
} from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { Spinner } from "@/components/ui";

type Step = "email" | "code" | "password";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function message(err: unknown, fallback: string) {
    return err instanceof Error ? err.message : fallback;
  }

  async function onRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setCode("");
      setStep("code");
    } catch (err) {
      setError(message(err, "Could not send the code"));
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyResetCode(email.trim(), code.trim());
      setNext("");
      setConfirm("");
      setStep("password");
    } catch (err) {
      setError(message(err, "That code is invalid or has expired"));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError("New passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const { operator, access_token } = await resetPasswordWithCode(
        email.trim(),
        code.trim(),
        next,
      );
      setAuth(access_token, operator);
      navigate("/", { replace: true });
    } catch (err) {
      setError(message(err, "Could not reset your password"));
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

        {step === "email" && (
          <form onSubmit={onRequest} className="card space-y-4">
            <div className="text-center">
              <h2 className="font-display text-xl font-semibold">
                Reset your password
              </h2>
              <p className="mt-1 text-sm text-fog-300">
                We'll email you a 6-digit code.
              </p>
            </div>

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

            {error && (
              <p className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
              Send code
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={onVerify} className="card space-y-4">
            <div className="text-center">
              <h2 className="font-display text-xl font-semibold">Enter your code</h2>
              <p className="mt-1 text-sm text-fog-300">
                If <span className="text-fog-200">{email.trim()}</span> belongs to
                an operator, a 6-digit code is on its way.
              </p>
            </div>

            <div>
              <label className="label" htmlFor="code">
                Reset code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                className="input text-center font-mono text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
              <p className="mt-1 text-xs text-fog-400">
                Expires in 15 minutes. Three incorrect tries and you'll need a new
                code.
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={busy || code.length !== 6}
            >
              {busy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              Verify code
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("email");
                setError(null);
              }}
              className="w-full text-sm text-fog-400 hover:text-fog-200"
            >
              Use a different email
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={onReset} className="card space-y-4">
            <div className="text-center">
              <h2 className="font-display text-xl font-semibold">
                Set a new password
              </h2>
              <p className="mt-1 text-sm text-fog-300">
                This signs out every other Kaizen session.
              </p>
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
              {busy ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <KeyRound className="h-4 w-4" />
              )}
              Reset password
            </button>
          </form>
        )}

        <p className="mt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-fog-400 hover:text-fog-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
