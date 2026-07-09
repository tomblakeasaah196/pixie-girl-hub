import { useState } from "react";
import {
  ShieldCheck,
  Mail,
  X,
  Loader2,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import { sendActivationCode, confirmActivation } from "@/lib/auth-api";
import { useAuthStore } from "@/stores/auth";

/**
 * One-time email activation nudge. Shows a dismissable-free banner after
 * sign-in while the account is unverified; the account owner emails a
 * single-use code to their own address and enters it to verify. Once
 * verified the store flips and the banner (and this component) disappear.
 *
 * It's a nudge, not a gate — the app stays fully usable while unverified.
 */
export function EmailActivationBanner() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const markVerified = useAuthStore((s) => s.markEmailVerified);

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"intro" | "code">("intro");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [masked, setMasked] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (status !== "authed" || !user || user.emailVerified) return null;

  const openModal = () => {
    setOpen(true);
    setStep("intro");
    setError(null);
    setCode("");
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await sendActivationCode();
      if (res.already) {
        markVerified();
        setOpen(false);
        return;
      }
      setMasked(res.email_masked);
      setStep("code");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't send the code. Please try again.",
      );
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (verifying || code.length !== 6) return;
    setVerifying(true);
    setError(null);
    try {
      await confirmActivation(code);
      markVerified();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't verify the code. Please try again.",
      );
    } finally {
      setVerifying(false);
    }
  };

  return (
    <>
      <div className="mx-auto w-full max-w-[var(--content-max)] px-[34px] max-md:px-4 pt-3">
        <div className="flex items-center gap-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-2.5">
          <ShieldCheck className="w-4 h-4 text-warn shrink-0" />
          <p className="text-[12.5px] text-text-muted flex-1 min-w-0">
            <span className="font-semibold text-text-primary">
              Verify your email
            </span>{" "}
            to activate and secure your account.
          </p>
          <button
            onClick={openModal}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-accent-deep text-[#F4E9D9] text-[12px] font-semibold hover:bg-accent transition-colors"
          >
            Activate now
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4">
          <button
            aria-label="Close"
            className="absolute inset-0 bg-bg/70 backdrop-blur-xl animate-fade-in"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Verify your email"
            className="relative w-full max-w-[400px] dropglass rounded-[24px] p-7 shadow-glass animate-app-in"
          >
            <button
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10 transition-all"
            >
              <X className="w-4 h-4" />
            </button>

            <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20 mb-4">
              <Mail className="w-5 h-5" />
            </span>

            {step === "intro" ? (
              <>
                <h2 className="font-display text-[20px] leading-tight">
                  Verify your email
                </h2>
                <p className="text-text-muted text-[13px] mt-1.5">
                  We'll send a one-time 6-digit code to{" "}
                  <span className="text-text-primary font-medium">
                    {user.email}
                  </span>
                  . Enter it to activate your account.
                </p>

                {error && (
                  <div
                    role="alert"
                    className="mt-4 text-[12.5px] font-medium text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2"
                  >
                    {error}
                  </div>
                )}

                <button
                  onClick={send}
                  disabled={sending}
                  className="mt-5 w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all disabled:opacity-70 flex items-center justify-center gap-2"
                >
                  {sending ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Send code <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <h2 className="font-display text-[20px] leading-tight">
                  Enter your code
                </h2>
                <p className="text-text-muted text-[13px] mt-1.5">
                  We sent a 6-digit code to{" "}
                  <span className="text-text-primary font-medium">{masked}</span>
                  . It expires in 10 minutes.
                </p>

                {error && (
                  <div
                    role="alert"
                    className="mt-4 text-[12.5px] font-medium text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 flex items-center gap-1.5"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
                  </div>
                )}

                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => {
                    const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setCode(next);
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") verify();
                  }}
                  placeholder="000000"
                  className={cn(
                    "mt-4 w-full bg-text-primary/[0.04] border rounded-xl py-3.5 text-center text-3xl font-mono tracking-[0.4em] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/60 transition-all",
                    error ? "border-danger" : "border-line/60 focus:border-accent",
                  )}
                />

                <button
                  onClick={verify}
                  disabled={verifying || code.length !== 6}
                  className="mt-4 w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
                >
                  {verifying ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Verify & Activate"
                  )}
                </button>

                <div className="mt-4 text-center">
                  <button
                    type="button"
                    onClick={send}
                    disabled={sending}
                    className="text-[12.5px] font-semibold text-accent-glow hover:underline disabled:opacity-60"
                  >
                    {sending ? "Sending…" : "Resend code"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
