/**
 * Public sale-page product modal.
 *
 * Opens when the buyer clicks any featured product on the landing page.
 * Pulls the full styled-product detail (gallery, long description, variants,
 * size guide + video) from the public /sale/:slug/product/:styled_id
 * endpoint so the buyer never has to leave the campaign page.
 *
 * Currency follows the campaign's static FX toggle (₦↔$) via the shared
 * currency store — every price in the modal flips with the floater.
 * Variant pricing is computed as `anchor + size_premium + lace_premium`
 * (colour premium is already baked into the variant's effective_price) so
 * the price ticks up live as the buyer picks Size and Lace.
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, Play, Ruler } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useProductDetail } from "@/lib/campaigns";
import { formatPrice, useCurrencyStore } from "@/lib/currency";

/** YouTube URL → embed src. Handles youtu.be, /watch?v=, /shorts/, /embed/. */
function youtubeEmbed(url: string): string | null {
  const m =
    url.match(
      /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
    ) || url.match(/[?&]v=([A-Za-z0-9_-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}?rel=0&modestbranding=1` : null;
}

export function ProductDetailModal({
  slug,
  styledId,
  fxRate,
  brand,
  onClose,
}: {
  slug: string | undefined;
  styledId: string | null;
  fxRate: number | null;
  brand?: string;
  onClose: () => void;
}) {
  const q = useProductDetail(slug, styledId, brand);
  const product = q.data;
  const currency = useCurrencyStore((s) => s.currency);

  // Active gallery slide + variant pickers.
  const [slide, setSlide] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const [lace, setLace] = useState<string | null>(null);

  // Seed defaults from the payload (first variant / first size / first lace
  // so the price isn't blank on open).
  useEffect(() => {
    if (!product) return;
    setSlide(0);
    const def = product.variants.find((v) => v.is_default) || product.variants[0];
    setSize(def?.size_code ?? product.size_tiers[0]?.size_code ?? null);
    setLace(def?.lace_code ?? product.lace_sizes[0]?.lace_code ?? null);
  }, [product]);

  // Effective price = anchor + size premium + lace premium. Colour is held
  // constant on the variant we resolved against (the default colour).
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

  const priceLabel = (n: number | null) =>
    n == null ? "—" : (formatPrice(n, currency, fxRate) ?? "—");

  const embed = product?.size_guide?.video_url
    ? youtubeEmbed(product.size_guide.video_url)
    : null;

  return (
    <Modal
      open={Boolean(styledId)}
      onClose={onClose}
      size="xl"
      title={product?.name || "Loading…"}
    >
      {q.isLoading && (
        <div className="grid place-items-center py-16 text-[rgb(var(--text-muted))]">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      )}

      {!q.isLoading && product && (
        <div className="space-y-5">
          {/* ── Gallery + summary ───────────────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-[1.1fr_1fr] gap-5">
            <div>
              <div
                className="relative w-full aspect-[4/5] rounded-[16px] overflow-hidden bg-text-primary/[0.05] border border-line"
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
                      className={`relative shrink-0 w-16 h-20 rounded-[10px] overflow-hidden border transition-colors ${
                        i === slide
                          ? "border-[rgb(var(--accent))]"
                          : "border-line hover:border-[rgb(var(--accent)/0.5)]"
                      }`}
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
                  <p className="text-[13px] text-text-muted mt-1.5">
                    {product.short_description}
                  </p>
                )}
              </div>

              {/* Live price ladder reflecting the current size + lace pick. */}
              <div className="rounded-[14px] border border-line bg-text-primary/[0.03] p-4">
                <div className="text-[11px] tracking-[0.2em] uppercase text-text-faint mb-1">
                  Price
                </div>
                <div className="font-mono tabular-nums text-[26px] font-extrabold text-accent-glow">
                  {priceLabel(effectivePrice)}
                </div>
                <div className="text-[11px] text-text-faint mt-1">
                  Anchor {priceLabel(Number(product.anchor_price_ngn || 0))}{" "}
                  + size & lace premiums
                </div>
              </div>

              {/* Size picker — premium is layered onto the price live. */}
              {product.size_tiers.length > 0 && (
                <div>
                  <div className="text-[11px] tracking-[0.2em] uppercase text-text-faint mb-2">
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
                          className={`px-3 py-2 rounded-[12px] border text-[12.5px] transition-colors ${
                            active
                              ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent-glow))]"
                              : "border-line hover:border-[rgb(var(--accent)/0.45)]"
                          }`}
                        >
                          <div className="font-semibold">{t.size_code}</div>
                          <div className="text-[10.5px] text-text-faint">
                            {t.label}
                            {t.premium_ngn > 0 &&
                              ` · +${priceLabel(t.premium_ngn)}`}
                          </div>
                          {t.circumference_in && (
                            <div className="text-[10px] text-text-faint mt-0.5">
                              {t.circumference_in}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Lace picker. */}
              {product.lace_sizes.length > 0 && (
                <div>
                  <div className="text-[11px] tracking-[0.2em] uppercase text-text-faint mb-2">
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
                          className={`px-3 py-2 rounded-[12px] border text-[12.5px] transition-colors ${
                            active
                              ? "border-[rgb(var(--accent))] bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent-glow))]"
                              : "border-line hover:border-[rgb(var(--accent)/0.45)]"
                          }`}
                        >
                          <span className="font-semibold">{l.label}</span>
                          {l.premium_ngn > 0 && (
                            <span className="text-[10.5px] text-text-faint ml-1.5">
                              +{priceLabel(l.premium_ngn)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Long description ──────────────────────────── */}
          {product.long_description && (
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-text-faint mb-1.5">
                Details
              </div>
              <p className="text-[13.5px] text-text-muted leading-relaxed whitespace-pre-line">
                {product.long_description}
              </p>
            </div>
          )}

          {/* ── Head-size guide + optional video embed ────── */}
          {product.size_guide &&
            (product.size_guide.guide_md || product.size_guide.video_url) && (
              <div className="rounded-[14px] border border-line bg-text-primary/[0.03] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Ruler className="w-4 h-4 text-accent-glow" />
                  <h3 className="font-display text-[15px]">
                    {product.size_guide.title}
                  </h3>
                </div>
                {embed && (
                  <div className="relative w-full aspect-video rounded-[10px] overflow-hidden border border-line mb-3 bg-black/50">
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
                  /* Non-YouTube URL — show a native player. */
                  <video
                    src={product.size_guide.video_url}
                    controls
                    className="w-full rounded-[10px] mb-3 max-h-[420px] bg-black/50"
                  />
                )}
                {product.size_guide.guide_md && (
                  <div className="text-[13px] text-text-muted leading-relaxed whitespace-pre-line">
                    {product.size_guide.guide_md}
                  </div>
                )}
                {!product.size_guide.guide_md && embed && (
                  <p className="text-[11.5px] text-text-faint flex items-center gap-1.5">
                    <Play className="w-3 h-3" />
                    Watch the brand's how-to above.
                  </p>
                )}
              </div>
            )}
        </div>
      )}

      {q.isError && !q.isLoading && (
        <div className="text-center py-10 text-text-muted">
          Could not load this product. Please try again.
        </div>
      )}
    </Modal>
  );
}
