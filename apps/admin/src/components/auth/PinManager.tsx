import { useEffect, useState } from "react";
import { CheckCircle2, Hash, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { checkPin } from "@/lib/password";
import {
  getPinStatus,
  removePin,
  setPin,
  setPinEnabledLocally,
} from "@/lib/auth-api";

/**
 * Quick-login PIN management (canon §3.1 account menu). Set, change, or
 * remove the 6-digit PIN that powers the login screen's Quick-PIN tab.
 * The PIN is never displayed — only set/cleared — and the backend stores
 * it argon2-hashed.
 */
export function PinManager({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pin, setPinValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"set" | "removed" | null>(null);

  useEffect(() => {
    if (!open) return;
    setPinValue("");
    setConfirm("");
    setError(null);
    setDone(null);
    setHasPin(null);
    getPinStatus()
      .then((s) => {
        setHasPin(s.pin_set);
        // Keep the device-local default in sync with the server truth.
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

  const valid = checkPin(pin);
  const canSave = valid.ok && pin === confirm && !loading;

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

  const clear = async () => {
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

  const pinInput =
    "w-full bg-text-primary/[0.04] border border-line/60 rounded-xl py-3 text-center text-2xl font-mono tracking-[0.5em] text-text-primary focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/70 backdrop-blur-xl animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[380px] dropglass rounded-[22px] p-7 shadow-glass animate-app-in">
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
          <div className="text-center py-5">
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
                : "Set a 6-digit PIN for fast sign-in. Avoid repeated or sequential digits."}
            </p>

            {error && (
              <div
                role="alert"
                className="mb-4 text-[12.5px] font-medium text-danger bg-danger/10 border border-danger/30 rounded-lg px-3 py-2"
              >
                {error}
              </div>
            )}

            <div className="space-y-3">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) =>
                  setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="••••••"
                className={pinInput}
                aria-label="New PIN"
              />
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={confirm}
                onChange={(e) =>
                  setConfirm(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="Confirm"
                className={cn(pinInput, "text-lg tracking-[0.4em]")}
                aria-label="Confirm PIN"
              />
              {pin.length === 6 && !valid.ok && (
                <p className="text-[11.5px] text-danger">{valid.error}</p>
              )}
              {confirm.length === 6 && valid.ok && pin !== confirm && (
                <p className="text-[11.5px] text-danger">PINs don't match.</p>
              )}
            </div>

            <button
              onClick={save}
              disabled={!canSave}
              className="mt-5 w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
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
                onClick={clear}
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
}
