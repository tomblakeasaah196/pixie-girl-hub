import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { resetPassword } from "@/lib/auth-api";
import {
  checkPassword,
  PASSWORD_RULE_TEXT,
  passwordScore,
} from "@/lib/password";
import { useBranding } from "@/lib/branding";
import { Particles } from "@/components/login/Particles";

/**
 * Dedicated page behind the emailed reset link (/reset-password?token=…).
 * Matches the backend: single-use token in the URL → set a new password →
 * all sessions revoked. Enforces the full password policy client-side.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const { data } = useBranding();
  const productName = data?.platform?.product_name ?? "Pixie Hub";

  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const check = checkPassword(pw);
  const score = passwordScore(pw);
  const match = pw.length > 0 && pw === confirm;
  const canSubmit = !!token && check.ok && match && !loading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await resetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message || "This reset link is invalid or has expired."
          : "Network error — please try again.",
      );
      setLoading(false);
    }
  };

  const bars = ["bg-danger", "bg-danger", "bg-warn", "bg-warn", "bg-success"];
  const labels = ["Too weak", "Weak", "Fair", "Good", "Strong"];

  return (
    <div className="auth-scroll fixed inset-0 grid place-items-center p-4">
      <div className="fixed inset-0 pointer-events-none">
        <Particles count={28} />
      </div>
      <div className="relative w-full max-w-[420px] dropglass rounded-[24px] p-8 sm:p-9 shadow-glass animate-app-in">
        <div className="micro mb-2">{productName}</div>

        {done ? (
          <div className="text-center py-3">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full grid place-items-center bg-success/15 text-success">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h1 className="font-display text-[24px]">Password updated</h1>
            <p className="text-text-muted text-[13px] mt-2">
              For your security, every other session has been signed out. Sign
              in with your new password.
            </p>
            <button
              onClick={() => navigate("/login", { replace: true })}
              className="mt-6 w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
            >
              Sign In
            </button>
          </div>
        ) : !token ? (
          <div className="text-center py-3">
            <h1 className="font-display text-[24px]">Invalid link</h1>
            <p className="text-text-muted text-[13px] mt-2">
              This reset link is missing its token. Request a new one from the
              sign-in screen.
            </p>
            <Link
              to="/login"
              className="mt-6 inline-flex w-full h-12 items-center justify-center rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
            >
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="font-display text-[26px] leading-tight">
              Set a new password
            </h1>
            <p className="text-text-muted text-[13px] mt-1 mb-6">
              {PASSWORD_RULE_TEXT}
            </p>

            {error && (
              <div
                role="alert"
                className="mb-4 text-[12.5px] font-medium text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            <label className="block mb-3">
              <span className="micro mb-1.5 block">New password</span>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-text-primary/[0.04] border border-line/60 rounded-xl py-3 pl-11 pr-11 text-sm font-medium text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all placeholder:text-text-faint"
                />
                <button
                  type="button"
                  onClick={() => setShow((s) => !s)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-text-faint hover:text-text-primary"
                >
                  {show ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </label>

            {pw.length > 0 && (
              <div className="mb-3">
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <span
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors",
                        i < score
                          ? bars[Math.max(0, score - 1)]
                          : "bg-text-primary/10",
                      )}
                    />
                  ))}
                </div>
                <div className="text-[11px] text-text-faint mt-1.5">
                  {check.ok
                    ? labels[4]
                    : check.error ?? labels[Math.max(0, score - 1)]}
                </div>
              </div>
            )}

            <label className="block mb-5">
              <span className="micro mb-1.5 block">Confirm password</span>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  type={show ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-text-primary/[0.04] border border-line/60 rounded-xl py-3 pl-11 pr-4 text-sm font-medium text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all placeholder:text-text-faint"
                />
              </div>
              {confirm.length > 0 && !match && (
                <p className="text-[11px] text-danger mt-1.5">
                  Passwords don't match.
                </p>
              )}
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="group relative w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase overflow-hidden hover:bg-accent transition-all disabled:opacity-50"
            >
              <span
                className={cn(
                  "inline-flex items-center gap-2",
                  loading && "invisible",
                )}
              >
                Update password <ArrowRight className="w-4 h-4" />
              </span>
              {loading && (
                <Loader2 className="absolute inset-0 m-auto w-5 h-5 animate-spin" />
              )}
              <span className="cta-sheen" />
            </button>

            <div className="text-center mt-5">
              <Link
                to="/login"
                className="text-[12.5px] font-semibold text-text-muted hover:text-text-primary"
              >
                Back to sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
