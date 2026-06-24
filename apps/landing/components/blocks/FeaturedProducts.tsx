"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Clock, ShoppingBag, Search, X } from "lucide-react";
import type { LandingPayload, LandingProduct } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { SectionHeader } from "./BundleShowcase";
import { ProductDetailModal } from "../product/ProductDetailModal";

/**
 * Live stock map, keyed by styled_id and product_id → current available qty.
 * The card's stock_remaining is baked into the (cacheable) page payload, so a
 * CDN-cached page would otherwise show stale "out of stock". Polling the live
 * /stock endpoint keeps the Add / Pre-order state current within seconds of an
 * inventory change, independent of page caching. Live state only.
 */
function useLiveStock(slug: string, enabled: boolean) {
  const [map, setMap] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!enabled || !slug) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/public/sale/${encodeURIComponent(slug)}/stock`,
          { headers: { Accept: "application/json" }, cache: "no-store" },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          data?: {
            product_id?: string | null;
            styled_id?: string | null;
            stock_remaining?: number | null;
          }[];
        };
        if (cancelled || !json?.data) return;
        const next: Record<string, number> = {};
        for (const r of json.data) {
          if (r.stock_remaining == null) continue;
          if (r.styled_id) next[r.styled_id] = r.stock_remaining;
          if (r.product_id) next[r.product_id] = r.stock_remaining;
        }
        setMap(next);
      } catch {
        // keep the last known map on a transient failure
      }
    };
    load();
    const t = setInterval(load, 20000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [slug, enabled]);
  return map;
}

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
  const [searchTerm, setSearchTerm] = useState("");
  // Live stock overrides the page-baked stock_remaining (beats CDN caching).
  const liveStock = useLiveStock(payload.slug, state === "live");

  // Filter products by search term (name and short description).
  const filtered = useMemo(
    () =>
      searchTerm.trim() === ""
        ? products
        : products.filter((p) => {
            const term = searchTerm.toLowerCase();
            const name = (p.name || "").toLowerCase();
            const desc = (p.short_description || "").toLowerCase();
            return name.includes(term) || desc.includes(term);
          }),
    [products, searchTerm],
  );

  if (!products.length) return null;

  // Read section header copy from block props (set via Landing Studio).
  const block = (payload.blocks || []).find((b) => b.key === "featured_products");
  const bp = (block?.props as Record<string, unknown>) || {};
  const sectionEyebrow = (bp.eyebrow as string) || "Styled products";
  const sectionTitle = (bp.title as string) || "Pick one and play.";
  const sectionSubtitle =
    (bp.intro as string) ||
    "For the woman who wants one perfect piece, not the whole set.";

  return (
    <section data-block="featured_products" className="section">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader
          eyebrow={sectionEyebrow}
          title={sectionTitle}
          subtitle={sectionSubtitle}
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

        {/* Product search */}
        <div className="mt-10 mb-8 max-w-md mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgb(var(--text-muted))] pointer-events-none" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[rgb(var(--text)/0.06)] border border-[rgb(var(--border-c)/0.1)] text-[13px] placeholder:text-[rgb(var(--text-faint))] focus:outline-none focus:bg-[rgb(var(--text)/0.08)] focus:border-[rgb(var(--accent)/0.3)] transition"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))] flex items-center justify-center"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          {searchTerm && filtered.length === 0 && (
            <p className="mt-4 text-center text-[12px] text-[rgb(var(--text-muted))]">
              No products match "{searchTerm}"
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {filtered.map((p, i) => (
            <Card
              key={p.product_id || p.styled_id || i}
              product={p}
              index={i}
              live={state === "live"}
              liveStock={liveStock}
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
  liveStock,
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
  liveStock?: Record<string, number>;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [hover, setHover] = useState(false);
  const campaignPrice = Number(product.campaign_price_ngn || 0);
  const retail = Number(product.regular_price_ngn || 0);
  const price = campaignPrice > 0 ? campaignPrice : retail;
  const hasDiscount = campaignPrice > 0 && retail > campaignPrice;
  // Live stock (polled) overrides the page-baked stock_remaining when present.
  const liveQty =
    liveStock?.[product.styled_id ?? ""] ??
    liveStock?.[product.product_id ?? ""];
  const effectiveStock = liveQty ?? product.stock_remaining;
  const isPreorder = effectiveStock != null && effectiveStock <= 0;
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
              // Styled products must be configured (size/lace) before adding —
              // the base product_id prices at ₦0. Open the detail modal, which
              // adds the chosen styled_variant_id to the cart.
              if (product.styled_id) {
                open();
                return;
              }
              const itemId = product.product_id;
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
