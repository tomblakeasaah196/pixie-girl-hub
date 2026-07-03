/**
 * Toaster — the app-wide feedback stack (top-center) for saves/publishes and
 * failures. Mounted once in AppShell. Reads stores/toast.
 *
 * Success/info toasts auto-dismiss. Error toasts that carry a report context
 * stay until dismissed and expose "Contact System Admin" — one tap screenshots
 * the page and opens a pre-filled WhatsApp / email to JBS Praxis so QA gets a
 * reproducible report instead of a silent failure.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  MessageCircle,
  Mail,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useToastStore, type ToastItem } from "@/stores/toast";
import { reportViaWhatsApp, reportViaEmail } from "@/lib/error-report";

function accent(variant: ToastItem["variant"]) {
  if (variant === "success")
    return { border: "border-l-success", Icon: CheckCircle2, icon: "text-success" };
  if (variant === "error")
    return { border: "border-l-danger", Icon: AlertTriangle, icon: "text-danger" };
  return { border: "border-l-accent", Icon: Info, icon: "text-accent" };
}

function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState<null | "wa" | "email">(null);
  const [note, setNote] = useState<string | null>(null);
  const { border, Icon, icon } = accent(item.variant);

  useEffect(() => {
    if (!item.durationMs) return;
    timer.current = setTimeout(() => dismiss(item.id), item.durationMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [item.durationMs, item.id, dismiss]);

  async function report(channel: "wa" | "email") {
    if (!item.report || busy) return;
    setBusy(channel);
    setNote("Capturing screenshot…");
    try {
      const shot =
        channel === "wa"
          ? await reportViaWhatsApp(item.report)
          : await reportViaEmail(item.report);
      setNote(
        shot
          ? "Screenshot downloaded — attach it in the chat that just opened."
          : "Opened — the message is pre-filled with the details.",
      );
    } catch {
      setNote("Couldn't open the report — please contact JBS Praxis directly.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.97 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      role={item.variant === "error" ? "alert" : "status"}
      aria-live={item.variant === "error" ? "assertive" : "polite"}
      className={cn(
        "pointer-events-auto w-[380px] max-sm:w-[calc(100vw-32px)]",
        "glass rounded-[14px] shadow-glass border-l-[3px] p-[13px_14px]",
        border,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", icon)} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-text-primary">
            {item.title}
          </p>
          {item.description && (
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-muted">
              {item.description}
            </p>
          )}

          {item.report && (
            <div className="mt-2.5">
              <p className="mb-1.5 text-[11px] text-text-muted">
                Need help? Send this to your System Admin (JBS Praxis).
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => report("wa")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-medium",
                    "bg-success/15 text-success hover:bg-success/25 disabled:opacity-50 transition-colors",
                  )}
                >
                  <MessageCircle className="h-3.5 w-3.5" />
                  {busy === "wa" ? "Opening…" : "WhatsApp JBS"}
                </button>
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => report("email")}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-[11.5px] font-medium",
                    "bg-text-primary/[0.06] text-text-primary hover:bg-text-primary/[0.12] disabled:opacity-50 transition-colors",
                  )}
                >
                  <Mail className="h-3.5 w-3.5" />
                  {busy === "email" ? "Opening…" : "Email"}
                </button>
              </div>
              {note && (
                <p className="mt-1.5 text-[10.5px] leading-snug text-text-faint">
                  {note}
                </p>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => dismiss(item.id)}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded-lg p-1 text-text-faint transition-colors hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

export function Toaster() {
  const items = useToastStore((s) => s.items);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[300] flex flex-col items-center gap-2.5 px-4">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </div>
  );
}
