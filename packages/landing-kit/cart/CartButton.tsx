// @ts-nocheck
"use client";

import { ShoppingBag } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "../cart-store";
import { money } from "../format";

export function CartButton() {
  const totalQty = useCart((s) => s.totalQty());
  const subtotal = useCart((s) => s.subtotalNgn());
  const open = useCart((s) => s.openCart);

  return (
    <div className="fixed bottom-4 left-0 right-0 z-40 pointer-events-none px-4">
      <div className="mx-auto max-w-[640px] pointer-events-auto">
        <button
          type="button"
          onClick={open}
          className="w-full h-14 dropglass rounded-2xl px-5 flex items-center gap-3 shadow-[0_22px_50px_rgb(0_0_0/0.55)]"
        >
          <span className="grid place-items-center w-10 h-10 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]">
            <ShoppingBag className="w-4 h-4" />
          </span>
          <span className="flex-1 text-left">
            <span className="block text-[13px] text-[rgb(var(--text-muted))]">
              {totalQty === 0
                ? "Your cart is empty"
                : `${totalQty} item${totalQty === 1 ? "" : "s"}`}
            </span>
            <span className="block font-display tabular-nums text-[15px]">
              {totalQty === 0 ? "Browse the bundles" : money(subtotal)}
            </span>
          </span>
          <AnimatePresence>
            {totalQty > 0 && (
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="text-[12px] font-semibold text-[rgb(var(--accent-glow))]"
              >
                Checkout →
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}
