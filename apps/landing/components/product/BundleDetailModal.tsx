"use client";

/**
 * Public sale-page bundle modal.
 *
 * Opens when the buyer taps a bundle card. Mirrors the ProductDetailModal so the
 * two feel like one design: a hero image with a thumbnail GALLERY on the left
 * (the bundle hero + every component wig's photo), and the detail on the right —
 * description, the component breakdown with live per-item prices, the
 * sum-of-parts vs bundle price, the savings, and the CTA.
 *
 * Everything rides along in the landing payload (campaigns.bundles.service
 * .listCampaignBundles enriches each bundle with `components` + live math), so
 * the modal needs no extra fetch.
 *
 * Prices stay in NGN tokens; the page-level currency floater converts to $.
 */

import { useEffect, useMemo, useState } from "react";
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
  const [slide, setSlide] = useState(0);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset to the first image whenever the modal (re)opens.
  useEffect(() => {
    if (open) setSlide(0);
  }, [open, bundle.bundle_id]);

  const components = useMemo(() => bundle.components || [], [bundle.components]);

  // The gallery = the bundle hero followed by each component's photo, in order,
  // de-duplicated (the hero often resolves to the first component's image).
  const gallery = useMemo(() => {
    const urls: string[] = [];
    const push = (u?: string | null) => {
      if (u && !urls.includes(u)) urls.push(u);
    };
    push(bundle.bundle_hero_image_url);
    for (const c of components) push(c.hero_image_url);
    return urls;
  }, [bundle.bundle_hero_image_url, components]);

  const canBuy = state === "live" && (!stockOut || bundle.preorder_enabled);
  const pieces = components.length || bundle.component_count || 0;
  const activeImage = gallery[slide] ?? gallery[0] ?? null;

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
            className="relative dropglass rounded-2xl w-[min(1100px,96vw)] max-h-[calc(100dvh-2rem)] flex flex-col"
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
              <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-5">
                {/* Hero gallery — mirrors the product modal */}
                <div>
                  <div className="relative w-full aspect-[4/5] rounded-[16px] overflow-hidden bg-black/20 border border-white/5">
                    <AnimatePresence initial={false} mode="popLayout">
                      {activeImage ? (
                        <motion.div
                          key={`${activeImage}-${slide}`}
                          initial={{ opacity: 0, scale: 1.03 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                          className="absolute inset-0"
                          style={{
                            backgroundImage: `url("${activeImage}")`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }}
                        />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-[rgb(var(--text-faint))]">
                          <Package className="w-12 h-12" />
                        </div>
                      )}
                    </AnimatePresence>
                    <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] bg-[rgb(0_0_0/0.55)] text-[rgb(var(--text))] backdrop-blur">
                      <Package className="w-3 h-3" />
                      {pieces} piece{pieces !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {gallery.length > 1 && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05, duration: 0.3 }}
                      className="flex gap-2 mt-2 overflow-x-auto pb-1"
                    >
                      {gallery.map((url, i) => {
                        const active = i === slide;
                        return (
                          <motion.button
                            key={`${url}-${i}`}
                            type="button"
                            onClick={() => setSlide(i)}
                            aria-label={`Image ${i + 1}`}
                            aria-pressed={active}
                            whileHover={{ y: -2 }}
                            whileTap={{ scale: 0.96 }}
                            animate={{ scale: active ? 1.06 : 1, opacity: active ? 1 : 0.75 }}
                            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                            className={
                              "relative shrink-0 w-16 h-20 rounded-[10px] overflow-hidden border " +
                              (active
                                ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.15)]"
                                : "border-white/15 hover:border-white/40")
                            }
                            style={{
                              backgroundImage: `url("${url}")`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }}
                          />
                        );
                      })}
                    </motion.div>
                  )}
                </div>

                {/* Detail */}
                <div className="space-y-4">
                  <div>
                    <h2 className="font-display text-[22px] md:text-[26px] leading-tight">
                      {bundle.bundle_name}
                    </h2>
                    {bundle.description && (
                      <p className="mt-1.5 text-[13px] leading-relaxed text-[rgb(var(--text-muted))] whitespace-pre-line">
                        {bundle.description}
                      </p>
                    )}
                  </div>

                  {/* Component wigs */}
                  <div>
                    <div className="text-[11px] tracking-[0.2em] uppercase opacity-60 mb-2">
                      In this bundle
                    </div>
                    <ul className="space-y-2.5">
                      {components.map((c, i) => (
                        <motion.li
                          key={c.bundle_item_id}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.04 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          className="flex items-center gap-3 rounded-[12px] p-2 bg-white/[0.03] border border-white/5"
                        >
                          <div
                            className="relative shrink-0 w-12 h-14 rounded-[8px] overflow-hidden bg-black/20"
                            style={
                              c.hero_image_url
                                ? {
                                    backgroundImage: `url("${c.hero_image_url}")`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }
                                : undefined
                            }
                          >
                            {!c.hero_image_url && (
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
                  <div className="rounded-[14px] p-4 bg-white/[0.04] border border-white/10">
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
                      <span className="font-display text-[26px] tabular-nums font-extrabold">
                        {state === "live" ? money(finalPrice) : "Reveals at launch"}
                      </span>
                    </div>
                    {savings > 0 && state === "live" && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-[rgb(var(--success))] font-medium">
                        <Check className="w-3.5 h-3.5" /> You save {money(savings)}
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
                    className="btn-cta w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl font-semibold cta-sheen disabled:opacity-50 disabled:cursor-not-allowed"
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
