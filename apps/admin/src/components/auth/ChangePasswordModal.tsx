import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Eye, EyeOff, Loader2, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { checkPassword, passwordScore } from "@/lib/password";
import { changePassword } from "@/lib/auth-api";

const STRENGTH_COLORS = ["bg-danger", "bg-orange-400", "bg-yellow-400", "bg-success"];

export function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCurrent("");
    setNewPw("");
    setConfirm("");
    setShowCurrent(false);
    setShowNew(false);
    setLoading(false);
    setError(null);
    setDone(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const check = checkPassword(newPw);
  const score = passwordScore(newPw);
  const canSubmit =
    current.length >= 1 && check.ok && newPw === confirm && !loading;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      await changePassword(current, newPw);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change password.");
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    "w-full h-11 bg-text-primary/[0.04] border border-line/60 rounded-xl px-4 pr-10 text-[13.5px] text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/60 transition-all";

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-bg/70 backdrop-blur-xl animate-fade-in"
        onClick={onClose}
      />
      <div className="relative w-full max-w-[420px] dropglass rounded-[22px] p-7 shadow-glass animate-app-in">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 grid place-items-center w-8 h-8 rounded-full text-text-faint hover:text-text-primary hover:bg-text-primary/10"
        >
          <X className="w-4 h-4" />
        </button>

        <span className="grid place-items-center w-11 h-11 rounded-xl bg-accent/10 text-accent-glow border border-accent/20 mb-4">
          <KeyRound className="w-5 h-5" />
        </span>
        <h2 className="font-display text-[22px]">Change password</h2>

        {done ? (
          <div className="text-center py-6">
            <div className="w-14 h-14 mx-auto mb-3 rounded-full grid place-items-center bg-success/15 text-success">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <p className="font-semibold text-[15px] mb-1">Password updated</p>
            <p className="text-text-muted text-[13px]">
              Your password has been changed successfully.
            </p>
            <button
              onClick={onClose}
              className="mt-5 w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <p className="text-text-muted text-[13px] mt-1 mb-5">
              Enter your current password, then choose a strong new one.
            </p>

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
                  Current password
                </label>
                <div className="relative">
                  <input
                    type={showCurrent ? "text" : "password"}
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    placeholder="Your current password"
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
                  >
                    {showCurrent ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[11.5px] font-semibold text-text-faint uppercase tracking-wider mb-2">
                  New password
                </label>
                <div className="relative">
                  <input
                    type={showNew ? "text" : "password"}
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="New password"
                    className={fieldClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-muted"
                  >
                    {showNew ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {newPw.length > 0 && (
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: 4 }, (_, i) => (
                      <div
                        key={i}
                        className={cn(
                          "h-1 flex-1 rounded-full transition-all duration-300",
                          i < score
                            ? STRENGTH_COLORS[score - 1]
                            : "bg-text-primary/10",
                        )}
                      />
                    ))}
                  </div>
                )}
                {newPw.length > 0 && !check.ok && check.error && (
                  <p className="text-[11.5px] text-danger mt-1.5">
                    {check.error}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[11.5px] font-semibold text-text-faint uppercase tracking-wider mb-2">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat new password"
                  className={fieldClass}
                />
                {confirm.length > 0 && check.ok && newPw !== confirm && (
                  <p className="text-[11.5px] text-danger mt-1.5">
                    Passwords don't match.
                  </p>
                )}
              </div>
            </div>

            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="mt-6 w-full h-11 rounded-xl bg-accent-deep text-[#F4E9D9] font-semibold text-[13px] tracking-widest uppercase hover:bg-accent transition-all disabled:opacity-50 flex items-center justify-center"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                "Update password"
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
