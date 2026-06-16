import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Eye, EyeOff, Hash, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { checkPin } from "@/lib/password";
import { getPinStatus, removePin, setPin, setPinEnabledLocally } from "@/lib/auth-api";

function OtpBoxes({
  value,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const focus = (i: number) =>
    refs.current[Math.max(0, Math.min(5, i))]?.focus();

  return (
    <div className="flex gap-2.5 justify-center">
      {Array.from({ length: 6 }, (_, i) => {
        const digit = value[i] ?? "";
        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="password"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            autoFocus={autoFocus && i === 0}
            disabled={disabled}
            aria-label={`Digit ${i + 1}`}
            onChange={(e) => {
              const d = e.target.value.replace(/\D/g, "").slice(-1);
              if (!d) return;
              const next = value.slice(0, i) + d + value.slice(i + 1);
              onChange(next.slice(0, 6));
              if (i < 5) focus(i + 1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace") {
                if (digit) {
                  onChange(value.slice(0, i) + value.slice(i + 1));
                } else if (i > 0) {
                  focus(i - 1);
                  onChange(value.slice(0, i - 1) + value.slice(i));
                }
                e.preventDefault();
              } else if (e.key === "ArrowLeft") {
                focus(i - 1);
                e.preventDefault();
              } else if (e.key === "ArrowRight") {
                focus(i + 1);
                e.preventDefault();
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              const pasted = e.clipboardData
                .getData("text")
                .replace(/\D/g, "")
                .slice(0, 6);
              onChange(pasted);
              focus(Math.min(pasted.length, 5));
            }}
            className={cn(
              "w-11 h-14 rounded-xl border text-center text-2xl font-mono caret-transparent",
              "outline-none transition-all duration-150 select-none",
              digit
                ? "border-accent/60 bg-accent/[0.06] text-accent-glow ring-1 ring-accent/20"
                : "border-line/50 bg-text-primary/[0.04]",
              "focus:border-accent focus:ring-2 focus:ring-accent/30",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          />
        );
      })}
    </div>
  );
}

export function PinManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pin, setPin2] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"set" | "removed" | null>(null);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setShowPw(false);
    setPin2("");
    setConfirm("");
    setError(null);
    setDone(null);
    setHasPin(null);
    getPinStatus()
      .then((s) => {
        setHasPin(s.pin_set);
        setPinEnabledLocally(s.pin_set);
      })
      .catch(() => setHasPin(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pinCheck = checkPin(pin);
  const canSave = password.length >= 1 && pinCheck.ok && pin === confirm && !loading;

  const save = async () => {
    if (!canSave) return;
    setLoading(true);
    setError(null);
    try {
      await setPin(pin);
      setDone("set");
      setHasPin(true);
      setPinEnabledLocally(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save PIN.");
    } finally {
      setLoading(false);
    }
  };

  const removePinFn = async () => {
    setLoading(true);
    setError(null);
    try {
      await removePin();
      setDone("removed");
      setHasPin(false);
      setPinEnabledLocally(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove PIN.");
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/70 backdrop-blur-xl animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[400px] dropglass rounded-[22px] p-7 shadow-glass animate-app-in">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10"
        >
          <X className="w-4 h-4" />
        </button>

        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20 mb-4">
          <Hash className="w-5 h-5" />
        </span>
        <h2 className="font-display text-[22px]">Quick login PIN</h2>

        {done ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full grid place-items-center bg-success/15 text-success">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="text-text-muted text-[13.5px]">
              {done === "set"
                ? "Your PIN is set. Use it on the Quick-PIN tab next time you sign in."
                : "Your PIN has been removed."}
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
            >
              Done
            </button>
          </div>
        ) : hasPin === null ? (
          <div className="flex items-center gap-2 text-text-muted text-[13px] py-6">
            <Loader2 className="w-4 h-4 animate-spin" /> Checking…
          </div>
        ) : (
          <>
            <p className="text-text-muted text-[13px] mt-1 mb-5">
              {hasPin
                ? "Choose a new 6-digit PIN, or remove the existing one."
                : "Set a 6-digit PIN for fast sign-in."}
            </p>

            <div className="mb-5">
              <label className="block text-[11.5px] font-semibold text-text-faint uppercase tracking-wider mb-2">
                Your password
              </label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="w-full h-11 bg-text-primary/[0.04] border border-line/60 rounded-xl px-4 pr-10 text-[13.5px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
                >
                  {showPw ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="mb-4 text-[12.5px] font-medium text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-[11.5px] font-semibold text-text-faint uppercase tracking-wider mb-2">
                  New PIN
                </label>
                <OtpBoxes
                  value={pin}
                  onChange={setPin2}
                  disabled={loading}
                />
                {pin.length === 6 && !pinCheck.ok && (
                  <p className="text-[11.5px] text-danger mt-2 text-center">
                    {pinCheck.error}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11.5px] font-semibold text-text-faint uppercase tracking-wider mb-2">
                  Confirm PIN
                </label>
                <OtpBoxes
                  value={confirm}
                  onChange={setConfirm}
                  disabled={loading}
                />
                {confirm.length === 6 && pinCheck.ok && pin !== confirm && (
                  <p className="text-[11.5px] text-danger mt-2 text-center">
                    PINs don't match.
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={save}
              disabled={!canSave}
              className="mt-6 w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : hasPin ? (
                "Update PIN"
              ) : (
                "Set PIN"
              )}
            </button>

            {hasPin && (
              <button
                onClick={removePinFn}
                disabled={loading}
                className="mt-3 w-full h-10 rounded-xl text-[12.5px] font-semibold text-danger hover:bg-danger/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> Remove PIN
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
