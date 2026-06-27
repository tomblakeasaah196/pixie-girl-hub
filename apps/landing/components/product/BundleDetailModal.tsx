"use client";

/**
 * Public sale-page bundle modal — immersive cinematic rebuild.
 *
 * A buyer about to spend ~$3,000 deserves a flagship moment, and 90% of them
 * are on a phone. So:
 *   • Mobile: a full-screen experience. A cinematic, swipeable hero (the
 *     bundle collage + every component photo) fills the top; a glass detail
 *     sheet rises over it; and the price + Add-to-cart live in a STICKY bar
 *     pinned to the bottom (safe-area aware) — always one thumb-tap away, never
 *     buried at the end of a long scroll.
 *   • Desktop: a centered split — full-bleed hero left, scrolling detail right,
 *     CTA pinned to the column.
 *
 * Body scroll is locked while open (the page no longer scrolls behind it).
 * Prices stay in NGN tokens; the page-level currency floater converts to $.
 */

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Package,
  ShoppingBag,
  X,
} from "lucide-react";
import type { LandingBundle } from "@/lib/types";
import { money } from "@/lib/format";
import { fbTrack } from "@/lib/fbpixel";

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

  // Lock body scroll + close on Escape while open. Restoring the prior overflow
  // (not hard-coding "") respects any value an outer overlay already set.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (open) setSlide(0);
  }, [open, bundle.bundle_id]);

  // Meta Pixel: ViewContent for the bundle, once each time it's opened.
  useEffect(() => {
    if (!open) return;
    fbTrack("ViewContent", {
      content_type: "product",
      content_ids: [bundle.bundle_id],
      content_name: bundle.bundle_name,
      value: finalPrice,
      currency: "NGN",
    });
  }, [open, bundle.bundle_id, bundle.bundle_name, finalPrice]);

  const components = useMemo(() => bundle.components || [], [bundle.components]);

  // Gallery = the bundle hero followed by each component photo, de-duplicated
  // (the hero often resolves to the first component's image).
  const gallery = useMemo(() => {
    const urls: string[] = [];
    const push = (u?: string | null) => {
      if (u && !urls.includes(u)) urls.push(u);
    };
    push(bundle.bundle_hero_image_url);
    for (const c of components) push(c.hero_image_url);
    return urls;
  }, [bundle.bundle_hero_image_url, components]);

  const pieces = components.length || bundle.component_count || 0;
  const canBuy = state === "live" && (!stockOut || bundle.preorder_enabled);
  const count = gallery.length;
  const active = gallery[slide] ?? gallery[0] ?? null;
  const go = (dir: 1 | -1) =>
    setSlide((s) => (count ? (s + dir + count) % count : 0));
  const onDragEnd = (_e: unknown, info: PanInfo) => {
    if (count < 2) return;
    if (info.offset.x < -60) go(1);
    else if (info.offset.x > 60) go(-1);
  };

  const addLabel =
    state !== "live"
      ? state === "before"
        ? "Available when doors open"
        : "Sale ended"
      : stockOut && bundle.preorder_enabled
        ? "Pre-order now"
        : `Add bundle · ${money(finalPrice)}`;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex md:items-center md:justify-center md:p-6"
        >
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-[6px]"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 26, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 26, opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label={bundle.bundle_name}
            className="relative z-[1] w-full h-[100dvh] md:h-[min(860px,88vh)] md:w-[min(1080px,94vw)] md:rounded-[28px] overflow-hidden flex flex-col md:grid md:grid-cols-[1.04fr_1fr] bg-[rgb(var(--bg))] shadow-[0_40px_120px_rgb(0_0_0/0.6)]"
          >
            {/* ── Cinematic hero (swipeable) ── */}
            <div className="relative w-full h-[52dvh] md:h-full md:min-h-[560px] bg-black overflow-hidden">
              <motion.div
                drag={count > 1 ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.16}
                onDragEnd={onDragEnd}
                className="absolute inset-0 touch-pan-y"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {active ? (
                    <motion.div
                      key={`${active}-${slide}`}
                      initial={{ opacity: 0, scale: 1.05 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.99 }}
                      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                      className="absolute inset-0"
                    >
                      <Image
                        src={active}
                        alt={bundle.bundle_name}
                        fill
                        priority
                        sizes="(min-width: 768px) 560px, 100vw"
                        className="object-cover pointer-events-none select-none"
                        draggable={false}
                      />
                    </motion.div>
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-[rgb(var(--text-faint))]">
                      <Package className="w-14 h-14" />
                    </div>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Cinematic scrims + a blend into the detail sheet on mobile. */}
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/45 via-transparent to-black/25" />
              <div className="md:hidden absolute bottom-0 inset-x-0 h-28 bg-gradient-to-t from-[rgb(var(--bg))] to-transparent pointer-events-none" />

              {/* Piece badge */}
              <span className="absolute top-4 left-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] bg-[rgb(0_0_0/0.5)] text-white backdrop-blur">
                <Package className="w-3 h-3" />
                {pieces} piece{pieces !== 1 ? "s" : ""}
              </span>

              {/* Savings badge */}
              {savings > 0 && state === "live" && (
                <span className="absolute top-4 right-16 md:right-4 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold text-white bg-[rgb(var(--accent-deep))] shadow-[0_2px_10px_rgb(0_0_0/0.35)]">
                  Save {money(savings)}
                </span>
              )}

              {/* Close (mobile, over the hero) */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="md:hidden absolute top-3 right-3 grid place-items-center w-9 h-9 rounded-full bg-[rgb(0_0_0/0.45)] text-white backdrop-blur hover:bg-[rgb(0_0_0/0.65)]"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Desktop arrows + dots */}
              {count > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    aria-label="Previous image"
                    className="hidden md:grid place-items-center absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[rgb(0_0_0/0.4)] text-white backdrop-blur hover:bg-[rgb(0_0_0/0.6)]"
                  >
                    <ChevronLeft className="w-5 h-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    aria-label="Next image"
                    className="hidden md:grid place-items-center absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-[rgb(0_0_0/0.4)] text-white backdrop-blur hover:bg-[rgb(0_0_0/0.6)]"
                  >
                    <ChevronRight className="w-5 h-5" />
                  </button>
                  <div className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-1.5">
                    {gallery.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSlide(i)}
                        aria-label={`Image ${i + 1}`}
                        className={
                          "h-1.5 rounded-full transition-all " +
                          (i === slide
                            ? "w-5 bg-white"
                            : "w-1.5 bg-white/50 hover:bg-white/80")
                        }
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* ── Detail ── */}
            <div className="relative flex flex-col min-h-0 flex-1 md:h-full">
              {/* Close (desktop) */}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="hidden md:grid place-items-center absolute top-3 right-3 z-10 w-9 h-9 rounded-xl text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] hover:bg-[rgb(var(--text)/0.06)]"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex-1 overflow-y-auto -mt-7 md:mt-0 rounded-t-[28px] md:rounded-none bg-[rgb(var(--bg))] px-5 pt-5 pb-6 md:px-7 md:pt-9 relative z-[2]">
                {/* Mobile grab handle */}
                <div className="md:hidden w-10 h-1 rounded-full bg-[rgb(var(--text)/0.18)] mx-auto mb-4" />

                <h2 className="font-display text-[24px] md:text-[30px] leading-[1.1]">
                  {bundle.bundle_name}
                </h2>
                {bundle.description && (
                  <p className="mt-2 text-[13.5px] leading-relaxed text-[rgb(var(--text-muted))] whitespace-pre-line">
                    {bundle.description}
                  </p>
                )}

                {/* Price story */}
                <div className="mt-5 rounded-[16px] p-4 bg-[rgb(var(--text)/0.04)] border border-[rgb(var(--border-c)/0.1)]">
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
                    <span className="font-display text-[28px] tabular-nums font-extrabold leading-none">
                      {state === "live" ? money(finalPrice) : "Reveals at launch"}
                    </span>
                  </div>
                  {savings > 0 && state === "live" && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-[13px] text-[rgb(var(--success))] font-semibold">
                      <Check className="w-4 h-4" /> You save {money(savings)}
                    </div>
                  )}
                  {stockOut && bundle.preorder_enabled && state === "live" && (
                    <div className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-[rgb(var(--warn))]">
                      <Clock className="w-3.5 h-3.5" /> Out of stock — pre-order
                      ships in {preorderLeadWeeks} weeks
                    </div>
                  )}
                </div>

                {/* Components */}
                <div className="mt-6">
                  <div className="text-[11px] tracking-[0.2em] uppercase opacity-60 mb-3">
                    In this bundle · {pieces} piece{pieces !== 1 ? "s" : ""}
                  </div>
                  <ul className="space-y-2.5">
                    {components.map((c, i) => (
                      <motion.li
                        key={c.bundle_item_id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          delay: 0.03 * i,
                          duration: 0.3,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        className="flex items-center gap-3 rounded-[14px] p-2 bg-[rgb(var(--text)/0.03)] border border-[rgb(var(--border-c)/0.08)]"
                      >
                        <div className="relative shrink-0 w-12 h-16 rounded-[10px] overflow-hidden bg-black/20">
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
              </div>

              {/* Sticky CTA bar — always reachable, safe-area aware */}
              <div className="shrink-0 border-t border-[rgb(var(--border-c)/0.12)] bg-[rgb(var(--bg)/0.92)] backdrop-blur px-5 md:px-7 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                {state === "live" && (
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-[rgb(var(--text-faint))]">
                        Bundle price
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-[22px] tabular-nums font-extrabold leading-none">
                          {money(finalPrice)}
                        </span>
                        {retailTotal != null && retailTotal > finalPrice && (
                          <span className="font-mono text-[12px] text-[rgb(var(--text-faint))] line-through">
                            {money(retailTotal)}
                          </span>
                        )}
                      </div>
                    </div>
                    {savings > 0 && (
                      <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgb(var(--success)/0.15)] text-[rgb(var(--success))]">
                        Save {money(savings)}
                      </span>
                    )}
                  </div>
                )}
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
                  {addLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
