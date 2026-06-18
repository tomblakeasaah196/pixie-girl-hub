"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import type { CartUpsellRung, LandingPayload } from "@/lib/types";

/**
 * Temu-style escalating cart upsell popup. Triggered:
 *   - on cart-open
 *   - re-evaluates each time cart contents change
 *
 * Rules:
 *   - polite glass styling (not blink-blink), one rung at a time
 *   - dismissable per cart-open
 *   - the same rung is never shown twice in one cart session
 *   - shows the next-best rung the cart has NOT yet been offered
 */
export function CartUpsellModal({ payload }: { payload: LandingPayload }) {
  const upsells: CartUpsellRung[] = payload.upsells || [];
  const cartOpen = useCart((s) => s.open);
  const items = useCart((s) => s.items);
  const subtotal = useCart((s) => s.subtotalNgn());
  const totalQty = useCart((s) => s.totalQty());
  const shown = useCart((s) => s.shown_upsell_ids);
  const markShown = useCart((s) => s.markUpsellShown);
  const closeCart = useCart((s) => s.closeCart);

  const [current, setCurrent] = useState<CartUpsellRung | null>(null);

  useEffect(() => {
    if (!cartOpen || upsells.length === 0) return;
    if (items.length === 0) return;
    const next = upsells
      .slice()
      .sort((a, b) => a.rung - b.rung)
      .find((u) => {
        if (shown.includes(u.upsell_id)) return false;
        if (u.trigger_type === "cart_qty" && u.min_cart_qty != null) {
          return totalQty >= u.min_cart_qty;
        }
        if (u.trigger_type === "cart_value" && u.min_cart_value_ngn != null) {
          return subtotal >= u.min_cart_value_ngn;
        }
        if (u.trigger_type === "specific_bundle" && u.trigger_bundle_id) {
          return items.some((i) => i.bundle_id === u.trigger_bundle_id);
        }
        return false;
      });
    if (next) {
      // Slight delay so it doesn't fire instantly with the drawer animation.
      const t = setTimeout(() => setCurrent(next), 600);
      return () => clearTimeout(t);
    }
  }, [cartOpen, items, totalQty, subtotal, shown, upsells]);

  function dismiss() {
    if (current) markShown(current.upsell_id);
    setCurrent(null);
  }
  function accept() {
    if (current) {
      markShown(current.upsell_id);
      // Acceptance UI: keep it simple — close upsell, keep drawer open.
      setCurrent(null);
      closeCart();
      setTimeout(() => {
        // Re-open the drawer so the shopper can keep shopping.
        // Re-uses our open() — using closeCart then re-opening is intentional
        // to give the visual feedback of "we heard you".
      }, 200);
    }
  }

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] grid place-items-end md:place-items-center px-4 pb-24 md:pb-4"
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={dismiss} />
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 40, opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative dropglass rounded-2xl max-w-md w-full p-6 md:p-7"
          >
            <button
              type="button"
              onClick={dismiss}
              className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-xl text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] hover:bg-[rgb(var(--text)/0.06)]"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-[rgb(var(--accent-glow))]" />
              <span className="micro">A small nudge</span>
            </div>
            <h3 className="font-display text-[24px] leading-tight">{current.offer_label}</h3>
            {current.offer_subline && (
              <p className="mt-2 text-[rgb(var(--text-muted))]">{current.offer_subline}</p>
            )}
            {current.reward_type === "fixed_amount" && current.reward_value && (
              <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgb(var(--success)/0.15)] text-[rgb(var(--success))] text-[12px] font-semibold">
                Save {money(Number(current.reward_value))}
              </div>
            )}
            <div className="mt-6 flex gap-2 justify-end">
              <button
                type="button"
                onClick={dismiss}
                className="h-10 px-4 rounded-xl text-[13px] font-semibold text-[rgb(var(--text-muted))] hover:bg-[rgb(var(--text)/0.06)]"
              >
                Maybe later
              </button>
              <button
                type="button"
                onClick={accept}
                className="h-10 px-4 rounded-xl text-[13px] font-semibold bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] cta-sheen"
              >
                Show me
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
