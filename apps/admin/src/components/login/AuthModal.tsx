import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Hash,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError } from "@/lib/api";
import {
  forgotPassword,
  isPinEnabledLocally,
  loginWithPassword,
  loginWithPin,
  type AuthUser,
} from "@/lib/auth-api";
import { useAuthStore } from "@/stores/auth";
import { useBusinessStore } from "@/stores/business";
import type { LoginToggles } from "@/lib/branding";

type Tab = "password" | "pin";
type View = "signin" | "forgot";

const LAST_EMAIL_KEY = "pgh-last-email";
const REMEMBERED_KEY = "pgh-remembered-account";

/** Device-local remembered account that powers the quick-PIN screen. It
 *  only describes THIS browser (email + display name for the greeting) —
 *  never a credential. */
type RememberedAccount = { email: string; display_name: string };

function getRemembered(): RememberedAccount | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(REMEMBERED_KEY);
    const acct = raw ? (JSON.parse(raw) as RememberedAccount) : null;
    return acct?.email ? acct : null;
  } catch {
    return null;
  }
}

/**
 * The glass sign-in modal. Two ways in — password and a 6-digit quick PIN —
 * plus the forgot-password request. On success it seeds the session, picks
 * the brand context, and routes to /select-entity (multi-brand) or home.
 */
export function AuthModal({
  open,
  onClose,
  toggles,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  toggles: LoginToggles;
  productName: string;
}) {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const loadPermissions = useAuthStore((s) => s.loadPermissions);
  const setActiveBusiness = useBusinessStore((s) => s.setActive);

  const pinEnabled = toggles.pin_login !== false;
  const [tab, setTab] = useState<Tab>("password");
  const [view, setView] = useState<View>("signin");

  const lastEmail =
    typeof localStorage !== "undefined"
      ? localStorage.getItem(LAST_EMAIL_KEY) ?? ""
      : "";
  const [remembered, setRemembered] = useState<RememberedAccount | null>(
    getRemembered,
  );
  const [email, setEmail] = useState(lastEmail);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgotDone, setForgotDone] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // Reset transient state whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setView("signin");
    setError(null);
    setForgotDone(false);
    setPassword("");
    setPin("");
    // Default to the PIN pad only when a PIN was actually set up on this
    // device for the remembered account; otherwise start on password.
    setTab(pinEnabled && remembered && isPinEnabledLocally() ? "pin" : "password");
    const t = setTimeout(() => emailRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Esc closes; lock background scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const shake = () => {
    cardRef.current?.classList.remove("animate-shake");
    void cardRef.current?.offsetWidth;
    cardRef.current?.classList.add("animate-shake");
  };

  const finish = (user: AuthUser) => {
    setSession(user);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LAST_EMAIL_KEY, user.email);
      // Remember this device's account so the quick-PIN screen can greet
      // them and sign in without re-typing the email.
      localStorage.setItem(
        REMEMBERED_KEY,
        JSON.stringify({ email: user.email, display_name: user.display_name }),
      );
      // "Keep me signed in" off → drop the persisted profile so a reload
      // requires a fresh sign-in (the refresh cookie alone won't revive it).
      if (!remember) localStorage.removeItem("pgh-auth");
    }
    const multi = user.is_ceo || (user.available_businesses?.length ?? 0) > 1;
    if (!multi) {
      const key =
        user.default_business_key || user.available_businesses?.[0] || null;
      if (key) setActiveBusiness(key);
      // Brand context is now set in localStorage — safe to fetch permissions.
      loadPermissions().catch(() => {});
      navigate("/", { replace: true });
    } else {
      navigate("/select-entity", { replace: true });
    }
  };

  const messageFor = (e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 423) return "Account locked. Contact an administrator.";
      if (e.status === 401) return e.message || "Invalid credentials.";
      return e.message || fallback;
    }
    return "Network error — please try again.";
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      finish(await loginWithPassword(email.trim().toLowerCase(), password));
    } catch (err) {
      setError(messageFor(err, "Could not sign in."));
      shake();
      setLoading(false);
    }
  };

  const submitPin = async (value: string) => {
    if (loading) return;
    const acctEmail = remembered?.email;
    if (!acctEmail) return;
    setError(null);
    setLoading(true);
    try {
      finish(await loginWithPin(acctEmail, value));
    } catch (err) {
      setError(messageFor(err, "Invalid PIN."));
      setPin("");
      shake();
      setLoading(false);
    }
  };

  // "Not you?" — forget this device's account and fall back to the full
  // email + password form.
  const useDifferentAccount = () => {
    if (typeof localStorage !== "undefined")
      localStorage.removeItem(REMEMBERED_KEY);
    setRemembered(null);
    setEmail("");
    setPin("");
    setError(null);
    setTab("password");
    setTimeout(() => emailRef.current?.focus(), 60);
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await forgotPassword(email.trim().toLowerCase());
      setForgotDone(true);
    } catch {
      // Even on failure we show the neutral confirmation (no enumeration).
      setForgotDone(true);
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-text-primary/[0.04] border border-line/60 rounded-xl py-3 pl-11 pr-4 text-sm font-medium text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all placeholder:text-text-faint";

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/70 backdrop-blur-xl animate-fade-in"
        onClick={onClose}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        className="relative w-full max-w-[420px] dropglass rounded-[24px] p-7 sm:p-9 shadow-glass animate-app-in"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10 transition-all"
        >
          <X className="w-4 h-4" />
        </button>

        {view === "signin" ? (
          <>
            <div className="mb-6">
              <div className="micro mb-2">{productName}</div>
              <h2 className="font-display text-[26px] leading-tight">
                {tab === "pin" && remembered?.display_name
                  ? `Welcome back, ${remembered.display_name.split(" ")[0]}`
                  : "Welcome back"}
              </h2>
              <p className="text-text-muted text-[13px] mt-1">
                {tab === "pin"
                  ? "Enter your Quick PIN to continue."
                  : "Sign in to your command center."}
              </p>
            </div>

            {pinEnabled && (
              <div className="flex p-1 rounded-xl bg-text-primary/[0.05] border border-line/40 mb-5">
                {(["password", "pin"] as Tab[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setTab(t);
                      setError(null);
                    }}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold uppercase tracking-wide transition-all",
                      tab === t
                        ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                        : "text-text-muted hover:text-text-primary",
                    )}
                  >
                    {t === "password" ? (
                      <KeyRound className="w-3.5 h-3.5" />
                    ) : (
                      <Hash className="w-3.5 h-3.5" />
                    )}
                    {t === "password" ? "Password" : "Quick PIN"}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mb-4 text-[12.5px] font-medium text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            {tab === "password" ? (
              <form onSubmit={submitPassword} className="space-y-3.5">
                <label className="block">
                  <span className="micro mb-1.5 block">Email</span>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                    <input
                      ref={emailRef}
                      type="email"
                      autoComplete="username"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@company.com"
                      className={inputCls}
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="micro mb-1.5 block">Password</span>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={cn(inputCls, "pr-11")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute right-3 top-1/2 -translate-y-1/2 grid place-items-center w-7 h-7 rounded-md text-text-faint hover:text-text-primary"
                    >
                      {showPw ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </label>

                <div className="flex items-center justify-between pt-0.5">
                  <label className="flex items-center gap-2 text-[12.5px] text-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="accent-[rgb(var(--accent-deep))] w-3.5 h-3.5"
                    />
                    Keep me signed in
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setView("forgot");
                      setError(null);
                    }}
                    className="text-[12.5px] font-semibold text-accent-glow hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group relative w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase overflow-hidden hover:bg-accent transition-all disabled:opacity-80"
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-2",
                      loading && "invisible",
                    )}
                  >
                    Sign In <ArrowRight className="w-4 h-4" />
                  </span>
                  {loading && (
                    <Loader2 className="absolute inset-0 m-auto w-5 h-5 animate-spin" />
                  )}
                  <span className="cta-sheen" />
                </button>
              </form>
            ) : remembered ? (
              <div className="space-y-3.5">
                {/* The remembered account — no email retyping. */}
                <div className="flex items-center gap-3 rounded-xl border border-line/50 bg-text-primary/[0.04] px-3 py-2.5">
                  <span className="grid place-items-center w-9 h-9 rounded-full bg-accent-deep/90 text-[#F4E9D9] text-[13px] font-semibold uppercase shrink-0">
                    {(remembered.display_name || remembered.email)
                      .trim()
                      .charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-text-primary truncate">
                      {remembered.display_name || remembered.email}
                    </div>
                    <div className="text-[11.5px] text-text-faint truncate">
                      {remembered.email}
                    </div>
                  </div>
                </div>
                <label className="block">
                  <span className="micro mb-1.5 block">6-digit PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    maxLength={6}
                    value={pin}
                    disabled={loading}
                    onChange={(e) => {
                      const next = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setPin(next);
                      if (next.length === 6) submitPin(next);
                    }}
                    placeholder="••••••"
                    className="w-full bg-text-primary/[0.04] border border-line/60 rounded-xl py-3.5 text-center text-3xl font-mono tracking-[0.5em] text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all disabled:opacity-60"
                  />
                </label>
                {loading && (
                  <div className="flex items-center justify-center gap-2 text-text-muted text-[12.5px]">
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying…
                  </div>
                )}
                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    onClick={useDifferentAccount}
                    className="text-[12.5px] font-semibold text-text-muted hover:text-text-primary transition-colors"
                  >
                    Not you?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTab("password");
                      setEmail(remembered.email);
                      setError(null);
                    }}
                    className="text-[12.5px] font-semibold text-accent-glow hover:underline"
                  >
                    Use password instead
                  </button>
                </div>
              </div>
            ) : (
              // No remembered account on this device — PIN needs to know who
              // you are, so sign in with a password once to enable it.
              <div className="space-y-4 text-center py-2">
                <p className="text-text-muted text-[13px]">
                  Sign in with your password once on this device to enable
                  Quick PIN.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setTab("password");
                    setError(null);
                  }}
                  className="w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
                >
                  Use password
                </button>
              </div>
            )}
          </>
        ) : (
          // ── Forgot password ──
          <div className="animate-app-in">
            <button
              onClick={() => {
                setView("signin");
                setError(null);
              }}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-muted hover:text-text-primary mb-5"
            >
              <ArrowLeft className="w-4 h-4" /> Back to sign in
            </button>
            {forgotDone ? (
              <div className="text-center py-4">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full grid place-items-center bg-success/15 text-success">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <h2 className="font-display text-[22px]">Check your email</h2>
                <p className="text-text-muted text-[13px] mt-2 max-w-[320px] mx-auto">
                  If an account exists for{" "}
                  <span className="text-text-primary font-medium">
                    {email}
                  </span>
                  , we've sent a link to reset your password. It expires shortly.
                </p>
                <button
                  onClick={onClose}
                  className="mt-6 w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submitForgot}>
                <h2 className="font-display text-[24px]">Reset password</h2>
                <p className="text-text-muted text-[13px] mt-1 mb-5">
                  Enter your email and we'll send you a secure reset link.
                </p>
                <div className="relative mb-4">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className={inputCls}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all disabled:opacity-80 flex items-center justify-center"
                >
                  {loading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    "Send reset link"
                  )}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
