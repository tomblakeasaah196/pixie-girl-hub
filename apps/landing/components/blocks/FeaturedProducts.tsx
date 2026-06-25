"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import {
  Clock,
  Package,
  Quote,
  Search,
  ShoppingBag,
  Sparkles,
  Store,
  X,
} from "lucide-react";
import type { LandingPayload, LandingProduct } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { cardHeadline, SALE_RED } from "@/lib/deals";
import { SectionHeader } from "./BundleShowcase";
import { DealExplainerModal } from "./DealExplainerModal";
import {
  ProductDetailModal,
  prefetchProductDetail,
} from "../product/ProductDetailModal";

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
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  // Styled (retail) vs Wholesale (bulk / raw) shopping mode. Wholesale is only
  // offered when the campaign has bulk tiers configured.
  const [mode, setMode] = useState<"styled" | "wholesale">("styled");
  // Live stock overrides the page-baked stock_remaining (beats CDN caching).
  const liveStock = useLiveStock(payload.slug, state === "live");

  const bulkTiers = useMemo(
    () =>
      (payload.bulk_tiers || [])
        .filter((t) => t.min_qty > 0 && t.discount_per_item_ngn > 0)
        .sort((a, b) => a.min_qty - b.min_qty),
    [payload.bulk_tiers],
  );
  const wholesaleAvailable = state === "live" && bulkTiers.length > 0;
  const maxBulkDiscount = bulkTiers.length
    ? Math.max(...bulkTiers.map((t) => t.discount_per_item_ngn))
    : 0;
  const minBulkQty = bulkTiers[0]?.min_qty ?? 0;
  const wholesale = wholesaleAvailable && mode === "wholesale";

  // Let the hero (or a shared link) deep-link into wholesale via #wholesale,
  // and keep the toggle in sync if the hash changes while on the page.
  useEffect(() => {
    if (!wholesaleAvailable) return;
    const apply = () => {
      if (typeof window === "undefined") return;
      const h = window.location.hash.replace("#", "");
      if (h === "wholesale") setMode("wholesale");
      if (h === "shop" || h === "styled") setMode("styled");
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [wholesaleAvailable]);

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

  // Pull founder quotes from the founder_quote block for interleaving.
  const quotes = useMemo(() => {
    const qb = (payload.blocks || []).find((b) => b.key === "founder_quote");
    const qp = (qb?.props as Record<string, unknown>) || {};
    if (Array.isArray(qp.quotes)) {
      return qp.quotes as { quote: string; author: string }[];
    }
    if (typeof qp.quote === "string") {
      return [
        {
          quote: qp.quote,
          author: (qp.author as string) || "The Founder",
        },
      ];
    }
    return [];
  }, [payload.blocks]);

  if (!products.length) return null;

  // Read section header copy from block props (set via Landing Studio).
  const block = (payload.blocks || []).find((b) => b.key === "featured_products");
  const bp = (block?.props as Record<string, unknown>) || {};
  const sectionEyebrow = (bp.eyebrow as string) || "Styled products";
  const sectionTitle = (bp.title as string) || "Pick one and play.";
  const sectionSubtitle =
    (bp.intro as string) ||
    "For the woman who wants one perfect piece, not the whole set.";

  // Build interleaved rows: 8 products, then a quote, repeat.
  // Skip interleaving when the visitor is actively searching.
  const PRODUCTS_PER_CHUNK = 8;
  const shouldInterleave = quotes.length > 0 && !searchTerm.trim();
  const chunks: Array<
    | { type: "products"; items: typeof filtered; startIndex: number }
    | { type: "quote"; quote: string; author: string; index: number }
  > = [];
  if (shouldInterleave) {
    let quoteIdx = 0;
    for (let i = 0; i < filtered.length; i += PRODUCTS_PER_CHUNK) {
      chunks.push({
        type: "products",
        items: filtered.slice(i, i + PRODUCTS_PER_CHUNK),
        startIndex: i,
      });
      if (i + PRODUCTS_PER_CHUNK < filtered.length) {
        const q = quotes[quoteIdx % quotes.length];
        chunks.push({
          type: "quote",
          quote: q.quote,
          author: q.author,
          index: quoteIdx,
        });
        quoteIdx++;
      }
    }
  } else {
    chunks.push({ type: "products", items: filtered, startIndex: 0 });
  }

  return (
    <section id="shop" data-block="featured_products" className="section scroll-mt-20">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader
          eyebrow={wholesale ? "Wholesale · bulk" : sectionEyebrow}
          title={wholesale ? "Buy in bulk." : sectionTitle}
          subtitle={
            wholesale
              ? "The same wigs, ordered raw and unstyled at trade prices — for stylists and resellers."
              : sectionSubtitle
          }
        />

        {/* Styled vs Wholesale segmented control — only when the campaign
            offers wholesale (bulk tiers configured). Gives the buyer a clear
            "two ways to shop" instead of burying the bulk opportunity. */}
        {wholesaleAvailable && (
          <div className="mt-8 flex justify-center">
            <div
              className="inline-flex rounded-full border border-[rgb(var(--border-c)/0.18)] bg-[rgb(var(--text)/0.04)] p-1"
              role="tablist"
              aria-label="Shopping mode"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!wholesale}
                onClick={() => {
                  setMode("styled");
                  if (typeof history !== "undefined")
                    history.replaceState(null, "", "#shop");
                }}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition " +
                  (!wholesale
                    ? "bg-[rgb(var(--accent-deep))] text-[rgb(var(--bg))] shadow-[0_2px_10px_rgb(0_0_0/0.2)]"
                    : "text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]")
                }
              >
                <Sparkles className="h-3.5 w-3.5" /> Shop Styled
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={wholesale}
                onClick={() => {
                  setMode("wholesale");
                  if (typeof history !== "undefined")
                    history.replaceState(null, "", "#wholesale");
                }}
                className={
                  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-semibold transition " +
                  (wholesale
                    ? "bg-[rgb(var(--accent-deep))] text-[rgb(var(--bg))] shadow-[0_2px_10px_rgb(0_0_0/0.2)]"
                    : "text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]")
                }
              >
                <Package className="h-3.5 w-3.5" /> Shop Wholesale
              </button>
            </div>
          </div>
        )}

        {/* Wholesale explainer — the bulk-tier economics, surfaced up front. */}
        {wholesale && (
          <div className="mt-6 mx-auto max-w-[760px] rounded-[var(--radius)] border border-[rgb(var(--brand-accent)/0.3)] bg-[rgb(var(--brand-accent)/0.08)] p-5">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-[rgb(var(--accent-readable))]" />
              <h3 className="font-display text-[18px]">
                Reseller &amp; bulk pricing
              </h3>
            </div>
            <p className="mt-1.5 text-[13px] text-[rgb(var(--text-muted))] leading-relaxed">
              Open any wig below and choose{" "}
              <em>Wholesale — raw wigs</em>. The bulk rate unlocks across every
              style in your cart — mix and match to reach the minimum of{" "}
              {minBulkQty}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {bulkTiers.map((t) => (
                <span
                  key={t.min_qty}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--brand-accent)/0.3)] bg-[rgb(var(--text)/0.03)] px-3 py-1.5 text-[12px]"
                >
                  <span className="font-semibold">{t.min_qty}+ wigs</span>
                  <span className="font-semibold text-[rgb(var(--accent-readable))]">
                    save {money(t.discount_per_item_ngn)}/wig
                  </span>
                </span>
              ))}
            </div>
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
              No products match &ldquo;{searchTerm}&rdquo;
            </p>
          )}
        </div>

        {chunks.map((chunk, ci) => {
          if (chunk.type === "quote") {
            return (
              <motion.div
                key={`quote-${chunk.index}`}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6 }}
                className="my-10 mx-auto max-w-[760px] glass rounded-[var(--radius)] p-8 md:p-10 text-center relative"
              >
                <Quote className="absolute top-5 left-6 w-7 h-7 text-[rgb(var(--accent-glow)/0.6)]" />
                <p className="font-display text-[clamp(20px,2.8vw,28px)] leading-[1.35]">
                  &ldquo;{chunk.quote}&rdquo;
                </p>
                <div className="mt-5 text-[11px] tracking-[0.25em] uppercase text-[rgb(var(--text-muted))]">
                  — {chunk.author}
                </div>
              </motion.div>
            );
          }
          return (
            <div
              key={`grid-${ci}`}
              className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
            >
              {chunk.items.map((p, i) => (
                <Card
                  key={p.product_id || p.styled_id || chunk.startIndex + i}
                  product={p}
                  index={chunk.startIndex + i}
                  live={state === "live"}
                  liveStock={liveStock}
                  deliveryWeeks={payload.delivery_weeks}
                  preorderExtraWeeks={payload.preorder_extra_weeks}
                  payload={payload}
                  wholesale={wholesale}
                  wholesaleHintNgn={maxBulkDiscount}
                  onOpen={(id) => setOpenId(id)}
                  onOpenExplainer={() => setExplainerOpen(true)}
                />
              ))}
            </div>
          );
        })}
      </div>
      <ProductDetailModal
        slug={payload.slug}
        styledId={openId}
        open={openId != null}
        onClose={() => setOpenId(null)}
        bulkTiers={payload.bulk_tiers ?? null}
      />
      <DealExplainerModal
        payload={payload}
        open={explainerOpen}
        onClose={() => setExplainerOpen(false)}
      />
    </section>
  );
}


function Card({
  product,
  index,
  live,
  deliveryWeeks,
  preorderExtraWeeks,
  payload,
  wholesale = false,
  wholesaleHintNgn = 0,
  onOpen,
  onOpenExplainer,
  liveStock,
}: {
  product: LandingProduct;
  index: number;
  live: boolean;
  deliveryWeeks?: number | null;
  preorderExtraWeeks?: number;
  payload: LandingPayload;
  wholesale?: boolean;
  wholesaleHintNgn?: number;
  onOpen: (styledId: string) => void;
  onOpenExplainer: () => void;
  liveStock?: Record<string, number>;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [hover, setHover] = useState(false);
  const campaignPrice = Number(product.campaign_price_ngn || 0);
  const retail = Number(product.regular_price_ngn || 0);
  const price = campaignPrice > 0 ? campaignPrice : retail;
  // Live stock (polled) overrides the page-baked stock_remaining when present.
  const liveQty =
    liveStock?.[product.styled_id ?? ""] ??
    liveStock?.[product.product_id ?? ""];
  const effectiveStock = liveQty ?? product.stock_remaining;
  const isPreorder = effectiveStock != null && effectiveStock <= 0;
  const weeks = isPreorder
    ? (deliveryWeeks || 0) + (preorderExtraWeeks ?? 4)
    : deliveryWeeks;
  const deal = cardHeadline(product, payload);
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
      onMouseEnter={() => {
        setHover(true);
        if (product.styled_id)
          prefetchProductDetail(payload.slug, product.styled_id);
      }}
      onMouseLeave={() => setHover(false)}
      onTouchStart={() => {
        if (product.styled_id)
          prefetchProductDetail(payload.slug, product.styled_id);
      }}
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
        {/* Red savings badge — shows the NAIRA amount saved (owner directive:
            "₦16,000 off", not "4%") so the deal reads as real money. */}
        {!wholesale && deal && deal.saveNgn > 0 && (
          <div
            className="absolute top-2 right-2 rounded-md px-2 py-1 text-[11px] font-extrabold text-white leading-none shadow-[0_2px_8px_rgb(0_0_0/0.3)]"
            style={{ background: SALE_RED }}
          >
            {money(deal.saveNgn)} OFF
          </div>
        )}
        {wholesale && (
          <div
            className="absolute top-2 right-2 rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider leading-none text-[rgb(var(--cta-ink))] shadow-[0_2px_8px_rgb(0_0_0/0.3)]"
            style={{ background: "rgb(var(--brand-accent))" }}
          >
            Raw
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
        {wholesale ? (
          <div className="mt-2">
            <div className="text-[12.5px] font-semibold">Raw / unstyled</div>
            {wholesaleHintNgn > 0 && (
              <div className="text-[12px] font-semibold text-[rgb(var(--accent-readable))]">
                Save up to {money(wholesaleHintNgn)}/wig in bulk
              </div>
            )}
            <div className="mt-0.5 text-[11px] text-[rgb(var(--text-faint))]">
              Tap to order at trade price
            </div>
          </div>
        ) : deal ? (
          /* Was / Now pricing — sale red treatment */
          <div className="mt-2 space-y-0.5">
            <div className="flex items-baseline gap-2 flex-wrap">
              {/* NOW price — green & bold */}
              <div
                className="font-display text-[18px] tabular-nums font-extrabold"
                style={{ color: "#16A34A" }}
              >
                {money(deal.nowNgn)}
              </div>
              {/* BEFORE price — muted strikethrough */}
              <div className="text-[12px] text-[rgb(var(--text-faint))] line-through font-mono">
                {money(deal.beforeNgn)}
              </div>
            </div>
            {/* Condition label + explainer link */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className="text-[10.5px] font-semibold"
                style={{ color: SALE_RED }}
              >
                {deal.conditionLabel}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenExplainer();
                }}
                className="text-[10.5px] underline underline-offset-2 transition-opacity hover:opacity-70"
                style={{ color: SALE_RED }}
              >
                See how →
              </button>
            </div>
          </div>
        ) : price > 0 ? (
          <div className="mt-2">
            <div className="font-display text-[18px] tabular-nums">
              {money(price)}
            </div>
          </div>
        ) : null}
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
        {live &&
          (wholesale ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                open();
              }}
              disabled={!openable}
              className="btn-cta mt-3 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold cta-sheen disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Package className="w-3.5 h-3.5" /> Order wholesale
            </button>
          ) : (
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
                  preorder_lead_weeks: isPreorder
                    ? weeks ?? undefined
                    : undefined,
                  delivery_weeks: !isPreorder ? weeks ?? undefined : undefined,
                });
                openCart();
              }}
              className="btn-cta mt-3 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg text-[12px] font-semibold cta-sheen"
            >
              <ShoppingBag className="w-3.5 h-3.5" />{" "}
              {isPreorder ? "Pre-order" : "Add"}
            </button>
          ))}
      </div>
    </motion.article>
  );
}
