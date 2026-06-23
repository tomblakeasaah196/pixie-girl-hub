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
import { Play, Ruler, ShoppingBag, X } from "lucide-react";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";

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

function youtubeEmbed(url: string): string | null {
  const m =
    url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    ) || url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m
    ? `https://www.youtube.com/embed/${m[1]}?rel=0&modestbranding=1`
    : null;
}

export function ProductDetailModal({
  slug,
  styledId,
  open,
  onClose,
}: {
  slug: string;
  styledId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [lace, setLace] = useState<string | null>(null);

  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);

  // Reset state when the modal closes / styledId changes.
  useEffect(() => {
    if (!open || !styledId) {
      setProduct(null);
      setErr(null);
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

  const embed = product?.size_guide?.video_url
    ? youtubeEmbed(product.size_guide.video_url)
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
    if (!product) return;
    // Prefer the resolved variant's price; fall back to the computed price.
    const price = selectedVariant
      ? Number(selectedVariant.effective_price_ngn)
      : effectivePrice;
    if (!price) return;
    add({
      // Unique per styled variant so different size/colour are separate lines.
      id: selectedVariant
        ? `styled:${selectedVariant.variant_id}`
        : product.styled_id,
      type: "styled",
      styled_variant_id: selectedVariant?.variant_id,
      product_id: undefined,
      name: selectedVariant
        ? `${product.name} — ${selectedVariant.size_label}`
        : product.name,
      image_url: product.gallery[0]?.url,
      unit_price_ngn: price,
      retail_price_ngn: Number(product.retail_price_ngn || 0) || undefined,
      quantity: 1,
    });
    openCart();
    onClose();
  }

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
                      <div
                        className="relative w-full aspect-[4/5] rounded-[16px] overflow-hidden bg-black/20 border border-white/5"
                        style={
                          product.gallery[slide]?.url
                            ? {
                                backgroundImage: `url("${product.gallery[slide].url}")`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }
                            : undefined
                        }
                      />
                      {product.gallery.length > 1 && (
                        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
                          {product.gallery.map((g, i) => (
                            <button
                              key={`${g.url}-${i}`}
                              type="button"
                              onClick={() => setSlide(i)}
                              aria-label={`Image ${i + 1}`}
                              className={
                                "relative shrink-0 w-16 h-20 rounded-[10px] overflow-hidden border transition-colors " +
                                (i === slide
                                  ? "border-white"
                                  : "border-white/15 hover:border-white/40")
                              }
                              style={{
                                backgroundImage: `url("${g.url}")`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }}
                            />
                          ))}
                        </div>
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
                        <div className="text-[11px] opacity-60 mt-1">
                          Anchor{" "}
                          {money(Number(product.anchor_price_ngn || 0))} + size
                          & lace premiums
                        </div>
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
                        {embed && (
                          <div className="relative w-full aspect-video rounded-[10px] overflow-hidden border border-white/10 mb-3 bg-black/50">
                            <iframe
                              src={embed}
                              title="Head size guide"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="absolute inset-0 w-full h-full"
                            />
                          </div>
                        )}
                        {!embed && product.size_guide.video_url && (
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
                        {!product.size_guide.guide_md && embed && (
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
