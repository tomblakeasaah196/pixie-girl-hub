"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  HelpCircle,
  Package,
  Ruler,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";

const STORAGE_KEY = "pgh-howto-seen-v1";

const STEPS = [
  {
    icon: Search,
    title: "Find your wig",
    body: "Browse styled wigs or a ready-made bundle. Tap any card to see photos, details and the head-size guide.",
  },
  {
    icon: Ruler,
    title: "Pick size & lace",
    body: "Choose your head size and lace type — the price updates live as you choose.",
  },
  {
    icon: ShoppingBag,
    title: "Add to bag",
    body: "Tap Add to bag. Discounts stack automatically — the more wigs you add, the more each one saves.",
  },
  {
    icon: CreditCard,
    title: "Checkout & pay",
    body: "Open your cart, tap Checkout, fill in delivery, and pay securely with Paystack or Nomba.",
  },
];

/**
 * A small, dismissible "How to shop" guide. Auto-opens once for first-time
 * visitors (after the hero settles) so the buyer never feels lost, and stays
 * one tap away via a floating helper button. Designed to reduce the "I don't
 * know how to navigate / I'll ask for a manual order" drop-off.
 */
export function HowToShop() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = true;
    try {
      seen = Boolean(localStorage.getItem(STORAGE_KEY));
    } catch {
      /* private mode — just don't auto-open */
    }
    if (seen) return;
    const t = setTimeout(() => setOpen(true), 1400);
    return () => clearTimeout(t);
  }, []);

  function markSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function close() {
    setOpen(false);
    markSeen();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[88px] right-3 z-30 inline-flex items-center gap-1.5 rounded-full bg-[rgb(var(--accent-deep))] px-3.5 py-2 text-[12px] font-semibold text-[rgb(var(--bg))] shadow-[0_6px_18px_rgb(0_0_0/0.3)] transition hover:-translate-y-0.5 hover:brightness-110"
        aria-label="How to shop"
      >
        <HelpCircle className="h-4 w-4" />
        <span className="hidden sm:inline">How to shop</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] grid place-items-center p-4"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
              onClick={close}
            />
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="How to shop this sale"
              className="dropglass relative w-[min(460px,94vw)] rounded-2xl p-6"
            >
              <button
                type="button"
                onClick={close}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <h2 className="font-display text-[24px] leading-tight">
                How to shop the sale
              </h2>
              <p className="mt-1 text-[13px] text-[rgb(var(--text-muted))]">
                Four quick steps — you&apos;ll be done in minutes.
              </p>

              <ol className="mt-5 space-y-3.5">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-[rgb(var(--brand-accent)/0.18)] text-[rgb(var(--brand-accent))]">
                      <s.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold">
                        <span className="opacity-60">{i + 1}.</span> {s.title}
                      </div>
                      <div className="text-[12.5px] text-[rgb(var(--text-muted))] leading-snug">
                        {s.body}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgb(var(--brand-accent)/0.25)] bg-[rgb(var(--brand-accent)/0.08)] p-3 text-[12px] text-[rgb(var(--text-muted))]">
                <Package className="mt-0.5 h-4 w-4 flex-shrink-0 text-[rgb(var(--brand-accent))]" />
                <span>
                  <span className="font-semibold text-[rgb(var(--text))]">
                    Reseller or buying in bulk?
                  </span>{" "}
                  Open any wig and choose <em>Wholesale — raw wigs</em> to order
                  unstyled at trade prices. The bulk rate unlocks across all
                  styles in your cart.
                </span>
              </div>

              <button
                type="button"
                onClick={close}
                className="btn-cta cta-sheen mt-5 h-11 w-full rounded-xl font-semibold"
              >
                Got it — let&apos;s shop
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
