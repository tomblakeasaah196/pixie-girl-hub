"use client";

/**
 * Public sale-page product modal.
 *
 * Opens when the buyer taps any featured product card. Fetches the full
 * styled-product detail (gallery, long description, variants, head-size
 * guide + optional video) from `/api/public/sale/:slug/product/:styledId`
 * so the buyer never leaves the page.
 *
 * Variants: the buyer picks Size + Lace and the visible price recomputes
 * live (anchor + size premium + lace premium). The currency floater on the
 * page converts the ₦ figures into $ as usual, so this modal stays in NGN
 * tokens.
 *
 * The size guide section embeds a YouTube iframe when the brand's
 * Catalogue → Size guide has a `head_size_video_url` set; falls back to a
 * native `<video>` player for non-YouTube URLs; falls back to the markdown
 * guide alone when nothing else is configured.
 */

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Minus, Play, Plus, Ruler, ShoppingBag, Store, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import type { BulkTierConfig } from "@/lib/types";
import { money } from "@/lib/format";
import { SALE_RED } from "@/lib/deals";

interface ProductGalleryImage {
  url: string;
  alt_text: string | null;
  is_primary: boolean;
  display_order: number | null;
}

interface ProductVariant {
  variant_id: string;
  colour_name: string;
  colour_hex: string | null;
  colour_premium_ngn: number;
  size_code: string;
  size_label: string;
  size_premium_ngn: number;
  lace_code: string | null;
  lace_label: string | null;
  lace_premium_ngn: number;
  effective_price_ngn: number;
  is_default: boolean;
}

interface ProductSizeTier {
  size_code: string;
  label: string;
  premium_ngn: number;
  circumference_in: string | null;
  guidance_text: string | null;
}

interface ProductLaceSize {
  lace_code: string;
  label: string;
  premium_ngn: number;
}

interface ProductDetail {
  styled_id: string;
  name: string;
  slug: string;
  short_description: string | null;
  long_description: string | null;
  retail_price_ngn: number | null;
  anchor_price_ngn: number | null;
  gallery: ProductGalleryImage[];
  variants: ProductVariant[];
  size_tiers: ProductSizeTier[];
  lace_sizes: ProductLaceSize[];
  size_guide: {
    title: string;
    guide_md: string | null;
    video_url: string | null;
  } | null;
}

/**
 * Pulls the YouTube video id out of whatever the owner pasted into the
 * catalogue's "Head-size video" box: a share link (youtu.be/ID), a watch URL
 * (youtube.com/watch?v=ID), an embed URL (youtube.com/embed/ID), a Shorts URL,
 * OR a full `<iframe …>` embed snippet (we just read the src inside it).
 * Returns null for non-YouTube URLs so the caller falls back to a native
 * <video> player.
 */
function youtubeId(url: string): string | null {
  const m =
    url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    ) || url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? m[1] : null;
}

/**
 * Lazy "facade" YouTube player. We render a branded poster + play button and
 * only mount the real YouTube iframe AFTER the first click. Benefits:
 *  - The modal opens instantly (no heavy player on load).
 *  - We build the embed URL with `origin` set to the live page, which fixes
 *    the intermittent "Error 153 — video player configuration error" YouTube
 *    throws when it can't verify the embedding origin.
 *  - `youtube-nocookie.com` + `modestbranding` + `rel=0` keep it on-brand with
 *    minimal YouTube chrome; the view still counts on YouTube.
 *  - If the player ever fails, a quiet "Watch on YouTube" link is the escape
 *    hatch instead of a dead black box.
 */
function YouTubeFacade({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);

  // Built on demand so `origin` reflects the actual live domain (SSR-safe).
  const embedSrc = useMemo(() => {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const params = new URLSearchParams({
      autoplay: "1",
      rel: "0",
      modestbranding: "1",
      playsinline: "1",
      iv_load_policy: "3",
      ...(origin ? { origin } : {}),
    });
    return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
  }, [videoId]);

  // hqdefault always exists (unlike maxresdefault, which 404s to a grey card).
  const poster = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  if (playing) {
    return (
      <div className="mb-3">
        <div className="relative w-full aspect-video rounded-[10px] overflow-hidden border border-white/10 bg-black/50">
          <iframe
            src={embedSrc}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            className="absolute inset-0 w-full h-full"
          />
        </div>
        <a
          href={watchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-block text-[11px] opacity-50 hover:opacity-80 transition-opacity"
        >
          Trouble playing? Watch on YouTube ↗
        </a>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label="Play video"
      className="group relative block w-full aspect-video rounded-[10px] overflow-hidden border border-white/10 mb-3 bg-black/50"
    >
      {/* Plain <img> (not next/image) so we don't need i.ytimg.com in the
          next.config remotePatterns allowlist. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt={title}
        loading="lazy"
        className="absolute inset-0 w-full h-full object-cover"
      />
      <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/10" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid place-items-center w-16 h-16 rounded-full bg-[rgb(var(--accent-deep))] shadow-[0_8px_30px_rgba(0,0,0,0.45)] transition-transform duration-300 group-hover:scale-110">
          <Play
            className="w-6 h-6 text-[rgb(var(--text))] translate-x-0.5"
            fill="currentColor"
          />
        </span>
      </span>
    </button>
  );
}

export function ProductDetailModal({
  slug,
  styledId,
  open,
  onClose,
  bulkTiers,
}: {
  slug: string;
  styledId: string | null;
  open: boolean;
  onClose: () => void;
  /** Bulk tiers from the campaign — drives the wholesale gate for unstyled wigs. */
  bulkTiers?: BulkTierConfig[] | null;
}) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [lace, setLace] = useState<string | null>(null);
  const [unstyledQty, setUnstyledQty] = useState(1);

  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const cartItems = useCart((s) => s.items);

  // Reset state when the modal closes / styledId changes.
  useEffect(() => {
    if (!open || !styledId) {
      setProduct(null);
      setErr(null);
      setUnstyledQty(1);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/public/sale/${encodeURIComponent(slug)}/product/${encodeURIComponent(styledId)}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: ProductDetail };
        if (cancelled) return;
        setProduct(json.data);
        setSlide(0);
        const def =
          json.data.variants.find((v) => v.is_default) ||
          json.data.variants[0];
        setSize(def?.size_code ?? json.data.size_tiers[0]?.size_code ?? null);
        setLace(def?.lace_code ?? json.data.lace_sizes[0]?.lace_code ?? null);
      } catch (e) {
        if (!cancelled)
          setErr(
            (e as Error)?.message ||
              "Could not load this product. Please try again.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, slug, styledId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const effectivePrice = useMemo(() => {
    if (!product) return null;
    const sizeP =
      product.size_tiers.find((t) => t.size_code === size)?.premium_ngn ?? 0;
    const laceP =
      product.lace_sizes.find((l) => l.lace_code === lace)?.premium_ngn ?? 0;
    const anchor = Number(
      product.anchor_price_ngn ?? product.retail_price_ngn ?? 0,
    );
    if (!anchor) return null;
    return anchor + Number(sizeP) + Number(laceP);
  }, [product, size, lace]);

  const videoId = product?.size_guide?.video_url
    ? youtubeId(product.size_guide.video_url)
    : null;

  // The concrete styled variant for the chosen size/lace (default colour, as
  // there's no colour picker yet). Carries the styled_variant_id the checkout
  // needs to price from the styled tables.
  const selectedVariant = useMemo(() => {
    if (!product) return null;
    const matches = product.variants.filter(
      (v) =>
        v.size_code === size && (v.lace_code ?? null) === (lace ?? null),
    );
    return (
      matches.find((v) => v.is_default) ||
      matches[0] ||
      product.variants.find((v) => v.is_default) ||
      product.variants[0] ||
      null
    );
  }, [product, size, lace]);

  function handleAdd() {
    // Never add an unresolvable line: without a styled_variant_id the checkout
    // can't price it (it would 409 CART_ITEM_UNRESOLVED). Require a variant.
    if (!product || !selectedVariant?.variant_id) return;
    const price =
      Number(selectedVariant.effective_price_ngn) || effectivePrice || 0;
    if (!price) return;
    add({
      // Unique per styled variant so different size/colour are separate lines.
      id: `styled:${selectedVariant.variant_id}`,
      type: "styled",
      styled_variant_id: selectedVariant.variant_id,
      product_id: undefined,
      name: `${product.name} — ${selectedVariant.size_label}`,
      image_url: product.gallery[0]?.url,
      unit_price_ngn: price,
      retail_price_ngn: Number(product.retail_price_ngn || 0) || undefined,
      quantity: 1,
    });
    openCart();
    onClose();
  }

  // "Order unstyled / raw": the same wig WITHOUT styling, priced at the anchor
  // (no size/lace premiums). Flagged `unstyled` so the server prices it raw and
  // counts it toward the reseller/bulk tier. Kept as its own cart line.
  function handleAddUnstyled() {
    if (!product || !selectedVariant?.variant_id) return;
    const anchor = Number(
      product.anchor_price_ngn ?? product.retail_price_ngn ?? 0,
    );
    if (!anchor) return;
    add({
      id: `raw:${selectedVariant.variant_id}`,
      type: "styled",
      styled_variant_id: selectedVariant.variant_id,
      product_id: undefined,
      unstyled: true,
      name: `${product.name} — Unstyled`,
      image_url: product.gallery[0]?.url,
      unit_price_ngn: anchor,
      retail_price_ngn: Number(product.retail_price_ngn || 0) || undefined,
      quantity: unstyledQty,
    });
    openCart();
    onClose();
  }

  const anchorOnly = Number(
    product?.anchor_price_ngn ?? product?.retail_price_ngn ?? 0,
  );

  // Wholesale gate: sorted bulk tiers and current raw-wig count in cart
  const sortedBulkTiers = (bulkTiers || [])
    .filter((t) => t.min_qty > 0 && t.discount_per_item_ngn > 0)
    .sort((a, b) => a.min_qty - b.min_qty);
  const hasWholesale = sortedBulkTiers.length > 0 && anchorOnly > 0;
  const minBulkTier = sortedBulkTiers[0];
  // Count all unstyled wigs already in the cart (cross-product)
  const cartRawQty = cartItems
    .filter((i) => i.unstyled === true)
    .reduce((sum, i) => sum + i.quantity, 0);
  const totalRawWithStepper = cartRawQty + unstyledQty;
  // Find which tier applies at total raw qty
  const qualifyingTier = [...sortedBulkTiers]
    .reverse()
    .find((t) => totalRawWithStepper >= t.min_qty);
  const nextTier = sortedBulkTiers.find(
    (t) => totalRawWithStepper < t.min_qty,
  );
  const gateOpen =
    !hasWholesale || (minBulkTier != null && totalRawWithStepper >= minBulkTier.min_qty);

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
              {loading && !product && (
                <div className="grid place-items-center py-16 opacity-70">
                  Loading…
                </div>
              )}
              {err && !loading && (
                <div className="text-center py-12">{err}</div>
              )}

              {product && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-5">
                    <div>
                      <div className="relative w-full aspect-[4/5] rounded-[16px] overflow-hidden bg-black/20 border border-white/5">
                        <AnimatePresence initial={false} mode="popLayout">
                          {product.gallery[slide]?.url && (
                            <motion.div
                              key={`${product.gallery[slide].url}-${slide}`}
                              initial={{ opacity: 0, scale: 1.03 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.98 }}
                              transition={{
                                duration: 0.35,
                                ease: [0.22, 1, 0.36, 1],
                              }}
                              className="absolute inset-0"
                              style={{
                                backgroundImage: `url("${product.gallery[slide].url}")`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }}
                            />
                          )}
                        </AnimatePresence>
                      </div>
                      {product.gallery.length > 1 && (
                        <motion.div
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.05, duration: 0.3 }}
                          className="flex gap-2 mt-2 overflow-x-auto pb-1"
                        >
                          {product.gallery.map((g, i) => {
                            const active = i === slide;
                            return (
                              <motion.button
                                key={`${g.url}-${i}`}
                                type="button"
                                onClick={() => setSlide(i)}
                                aria-label={`Image ${i + 1}`}
                                aria-pressed={active}
                                whileHover={{ y: -2 }}
                                whileTap={{ scale: 0.96 }}
                                animate={{
                                  scale: active ? 1.06 : 1,
                                  opacity: active ? 1 : 0.75,
                                }}
                                transition={{
                                  duration: 0.25,
                                  ease: [0.22, 1, 0.36, 1],
                                }}
                                className={
                                  "relative shrink-0 w-16 h-20 rounded-[10px] overflow-hidden border " +
                                  (active
                                    ? "border-white shadow-[0_0_0_2px_rgba(255,255,255,0.15)]"
                                    : "border-white/15 hover:border-white/40")
                                }
                                style={{
                                  backgroundImage: `url("${g.url}")`,
                                  backgroundSize: "cover",
                                  backgroundPosition: "center",
                                }}
                              />
                            );
                          })}
                        </motion.div>
                      )}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="font-display text-[22px] leading-tight">
                          {product.name}
                        </div>
                        {product.short_description && (
                          <p className="text-[13px] opacity-75 mt-1.5">
                            {product.short_description}
                          </p>
                        )}
                      </div>

                      <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-4">
                        <div className="text-[11px] tracking-[0.2em] uppercase opacity-60 mb-1">
                          Price
                        </div>
                        <div className="font-display tabular-nums text-[26px] font-extrabold">
                          {effectivePrice != null ? money(effectivePrice) : "—"}
                        </div>
                        {(product.size_tiers.some((t) => t.premium_ngn > 0) ||
                          product.lace_sizes.some((l) => l.premium_ngn > 0)) && (
                          <div className="text-[11px] opacity-60 mt-1">
                            Base{" "}
                            {money(Number(product.anchor_price_ngn || 0))} +
                            selected size & lace
                          </div>
                        )}
                      </div>

                      {product.size_tiers.length > 0 && (
                        <div>
                          <div className="text-[11px] tracking-[0.2em] uppercase opacity-60 mb-2">
                            Size
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {product.size_tiers.map((t) => {
                              const active = t.size_code === size;
                              return (
                                <button
                                  key={t.size_code}
                                  type="button"
                                  onClick={() => setSize(t.size_code)}
                                  className={
                                    "px-3 py-2 rounded-[12px] border text-[12.5px] transition-colors " +
                                    (active
                                      ? "border-white bg-white/10"
                                      : "border-white/15 hover:border-white/40")
                                  }
                                >
                                  <div className="font-semibold">
                                    {t.size_code}
                                  </div>
                                  <div className="text-[10.5px] opacity-70">
                                    {t.label}
                                    {t.premium_ngn > 0 &&
                                      ` · +${money(t.premium_ngn)}`}
                                  </div>
                                  {t.circumference_in && (
                                    <div className="text-[10px] opacity-50 mt-0.5">
                                      {t.circumference_in}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {product.lace_sizes.length > 0 && (
                        <div>
                          <div className="text-[11px] tracking-[0.2em] uppercase opacity-60 mb-2">
                            Lace type
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {product.lace_sizes.map((l) => {
                              const active = l.lace_code === lace;
                              return (
                                <button
                                  key={l.lace_code}
                                  type="button"
                                  onClick={() => setLace(l.lace_code)}
                                  className={
                                    "px-3 py-2 rounded-[12px] border text-[12.5px] transition-colors " +
                                    (active
                                      ? "border-white bg-white/10"
                                      : "border-white/15 hover:border-white/40")
                                  }
                                >
                                  <span className="font-semibold">
                                    {l.label}
                                  </span>
                                  {l.premium_ngn > 0 && (
                                    <span className="text-[10.5px] opacity-70 ml-1.5">
                                      +{money(l.premium_ngn)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleAdd}
                        disabled={!effectivePrice}
                        className="w-full inline-flex items-center justify-center gap-2 h-12 rounded-xl bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] font-semibold cta-sheen disabled:opacity-40"
                      >
                        <ShoppingBag className="w-4 h-4" />
                        Add to bag
                      </button>
                      {/* Wholesale / unstyled gate */}
                      {anchorOnly > 0 && hasWholesale && (
                        <div className="rounded-[14px] border border-white/10 bg-white/[0.03] p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <Store
                              className="w-4 h-4 flex-shrink-0"
                              style={{ color: SALE_RED }}
                            />
                            <div
                              className="text-[13px] font-bold"
                              style={{ color: SALE_RED }}
                            >
                              Wholesale — raw wigs
                            </div>
                          </div>
                          <p className="text-[12px] text-[rgb(var(--text-muted))] leading-relaxed">
                            No styling, no branded luxury box. You receive the
                            raw wig exactly as it comes from the factory — for
                            professional stylists and resellers who finish the
                            wig themselves.
                          </p>

                          {/* Tier economics */}
                          <div className="space-y-1.5">
                            {sortedBulkTiers.map((t) => {
                              const active = totalRawWithStepper >= t.min_qty;
                              const nowPrice = anchorOnly - t.discount_per_item_ngn;
                              return (
                                <div
                                  key={t.min_qty}
                                  className="flex items-center justify-between rounded-xl px-3 py-2 text-[12px] border transition-colors"
                                  style={
                                    active
                                      ? {
                                          borderColor: `${SALE_RED}55`,
                                          background: `${SALE_RED}10`,
                                        }
                                      : { borderColor: "rgba(255,255,255,0.08)" }
                                  }
                                >
                                  <span className="text-[rgb(var(--text-muted))]">
                                    {t.min_qty}+ wigs
                                    {t.label ? ` · ${t.label}` : ""}
                                  </span>
                                  <span className="font-bold tabular-nums">
                                    {money(nowPrice)}{" "}
                                    <span
                                      className="font-normal text-[11px]"
                                      style={
                                        active ? { color: SALE_RED } : {}
                                      }
                                    >
                                      (save {money(t.discount_per_item_ngn)}/ea)
                                    </span>
                                  </span>
                                </div>
                              );
                            })}
                          </div>

                          {/* Progress toward gate */}
                          {minBulkTier && (
                            <div className="text-[11.5px] text-[rgb(var(--text-muted))] space-y-1">
                              {cartRawQty > 0 && (
                                <div>
                                  You already have {cartRawQty} raw wig
                                  {cartRawQty !== 1 ? "s" : ""} in your cart.
                                  All unstyled wigs across every style count
                                  together.
                                </div>
                              )}
                              {!gateOpen && nextTier && (
                                <div style={{ color: SALE_RED }}>
                                  Add{" "}
                                  {nextTier.min_qty - totalRawWithStepper} more
                                  to unlock the {money(nextTier.discount_per_item_ngn)}/wig
                                  rate.
                                </div>
                              )}
                              {qualifyingTier && gateOpen && (
                                <div style={{ color: "#16A34A" }}>
                                  ✓ Wholesale rate unlocked:{" "}
                                  {money(qualifyingTier.discount_per_item_ngn)}{" "}
                                  off each raw wig.
                                </div>
                              )}
                            </div>
                          )}

                          {/* Qty stepper */}
                          <div className="flex items-center gap-3">
                            <span className="text-[12px] text-[rgb(var(--text-faint))]">
                              Qty:
                            </span>
                            <div className="flex items-center gap-2 rounded-xl border border-white/10 px-2 py-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setUnstyledQty((q) => Math.max(1, q - 1))
                                }
                                className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10 transition-colors"
                                aria-label="Decrease qty"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="w-6 text-center text-[14px] font-bold tabular-nums">
                                {unstyledQty}
                              </span>
                              <button
                                type="button"
                                onClick={() => setUnstyledQty((q) => q + 1)}
                                className="w-7 h-7 grid place-items-center rounded-lg hover:bg-white/10 transition-colors"
                                aria-label="Increase qty"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="text-[11.5px] text-[rgb(var(--text-faint))]">
                              {cartRawQty > 0
                                ? `${totalRawWithStepper} total raw wigs`
                                : `${totalRawWithStepper} raw wig${totalRawWithStepper !== 1 ? "s" : ""}`}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={handleAddUnstyled}
                            disabled={!selectedVariant?.variant_id || !gateOpen}
                            className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border text-[13px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            style={
                              gateOpen
                                ? {
                                    borderColor: SALE_RED,
                                    color: SALE_RED,
                                    background: `${SALE_RED}10`,
                                  }
                                : { borderColor: "rgba(255,255,255,0.12)" }
                            }
                          >
                            {gateOpen
                              ? `Add ${unstyledQty} raw wig${unstyledQty !== 1 ? "s" : ""} to cart`
                              : `Need ${minBulkTier ? minBulkTier.min_qty - totalRawWithStepper : 0} more to unlock`}
                          </button>
                        </div>
                      )}
                      {/* No bulk tiers configured — show plain unstyled option */}
                      {anchorOnly > 0 && !hasWholesale && (
                        <button
                          type="button"
                          onClick={handleAddUnstyled}
                          disabled={!selectedVariant?.variant_id}
                          className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-xl border border-white/15 bg-white/[0.03] text-[rgb(var(--text))] text-[13px] font-medium hover:bg-white/[0.07] disabled:opacity-40"
                        >
                          Order unstyled · {money(anchorOnly)}
                        </button>
                      )}
                    </div>
                  </div>

                  {product.long_description && (
                    <div>
                      <div className="text-[11px] tracking-[0.2em] uppercase opacity-60 mb-1.5">
                        Details
                      </div>
                      <p className="text-[13.5px] opacity-85 leading-relaxed whitespace-pre-line">
                        {product.long_description}
                      </p>
                    </div>
                  )}

                  {product.size_guide &&
                    (product.size_guide.guide_md ||
                      product.size_guide.video_url) && (
                      <div className="rounded-[14px] border border-white/10 bg-white/[0.04] p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <Ruler className="w-4 h-4" />
                          <h3 className="font-display text-[15px]">
                            {product.size_guide.title}
                          </h3>
                        </div>
                        {videoId && (
                          <YouTubeFacade
                            videoId={videoId}
                            title={product.size_guide.title || "Head size guide"}
                          />
                        )}
                        {!videoId && product.size_guide.video_url && (
                          <video
                            src={product.size_guide.video_url}
                            controls
                            className="w-full rounded-[10px] mb-3 max-h-[420px] bg-black/50"
                          />
                        )}
                        {product.size_guide.guide_md && (
                          <div className="text-[13px] opacity-85 leading-relaxed whitespace-pre-line">
                            {product.size_guide.guide_md}
                          </div>
                        )}
                        {!product.size_guide.guide_md && videoId && (
                          <p className="text-[11.5px] opacity-60 flex items-center gap-1.5">
                            <Play className="w-3 h-3" /> Watch the brand's
                            how-to above.
                          </p>
                        )}
                      </div>
                    )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
