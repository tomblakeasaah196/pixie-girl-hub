"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Clock, ShoppingBag } from "lucide-react";
import type { LandingPayload, LandingProduct } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { SectionHeader } from "./BundleShowcase";
import { ProductDetailModal } from "../product/ProductDetailModal";

export function FeaturedProducts({
  payload,
  state,
}: {
  payload: LandingPayload;
  state: "before" | "live" | "ended";
}) {
  const products = (payload.products || []).filter(Boolean);
  // Single modal instance for every card — the active styled_id drives what
  // the modal fetches. Lifting this here means a card click never re-mounts
  // a modal per product (which was wasting transitions).
  const [openId, setOpenId] = useState<string | null>(null);

  if (!products.length) return null;
  return (
    <section data-block="featured_products" className="section">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader
          eyebrow="Styled products"
          title="Pick one and play."
          subtitle="For the woman who wants one perfect piece, not the whole set."
        />
        {payload.position_ladder && payload.position_ladder.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-2 justify-center">
            {payload.position_ladder.map((r) => (
              <div
                key={r.position}
                className="glass rounded-lg px-3 py-1.5 text-[12px] font-semibold"
              >
                <span className="text-[rgb(var(--accent))]">
                  {ordinal(r.position)} wig
                </span>{" "}
                → <span className="font-mono">−{money(r.discount_ngn)}</span>
                {r.label && (
                  <span className="text-[rgb(var(--text-faint))] ml-1">
                    {r.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-10">
          {products.map((p, i) => (
            <Card
              key={p.product_id || p.styled_id || i}
              product={p}
              index={i}
              live={state === "live"}
              deliveryWeeks={payload.delivery_weeks}
              preorderExtraWeeks={payload.preorder_extra_weeks}
              positionLadder={payload.position_ladder ?? null}
              discountType={payload.discount_type ?? null}
              discountValue={payload.discount_value ?? null}
              onOpen={(id) => setOpenId(id)}
            />
          ))}
        </div>
      </div>
      <ProductDetailModal
        slug={payload.slug}
        styledId={openId}
        open={openId != null}
        onClose={() => setOpenId(null)}
      />
    </section>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Save ₦X per wig assuming 1 wig in cart" — uses the campaign's position
 *  ladder first rung (1st-wig discount), else the top-level discount on the
 *  campaign. Returns 0 when nothing applies so the badge stays hidden. */
function estimateSavePerWig(
  unitNgn: number,
  ladder: { position: number; discount_ngn: number }[] | null,
  discountType: string | null,
  discountValue: number | null,
): number {
  if (!Number.isFinite(unitNgn) || unitNgn <= 0) return 0;
  if (ladder && ladder.length) {
    const first = [...ladder].sort((a, b) => a.position - b.position)[0];
    if (first?.discount_ngn) return Number(first.discount_ngn) || 0;
  }
  if (discountType === "percentage" && discountValue) {
    return Math.round(unitNgn * Number(discountValue));
  }
  if (discountType === "fixed_amount" && discountValue) {
    return Math.round(Number(discountValue));
  }
  return 0;
}

function Card({
  product,
  index,
  live,
  deliveryWeeks,
  preorderExtraWeeks,
  positionLadder,
  discountType,
  discountValue,
  onOpen,
}: {
  product: LandingProduct;
  index: number;
  live: boolean;
  deliveryWeeks?: number | null;
  preorderExtraWeeks?: number;
  positionLadder: { position: number; discount_ngn: number }[] | null;
  discountType: string | null;
  discountValue: number | null;
  onOpen: (styledId: string) => void;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [hover, setHover] = useState(false);
  const campaignPrice = Number(product.campaign_price_ngn || 0);
  const retail = Number(product.regular_price_ngn || 0);
  const price = campaignPrice > 0 ? campaignPrice : retail;
  const hasDiscount = campaignPrice > 0 && retail > campaignPrice;
  const isPreorder =
    product.stock_remaining != null && product.stock_remaining <= 0;
  const weeks = isPreorder
    ? (deliveryWeeks || 0) + (preorderExtraWeeks ?? 4)
    : deliveryWeeks;
  const save = estimateSavePerWig(
    price,
    positionLadder,
    discountType,
    discountValue,
  );
  const openable = Boolean(product.styled_id);

  function open() {
    if (openable && product.styled_id) onOpen(product.styled_id);
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ delay: index * 0.04, duration: 0.5 }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="glass rounded-[var(--radius)] overflow-hidden flex flex-col"
    >
      {/* Clickable cover: tapping the image OR the title opens the product
          detail modal (gallery + long copy + size/lace variant picker +
          head-size guide). Keyboard-accessible via the explicit button. */}
      <button
        type="button"
        onClick={open}
        disabled={!openable}
        className="relative aspect-[4/5] bg-[rgb(var(--panel-2))] block text-left disabled:cursor-default"
        aria-label={`Open ${product.name || "product"} details`}
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name || ""}
            fill
            sizes="(min-width: 1024px) 280px, 50vw"
            className="object-cover transition-transform duration-500"
            style={{ transform: hover ? "scale(1.04)" : "scale(1)" }}
          />
        ) : null}
        {isPreorder && (
          <div className="absolute top-2 left-2 rounded-md bg-[rgb(var(--accent-deep))] px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase text-[rgb(var(--text))]">
            Out of stock · Preorder
          </div>
        )}
      </button>
      <div className="p-3.5 flex-1 flex flex-col">
        <button
          type="button"
          onClick={open}
          disabled={!openable}
          className="text-[13px] font-semibold leading-tight truncate text-left hover:underline disabled:no-underline disabled:cursor-default"
        >
          {product.name}
        </button>
        {product.short_description && (
          <div className="mt-0.5 text-[11.5px] text-[rgb(var(--text-faint))] line-clamp-2">
            {product.short_description}
          </div>
        )}
        {price > 0 && (
          <div className="mt-2 flex items-end gap-2 flex-wrap">
            <div className="font-display text-[18px] tabular-nums">
              {money(price)}
            </div>
            {hasDiscount && (
              <div className="text-[11px] text-[rgb(var(--text-faint))] line-through font-mono">
                {money(retail)}
              </div>
            )}
          </div>
        )}
        {save > 0 && (
          <div className="mt-1 text-[11px] font-mono text-[rgb(var(--success))]">
            save {money(save)}{" "}
            <span className="opacity-60">/ wig</span>
          </div>
        )}
        {weeks != null && weeks > 0 && (
          <div
            className={`mt-1.5 flex items-center gap-1 text-[11px] ${
              isPreorder
                ? "text-[rgb(var(--warn))]"
                : "text-[rgb(var(--text-faint))]"
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>
              {isPreorder
                ? `Out of stock — pre-order ships in ${weeks}`
                : `Delivery: ${weeks}`}{" "}
              week{weeks !== 1 ? "s" : ""}
            </span>
          </div>
        )}
        {live && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const itemId = product.styled_id || product.product_id;
              if (!itemId) return;
              add({
                id: itemId,
                type: "product",
                product_id: product.product_id,
                name: product.name || "",
                image_url: product.image_url || undefined,
                unit_price_ngn: price,
                retail_price_ngn: retail || undefined,
                quantity: 1,
                preorder: isPreorder,
                preorder_lead_weeks: isPreorder ? weeks ?? undefined : undefined,
                delivery_weeks: !isPreorder ? weeks ?? undefined : undefined,
              });
              openCart();
            }}
            className="mt-3 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] text-[12px] font-semibold cta-sheen"
          >
            <ShoppingBag className="w-3.5 h-3.5" />{" "}
            {isPreorder ? "Pre-order" : "Add"}
          </button>
        )}
      </div>
    </motion.article>
  );
}
