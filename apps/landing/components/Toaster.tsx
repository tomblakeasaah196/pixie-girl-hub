"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useToasts, type Toast } from "@/lib/toast";

/** Global toast viewport. Mounted once in the root layout so every page
 *  (sale, checkout, thank-you) can surface a friendly message. */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 pointer-events-none"
      aria-live="assertive"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({
  toast,
  onClose,
}: {
  toast: Toast;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast.duration) return;
    const id = window.setTimeout(onClose, toast.duration);
    return () => window.clearTimeout(id);
  }, [toast.duration, onClose]);

  const Icon =
    toast.tone === "success"
      ? CheckCircle2
      : toast.tone === "info"
        ? Info
        : AlertCircle;
  const toneClass =
    toast.tone === "success"
      ? "border-[rgb(var(--success)/0.4)] text-[rgb(var(--success))]"
      : toast.tone === "info"
        ? "border-[rgb(var(--accent)/0.4)] text-[rgb(var(--accent-readable))]"
        : "border-[rgb(var(--danger)/0.45)] text-[rgb(var(--danger))]";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, scale: 0.96 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={`dropglass pointer-events-auto w-[min(440px,92vw)] rounded-2xl border ${toneClass} px-4 py-3 shadow-[0_20px_60px_rgb(0_0_0/0.45)]`}
      role="alert"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-[rgb(var(--text))]">
            {toast.title}
          </p>
          {toast.body && (
            <p className="mt-0.5 text-[12px] leading-snug text-[rgb(var(--text-muted))]">
              {toast.body}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[rgb(var(--text-faint))] hover:text-[rgb(var(--text))]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
