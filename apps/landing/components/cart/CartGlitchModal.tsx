"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Sparkles, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";

export function CartGlitchModal() {
  const [mounted, setMounted] = useState(false);
  const glitch = useCart((s) => s.glitchCleared);
  const ack = useCart((s) => s.acknowledgeGlitch);

  useEffect(() => setMounted(true), []);

  return (
    <AnimatePresence>
      {mounted && glitch && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] grid place-items-center px-4"
        >
          <div
            className="absolute inset-0 bg-black/65 backdrop-blur-[4px]"
            onClick={ack}
          />
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="We hit a small glitch"
            className="relative dropglass rounded-2xl max-w-md w-full p-7 text-center"
          >
            <button
              type="button"
              onClick={ack}
              className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-xl text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--text)/0.06)]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
            <span className="grid place-items-center w-14 h-14 rounded-2xl bg-[rgb(var(--accent)/0.15)] text-[rgb(var(--accent-glow))] mx-auto mb-3">
              <Gift className="w-6 h-6" />
            </span>
            <h3 className="font-display text-[26px] leading-tight">
              Sorry — we hit a small glitch.
            </h3>
            <p className="mt-2 text-[rgb(var(--text-muted))]">
              During the sale a few baskets had a checkout hiccup. We&apos;ve sorted
              it out and cleared your cart so everything flows smoothly again — pick
              your favourites and check out with no stress.
            </p>
            <p className="mt-2 inline-flex items-center justify-center gap-1.5 text-[rgb(var(--text-muted))]">
              <Sparkles className="w-4 h-4 text-[rgb(var(--accent-glow))]" />
              To say thank you for your patience, a little free gift will arrive with
              your delivery this sale — on us.
            </p>
            <button
              type="button"
              onClick={ack}
              className="mt-6 inline-flex items-center justify-center h-11 px-5 rounded-xl bg-[rgb(var(--bg))] text-[rgb(var(--accent))] font-semibold cta-sheen"
            >
              Start shopping →
            </button>
            <p className="mt-3 text-[rgb(var(--text-muted))] text-sm">
              Your gift comes in the box with your delivery — nothing to do on your end.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
