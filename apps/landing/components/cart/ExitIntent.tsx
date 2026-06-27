"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Copy, Gift, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import type { LandingPayload } from "@/lib/types";

const SESSION_KEY = "pgh-exit-intent-shown";

export function ExitIntent({ payload }: { payload: LandingPayload }) {
  const [open, setOpen] = useState(false);
  const cartOpen = useCart((s) => s.open);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(SESSION_KEY) === payload.slug) return;
    let triggered = false;
    function trigger() {
      if (triggered || cartOpen) return;
      triggered = true;
      sessionStorage.setItem(SESSION_KEY, payload.slug);
      setOpen(true);
    }
    function onMouseLeave(e: MouseEvent) {
      if (e.clientY <= 0) trigger();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") trigger();
    }
    // NB: we deliberately do NOT trap the back button with history.pushState.
    // Manually pushing/popping history corrupts the Next App Router's own
    // history state, which made router.push("/checkout/…") blink to the page
    // and snap straight back — the "checkout closes the drawer and returns to
    // the landing" bug. Desktop exit-intent uses mouseleave; tab-switch uses
    // visibilitychange; neither touches the history stack.
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [payload.slug, cartOpen]);

  if (!payload.exit_intent_enabled) return null;
  const code = payload.exit_intent_code;
  const amount = payload.exit_intent_discount_ngn;
  if (!code || !amount) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] grid place-items-center px-4"
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-[4px]"
            onClick={() => setOpen(false)}
          />
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={payload.exit_intent_title || "A parting offer"}
            className="relative dropglass rounded-2xl max-w-md w-full p-7 text-center"
          >
            {/* Close — paper-toned so it stays visible on the dark glass. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-xl text-[rgb(var(--text)/0.75)] hover:bg-[rgb(var(--text)/0.1)] transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            {/* Gift glyph — brand-accent (the warm tan/gold), which reads on
                both the maroon (Pixie) and espresso (Faitlyn) surfaces. The old
                --accent-glow was a red that failed WCAG on the Pixie modal. */}
            <span className="grid place-items-center w-14 h-14 rounded-2xl bg-[rgb(var(--brand-accent)/0.16)] text-[rgb(var(--brand-accent))] mx-auto mb-3">
              <Gift className="w-6 h-6" />
            </span>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[rgb(var(--brand-accent))] mb-1.5">
              A parting gift
            </p>
            <h3 className="font-display text-[26px] leading-tight">
              {payload.exit_intent_title || "Wait — a small gift before you go."}
            </h3>
            {/* Softened paper (not full title white) to keep a readable hierarchy
                while staying ≥ 9:1 on the glass. */}
            <p className="mt-2 text-[rgb(var(--text-muted)/0.82)]">
              {payload.exit_intent_body ||
                `Use this code at checkout for ${money(amount)} off — only good this session.`}
            </p>
            {/* Code + amount — the saving is spelled out next to the code so the
                offer is concrete, not just a mystery string. */}
            <div className="mt-5 inline-flex items-center gap-3 px-4 py-3 rounded-xl border border-[rgb(var(--brand-accent)/0.45)] bg-[rgb(var(--brand-accent)/0.08)]">
              <span className="font-mono font-bold tracking-[0.16em] text-[rgb(var(--brand-accent))]">
                {code}
              </span>
              <span className="font-mono font-bold text-[rgb(var(--text))] pl-3 border-l border-[rgb(var(--text)/0.18)]">
                {money(amount)} off
              </span>
            </div>
            {/* Primary CTA — reuses the design-system .btn-cta, which inside a
                .dropglass overlay paints a light brand-accent fill with dark ink
                text (WCAG ≥ 9:1). The old hand-rolled bg/text collided with the
                .cta-sheen colour override and rendered the label invisible. */}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(code).catch(() => {});
                setOpen(false);
              }}
              className="btn-cta cta-sheen mt-6 w-full inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl font-semibold"
            >
              <Copy className="w-4 h-4" />
              {payload.exit_intent_button || "Copy code & keep shopping"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-3 w-full text-[12.5px] font-semibold text-[rgb(var(--text-muted)/0.82)] hover:text-[rgb(var(--text))] transition-colors"
            >
              No thanks, keep browsing
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
