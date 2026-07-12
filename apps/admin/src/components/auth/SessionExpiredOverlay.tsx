import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Hash, KeyRound, Loader2, Lock } from "lucide-react";
import { cn } from "@/lib/cn";
import { ApiError, SESSION_EXPIRED_EVENT } from "@/lib/api";
import {
  isPinEnabledLocally,
  loginWithPassword,
  loginWithPin,
} from "@/lib/auth-api";
import { useAuthStore } from "@/stores/auth";

const REMEMBERED_KEY = "pgh-remembered-account";
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

type Tab = "password" | "pin";

/**
 * Returning after a while away — Product & Praxis needed the session to
 * blur and lock rather than let every button click on the page silently
 * fail with its own error. Listens for SESSION_EXPIRED_EVENT (fired by
 * lib/api.ts when a silent token refresh fails for a previously-authed
 * session), blurs the app behind it, and asks for password or Quick PIN to
 * resume — no navigation, no lost place in the app.
 */
export function SessionExpiredOverlay() {
  const status = useAuthStore((s) => s.status);
  const setSession = useAuthStore((s) => s.setSession);
  const signOut = useAuthStore((s) => s.signOut);
  const loadPermissions = useAuthStore((s) => s.loadPermissions);
  const queryClient = useQueryClient();

  const [show, setShow] = useState(false);
  const remembered = getRemembered();
  const pinAvailable = !!remembered && isPinEnabledLocally();
  const [tab, setTab] = useState<Tab>("password");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onExpired = () => {
      // Only meaningful once the shell has ever been authed on this device.
      if (status !== "authed") return;
      setShow(true);
      setTab(pinAvailable ? "pin" : "password");
      setError(null);
      setPassword("");
      setPin("");
      // The overlay stays mounted for the lifetime of the app; the previous
      // successful sign-in left `loading` at true (submit* never resets it on
      // the success path since we head straight into resume()), which parks
      // the button in its spinner state the next time the session expires.
      setLoading(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Blur + lock the app behind the overlay while it's up.
  useEffect(() => {
    document.body.classList.toggle("session-locked", show);
    return () => document.body.classList.remove("session-locked");
  }, [show]);

  if (!show) return null;

  const shake = () => {
    cardRef.current?.classList.remove("animate-shake");
    void cardRef.current?.offsetWidth;
    cardRef.current?.classList.add("animate-shake");
  };

  const messageFor = (e: unknown, fallback: string) => {
    if (e instanceof ApiError) {
      if (e.status === 423) return "Account locked. Contact an administrator.";
      if (e.status === 401) return e.message || "That didn't match.";
      return e.message || fallback;
    }
    return "Network error — please try again.";
  };

  const resume = async () => {
    setShow(false);
    loadPermissions().catch(() => {});
    // The page behind the overlay may hold data fetched under the old
    // (now-invalid) token — refetch what's on screen instead of leaving it
    // stale until the user next navigates.
    queryClient.invalidateQueries();
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !remembered) return;
    setError(null);
    setLoading(true);
    try {
      const user = await loginWithPassword(remembered.email, password);
      setSession(user);
      await resume();
    } catch (err) {
      setError(messageFor(err, "Could not sign in."));
      shake();
      setLoading(false);
    }
  };

  const submitPin = async (value: string) => {
    if (loading || !remembered) return;
    setError(null);
    setLoading(true);
    try {
      const user = await loginWithPin(remembered.email, value);
      setSession(user);
      await resume();
    } catch (err) {
      setError(messageFor(err, "Invalid PIN."));
      setPin("");
      shake();
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-text-primary/[0.04] border border-line/60 rounded-xl py-3 pl-11 pr-4 text-sm font-medium text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all placeholder:text-text-faint";

  // Portalled to document.body — it must render outside #root, since
  // body.session-locked applies `filter: blur(...)` to #root and CSS
  // filters blur their entire subtree with no way for a descendant to
  // opt out (that previously blurred this sign-in card too).
  return createPortal(
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-bg/60" />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="Session expired — sign in to continue"
        className="relative w-full max-w-[400px] dropglass rounded-[24px] p-7 sm:p-9 shadow-glass animate-app-in"
      >
        <div className="mb-6 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full grid place-items-center glass border border-accent/40">
            <Lock className="w-6 h-6 text-accent-glow" />
          </div>
          <h2 className="font-display text-[22px] leading-tight">
            {remembered?.display_name
              ? `Welcome back, ${remembered.display_name.split(" ")[0]}`
              : "Session expired"}
          </h2>
          <p className="text-text-muted text-[13px] mt-1.5">
            You've been away a while — sign in again to keep going.
          </p>
        </div>

        {pinAvailable && (
          <div className="flex p-1 rounded-xl bg-text-primary/[0.05] border border-line/40 mb-5">
            {(["pin", "password"] as Tab[]).map((tb) => (
              <button
                key={tb}
                onClick={() => {
                  setTab(tb);
                  setError(null);
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold uppercase tracking-wide transition-all",
                  tab === tb
                    ? "bg-accent-deep text-[#F4E9D9] shadow-sm"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {tb === "password" ? (
                  <KeyRound className="w-3.5 h-3.5" />
                ) : (
                  <Hash className="w-3.5 h-3.5" />
                )}
                {tb === "password" ? "Password" : "Quick PIN"}
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

        {tab === "pin" && pinAvailable ? (
          <div className="space-y-3.5">
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
          </div>
        ) : (
          <form onSubmit={submitPassword} className="space-y-3.5">
            {remembered && (
              <div className="flex items-center gap-3 rounded-xl border border-line/50 bg-text-primary/[0.04] px-3 py-2.5 mb-1">
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
            )}
            <label className="block">
              <span className="micro mb-1.5 block">Password</span>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-text-faint" />
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  autoFocus
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
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full h-12 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase overflow-hidden hover:bg-accent transition-all disabled:opacity-80"
            >
              <span className={cn(loading && "invisible")}>Sign In</span>
              {loading && (
                <Loader2 className="absolute inset-0 m-auto w-5 h-5 animate-spin" />
              )}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => {
            setShow(false);
            void signOut().then(() => {
              window.location.href = "/login";
            });
          }}
          className="w-full mt-5 text-center text-[12.5px] font-semibold text-text-muted hover:text-text-primary transition-colors"
        >
          Not you? Sign out
        </button>
      </div>
    </div>,
    document.body,
  );
}
