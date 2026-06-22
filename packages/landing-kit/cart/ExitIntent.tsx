// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, X } from "lucide-react";
import { useCart } from "../cart-store";
import { money } from "../format";
import type { LandingPayload } from "../types";

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
    // Mobile: detect back-gesture via history pop.
    function onPopState() {
      trigger();
      window.history.pushState(null, "", window.location.href);
    }
    window.history.pushState(null, "", window.location.href);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("popstate", onPopState);
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
            className="relative dropglass rounded-2xl max-w-md w-full p-7 text-center"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-xl text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--text)/0.06)]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <span className="grid place-items-center w-14 h-14 rounded-2xl bg-[rgb(var(--accent)/0.15)] text-[rgb(var(--accent-glow))] mx-auto mb-3">
              <Gift className="w-6 h-6" />
            </span>
            <h3 className="font-display text-[26px] leading-tight">
              Wait — a small gift before you go.
            </h3>
            <p className="mt-2 text-[rgb(var(--text-muted))]">
              Use this code at checkout for {money(amount)} off — only good this
              session.
            </p>
            <div className="mt-5 inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.08)] font-mono text-[rgb(var(--accent-glow))] font-bold tracking-[0.18em]">
              {code}
            </div>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(code).catch(() => {});
                setOpen(false);
              }}
              className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen"
            >
              Copy code &amp; keep shopping
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
