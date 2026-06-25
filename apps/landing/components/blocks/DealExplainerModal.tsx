"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import type { LandingPayload } from "@/lib/types";
import { SALE_RED, dealMechanisms } from "@/lib/deals";

export function DealExplainerModal({
  payload,
  open,
  onClose,
}: {
  payload: LandingPayload;
  open: boolean;
  onClose: () => void;
}) {
  const mechanisms = dealMechanisms(payload);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="deal-explainer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] grid place-items-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="How the savings work"
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-[4px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 24, scale: 0.97, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="relative dropglass rounded-2xl w-[min(560px,96vw)] max-h-[82dvh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-4 border-b border-white/10"
              style={{ background: `${SALE_RED}1A` }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="grid place-items-center w-8 h-8 rounded-lg text-white flex-shrink-0"
                  style={{ background: SALE_RED }}
                >
                  <Sparkles className="w-4 h-4" />
                </span>
                <div>
                  <div
                    className="text-[15px] font-bold"
                    style={{ color: SALE_RED }}
                  >
                    Every way you save
                  </div>
                  <div className="text-[11px] text-[rgb(var(--text-faint))]">
                    These prices end when the timer hits zero
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-xl hover:bg-white/10 transition-colors flex-shrink-0"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mechanisms */}
            <div className="overflow-y-auto p-5 space-y-3">
              {mechanisms.length === 0 ? (
                <p className="text-[13px] text-[rgb(var(--text-muted))] text-center py-6">
                  Sale discounts apply automatically in your cart.
                </p>
              ) : (
                mechanisms.map((m, i) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.07, duration: 0.3 }}
                    className="rounded-[14px] border border-white/10 bg-white/[0.04] p-4 space-y-1.5"
                  >
                    <div
                      className="text-[13px] font-bold"
                      style={{ color: SALE_RED }}
                    >
                      {m.headline}
                    </div>
                    <p className="text-[13px] leading-relaxed text-[rgb(var(--text-muted))]">
                      {m.detail}
                    </p>
                  </motion.div>
                ))
              )}

              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center pt-1">
                All savings confirm in your cart before payment — the price you
                see there is exactly what you pay.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
