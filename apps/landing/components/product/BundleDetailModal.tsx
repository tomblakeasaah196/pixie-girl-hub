"use client";

/**
 * Public sale-page bundle modal.
 *
 * Opens when the buyer taps a bundle card. Shows the bundle's hero image,
 * description, and the full component breakdown — every wig in the set with its
 * own photo, quantity and live price — alongside the sum-of-parts total, the
 * discounted bundle price and the savings. All of this rides along in the
 * landing payload (campaigns.bundles.service.listCampaignBundles enriches each
 * bundle with `components` + live math), so the modal needs no extra fetch.
 *
 * Prices stay in NGN tokens; the page-level currency floater converts to $.
 */

import { useEffect } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, Package, ShoppingBag, X } from "lucide-react";
import type { LandingBundle } from "@/lib/types";
import { money } from "@/lib/format";

export function BundleDetailModal({
  bundle,
  open,
  onClose,
  onAdd,
  finalPrice,
  retailTotal,
  savings,
  state,
  stockOut,
  preorderLeadWeeks,
}: {
  bundle: LandingBundle;
  open: boolean;
  onClose: () => void;
  onAdd: () => void;
  finalPrice: number;
  retailTotal: number | null;
  savings: number;
  state: "before" | "live" | "ended";
  stockOut: boolean;
  preorderLeadWeeks: number;
}) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const components = bundle.components || [];
  const canBuy = state === "live" && (!stockOut || bundle.preorder_enabled);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] grid place-items-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 30, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={bundle.bundle_name}
            className="relative dropglass rounded-2xl w-[min(1000px,96vw)] max-h-[calc(100dvh-2rem)] flex flex-col"
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 z-10 grid place-items-center w-9 h-9 rounded-xl hover:bg-white/10"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="p-5 md:p-7 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-[1.05fr_1fr] gap-6">
                {/* Hero + composition */}
                <div>
                  <div className="relative w-full aspect-[4/5] rounded-[16px] overflow-hidden bg-black/20 border border-white/5">
                    {bundle.bundle_hero_image_url ? (
                      <Image
                        src={bundle.bundle_hero_image_url}
                        alt={bundle.bundle_name}
                        fill
                        sizes="(min-width: 768px) 520px, 100vw"
                        className="object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center text-[rgb(var(--text-faint))]">
                        <Package className="w-12 h-12" />
                      </div>
                    )}
                    <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] bg-[rgb(0_0_0/0.55)] text-[rgb(var(--text))] backdrop-blur">
                      <Package className="w-3 h-3" />
                      {components.length || bundle.component_count || 0} piece
                      {(components.length || bundle.component_count || 0) !== 1
                        ? "s"
                        : ""}
                    </span>
                  </div>
                </div>

                {/* Detail */}
                <div className="flex flex-col">
                  <h2 className="font-display text-[26px] md:text-[30px] leading-tight">
                    {bundle.bundle_name}
                  </h2>
                  {bundle.description && (
                    <p className="mt-3 text-[14px] leading-relaxed text-[rgb(var(--text-muted))] whitespace-pre-line">
                      {bundle.description}
                    </p>
                  )}

                  {/* Component wigs */}
                  <div className="mt-5">
                    <div className="micro mb-3">In this bundle</div>
                    <ul className="space-y-2.5">
                      {components.map((c, i) => (
                        <motion.li
                          key={c.bundle_item_id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{
                            delay: 0.04 * i,
                            duration: 0.3,
                            ease: [0.22, 1, 0.36, 1],
                          }}
                          className="flex items-center gap-3 rounded-[12px] p-2 bg-white/[0.03] border border-white/5"
                        >
                          <div className="relative shrink-0 w-12 h-14 rounded-[8px] overflow-hidden bg-black/20">
                            {c.hero_image_url ? (
                              <Image
                                src={c.hero_image_url}
                                alt={c.display_name}
                                fill
                                sizes="48px"
                                className="object-cover"
                              />
                            ) : (
                              <div className="absolute inset-0 grid place-items-center text-[rgb(var(--text-faint))]">
                                <Package className="w-4 h-4" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13.5px] font-medium truncate">
                              {c.display_name}
                            </div>
                            <div className="text-[12px] text-[rgb(var(--text-faint))] tabular-nums">
                              {c.quantity > 1 ? `${c.quantity} × ` : ""}
                              {money(c.unit_price_ngn)}
                            </div>
                          </div>
                          <div className="font-mono text-[13px] tabular-nums shrink-0">
                            {money(c.line_total_ngn)}
                          </div>
                        </motion.li>
                      ))}
                    </ul>
                  </div>

                  {/* Pricing */}
                  <div className="mt-5 rounded-[14px] p-4 bg-white/[0.03] border border-white/5">
                    {retailTotal != null && retailTotal > finalPrice && (
                      <div className="flex items-center justify-between text-[13px] text-[rgb(var(--text-muted))]">
                        <span>Sum of parts</span>
                        <span className="font-mono line-through">
                          {money(retailTotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-end justify-between mt-1.5">
                      <span className="text-[13px] text-[rgb(var(--text-muted))]">
                        Bundle price
                      </span>
                      <span className="font-display text-[26px] tabular-nums">
                        {state === "live" ? money(finalPrice) : "Reveals at launch"}
                      </span>
                    </div>
                    {savings > 0 && state === "live" && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-[rgb(var(--success))] font-medium">
                        <Check className="w-3.5 h-3.5" /> You save{" "}
                        {money(savings)}
                      </div>
                    )}
                    {stockOut && bundle.preorder_enabled && state === "live" && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] text-[rgb(var(--warn))]">
                        <Clock className="w-3.5 h-3.5" /> Out of stock — pre-order
                        ships in {preorderLeadWeeks} weeks
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      onAdd();
                      onClose();
                    }}
                    disabled={!canBuy}
                    className={
                      "mt-5 inline-flex items-center justify-center gap-2 h-12 rounded-xl font-semibold cta-sheen disabled:opacity-50 disabled:cursor-not-allowed " +
                      (canBuy
                        ? "bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]"
                        : "bg-[rgb(var(--text)/0.06)] text-[rgb(var(--text-muted))]")
                    }
                  >
                    <ShoppingBag className="w-4 h-4" />
                    {state !== "live"
                      ? state === "before"
                        ? "Available when doors open"
                        : "Sale ended"
                      : stockOut && bundle.preorder_enabled
                        ? "Pre-order now"
                        : `Add bundle · ${money(finalPrice)}`}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
