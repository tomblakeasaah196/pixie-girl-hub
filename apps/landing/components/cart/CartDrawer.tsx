"use client";

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import type { LandingPayload } from "@/lib/types";

export function CartDrawer({ payload }: { payload: LandingPayload }) {
  const open = useCart((s) => s.open);
  const close = useCart((s) => s.closeCart);
  const items = useCart((s) => s.items);
  const setQ = useCart((s) => s.setQuantity);
  const remove = useCart((s) => s.remove);
  const subtotal = useCart((s) => s.subtotalNgn());
  const retail = useCart((s) => s.retailSubtotalNgn());
  const savings = useCart((s) => s.savingsNgn());

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[3px]"
            onClick={close}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            className="fixed top-0 right-0 bottom-0 z-50 w-[min(440px,95vw)] dropglass border-l border-[rgb(var(--border-c)/0.12)] flex flex-col shadow-[-30px_0_80px_rgb(0_0_0/0.5)]"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b hairline">
              <h2 className="font-display text-[20px]">Your cart</h2>
              <button
                type="button"
                onClick={close}
                className="ml-auto grid place-items-center w-9 h-9 rounded-xl text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] hover:bg-[rgb(var(--text)/0.06)]"
                aria-label="Close cart"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {items.length === 0 && (
                <div className="text-center pt-10">
                  <span className="inline-grid place-items-center w-16 h-16 rounded-2xl bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent-glow))] mb-3">
                    <ShoppingBag className="w-6 h-6" />
                  </span>
                  <h3 className="font-display text-[22px]">A quiet moment.</h3>
                  <p className="text-[rgb(var(--text-muted))] text-[13px] mt-1">
                    Drop a bundle in to begin.
                  </p>
                </div>
              )}
              {items.map((it) => (
                <div
                  key={it.id}
                  className="glass rounded-[14px] p-3 flex gap-3 items-center"
                >
                  <div className="relative w-14 h-14 rounded-[10px] overflow-hidden bg-[rgb(var(--panel-2))] flex-shrink-0">
                    {it.image_url ? (
                      <Image src={it.image_url} alt={it.name} fill sizes="56px" className="object-cover" />
                    ) : (
                      <div className="grid place-items-center w-full h-full text-[rgb(var(--text-faint))]">
                        <ShoppingBag className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold truncate">{it.name}</div>
                    {it.preorder && (
                      <div className="text-[10px] text-[rgb(var(--warn))] mt-0.5">
                        Pre-order · ships in {it.preorder_lead_weeks ?? 3} wks
                      </div>
                    )}
                    <div className="font-display tabular-nums text-[14px] mt-1">
                      {money(it.unit_price_ngn * it.quantity)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQ(it.id, it.quantity - 1)}
                      className="grid place-items-center w-7 h-7 rounded-lg bg-[rgb(var(--text)/0.06)] hover:bg-[rgb(var(--text)/0.1)]"
                      aria-label="Decrease"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="font-mono tabular-nums w-5 text-center text-[13px]">{it.quantity}</span>
                    <button
                      type="button"
                      onClick={() => setQ(it.id, it.quantity + 1)}
                      className="grid place-items-center w-7 h-7 rounded-lg bg-[rgb(var(--text)/0.06)] hover:bg-[rgb(var(--text)/0.1)]"
                      aria-label="Increase"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(it.id)}
                      className="ml-1 grid place-items-center w-7 h-7 rounded-lg text-[rgb(var(--text-faint))] hover:text-[rgb(var(--danger))]"
                      aria-label="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-5 border-t hairline space-y-3">
              <div className="flex justify-between text-[13px]">
                <span className="text-[rgb(var(--text-muted))]">Subtotal</span>
                <span className="font-mono tabular-nums">{money(subtotal)}</span>
              </div>
              {savings > 0 && (
                <div className="flex justify-between text-[13px]">
                  <span className="text-[rgb(var(--success))]">You save</span>
                  <span className="font-mono tabular-nums text-[rgb(var(--success))]">−{money(savings)}</span>
                </div>
              )}
              {savings > 0 && (
                <div className="flex justify-between text-[12px] text-[rgb(var(--text-faint))]">
                  <span>vs retail</span>
                  <span className="font-mono tabular-nums line-through">{money(retail)}</span>
                </div>
              )}
              <Link
                href={`/checkout/${payload.slug}`}
                onClick={close}
                aria-disabled={items.length === 0}
                className={`w-full inline-flex items-center justify-center h-12 rounded-xl font-semibold cta-sheen ${
                  items.length === 0
                    ? "bg-[rgb(var(--text)/0.06)] text-[rgb(var(--text-faint))] pointer-events-none"
                    : "bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]"
                }`}
              >
                Checkout · {money(subtotal)}
              </Link>
              <p className="text-[11px] text-[rgb(var(--text-faint))] text-center">
                DHL rates apply. Pay with Paystack · Opay · Nomba · Stripe.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
