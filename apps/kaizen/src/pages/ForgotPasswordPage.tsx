import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, Mail, CheckCircle } from "lucide-react";
import { Spinner } from "@/components/ui";

type Step = "email" | "otp" | "password";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestReset(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/kaizen/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.user_message || "Failed to send OTP");
      }
      setStep("otp");
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/v1/kaizen/auth/verify-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.user_message || "Invalid code");
      }
      setStep("password");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/v1/kaizen/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), new_password: password }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.user_message || "Failed to reset password");
      }
      const result = await res.json();
      localStorage.setItem("kaizen_access_token", result.access_token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (step === "otp") {
      setStep("email");
      setError(null);
    } else if (step === "password") {
      setStep("otp");
      setError(null);
    } else {
      navigate("/login", { replace: true });
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
          <form onSubmit={requestReset} className="card space-y-4">
            <div className="text-center">
              <h2 className="font-display text-lg font-semibold">Reset your password</h2>
              <p className="mt-1 text-sm text-fog-300">
                Enter your email to receive a reset code.
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
              Send Code
            </button>

            <button
              type="button"
              onClick={() => navigate("/login", { replace: true })}
              className="w-full text-sm text-fog-300 hover:text-fog-200"
            >
              Back to login
            </button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={verifyCode} className="card space-y-4">
            <div className="text-center">
              <h2 className="font-display text-lg font-semibold">Enter your code</h2>
              <p className="mt-1 text-sm text-fog-300">
                We sent a 6-digit code to {email}
              </p>
            </div>

            <div>
              <label className="label" htmlFor="code">
                Verification Code
              </label>
              <input
                id="code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                className="input text-center text-lg tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                required
              />
              <p className="mt-1 text-xs text-fog-400">
                Code expires in 15 minutes.
              </p>
            </div>

            {error && (
              <p className="rounded-lg border border-signal-red/30 bg-signal-red/10 px-3 py-2 text-sm text-signal-red">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Spinner className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
              Verify Code
            </button>

            <button
              type="button"
              onClick={goBack}
              className="w-full text-sm text-fog-300 hover:text-fog-200"
            >
              Back
            </button>
          </form>
        )}

        {step === "password" && (
          <form onSubmit={resetPassword} className="card space-y-4">
            <div className="text-center">
              <h2 className="font-display text-lg font-semibold">Set a new password</h2>
              <p className="mt-1 text-sm text-fog-300">
                Create a strong password for your account.
              </p>
            </div>

            <div>
              <label className="label">New password</label>
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
              Reset Password
            </button>

            <button
              type="button"
              onClick={goBack}
              className="w-full text-sm text-fog-300 hover:text-fog-200"
            >
              Back
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-fog-400">
          JBS Praxis maintenance access only.
        </p>
      </div>
    </div>
  );
}
