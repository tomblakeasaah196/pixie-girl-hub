"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Heart, Package, ShoppingBag } from "lucide-react";
import type { LandingPayload, LandingBundle } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { SALE_RED } from "@/lib/deals";
import { BundleDetailModal } from "@/components/product/BundleDetailModal";

export function BundleShowcase({
  payload,
  state,
}: {
  payload: LandingPayload;
  state: "before" | "live" | "ended";
}) {
  const bundles = payload.bundles || [];
  if (bundles.length === 0) return null;
  return (
    <section id="bundles" data-block="bundle_showcase" className="section">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader
          eyebrow="Curated bundles"
          title="The drops, set."
          subtitle="Each bundle is composed by hand — colours, lengths, and styles
              already paired. Buy the set, save together."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 mt-10">
          {bundles.map((b, i) => (
            <BundleCard
              key={b.link_id}
              bundle={b}
              state={state}
              index={i}
              deliveryWeeks={payload.delivery_weeks}
              preorderExtraWeeks={payload.preorder_extra_weeks}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function BundleCard({
  bundle,
  state,
  index,
  deliveryWeeks,
  preorderExtraWeeks,
}: {
  bundle: LandingBundle;
  state: "before" | "live" | "ended";
  index: number;
  deliveryWeeks?: number | null;
  preorderExtraWeeks?: number;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [opened, setOpened] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const tease = state !== "live";
  const stockOut = (bundle.current_stock_snapshot ?? 1) <= 0;
  const showPrice = !tease;
  // Pre-order lead time: the value the owner set on the bundle, else the
  // campaign's in-stock delivery weeks plus the pre-order surcharge weeks.
  const preorderLeadWeeks =
    bundle.preorder_lead_weeks ?? (deliveryWeeks || 0) + (preorderExtraWeeks ?? 4);
  // In-stock delivery weeks set in the builder (undefined hides the line).
  const inStockDeliveryWeeks =
    deliveryWeeks != null && deliveryWeeks > 0 ? deliveryWeeks : undefined;
  const finalPrice =
    stockOut && bundle.preorder_enabled
      ? (bundle.preorder_price_ngn ?? bundle.campaign_bundle_price_ngn ?? 0)
      : (bundle.campaign_bundle_price_ngn ?? 0);
  const retailTotal = bundle.total_retail_ngn ?? null;
  const savings =
    bundle.total_savings_ngn ??
    (retailTotal ? Math.max(0, retailTotal - finalPrice) : 0);

  function addToCart() {
    if (stockOut && !bundle.preorder_enabled) return;
    add({
      id: bundle.bundle_id,
      type: "bundle",
      bundle_id: bundle.bundle_id,
      name: bundle.bundle_name,
      image_url: bundle.bundle_hero_image_url || undefined,
      unit_price_ngn: finalPrice,
      retail_price_ngn: retailTotal || undefined,
      quantity: 1,
      preorder: stockOut && bundle.preorder_enabled === true,
      preorder_lead_weeks:
        stockOut && bundle.preorder_enabled ? preorderLeadWeeks : undefined,
      delivery_weeks: !stockOut ? inStockDeliveryWeeks : undefined,
    });
    openCart();
  }

  return (
    <motion.article
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{
        delay: index * 0.07,
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
      }}
      onMouseEnter={() => setOpened(true)}
      onMouseLeave={() => setOpened(false)}
      className="glass rounded-[var(--radius)] overflow-hidden flex flex-col"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setDetailOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDetailOpen(true);
          }
        }}
        aria-label={`View ${bundle.bundle_name} details`}
        className="relative aspect-[4/5] bg-[rgb(var(--panel-2))] cursor-pointer"
      >
        {bundle.bundle_hero_image_url ? (
          <Image
            src={bundle.bundle_hero_image_url}
            alt={bundle.bundle_name}
            fill
            sizes="(min-width: 1280px) 380px, (min-width: 768px) 50vw, 100vw"
            className="object-cover"
            priority={index < 2}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-[rgb(var(--text-faint))]">
            <Package className="w-12 h-12" />
          </div>
        )}
        {bundle.is_featured && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]">
            <Heart className="w-3 h-3" /> Featured
          </span>
        )}
        {/* Red savings badge — hardcoded sale red per owner directive */}
        {savings > 0 && retailTotal && finalPrice > 0 && (
          <span
            className="absolute top-3 right-3 rounded-md px-2 py-1 text-[11px] font-extrabold text-white leading-none"
            style={{ background: SALE_RED }}
          >
            −{Math.round((savings / retailTotal) * 100)}%
          </span>
        )}
        {state === "live" && bundle.current_stock_snapshot !== null && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] bg-[rgb(0_0_0/0.55)] text-[rgb(var(--text))] backdrop-blur">
            {stockOut
              ? bundle.preorder_enabled
                ? "Out of stock · Preorder"
                : "Sold out"
              : `${bundle.current_stock_snapshot} left`}
          </span>
        )}
        {/* Bundle unfold sheen on hover. */}
        <AnimatePresence>
          {opened && state === "live" && (
            <motion.div
              initial={{ opacity: 0, scale: 1.05 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(180deg, transparent 40%, rgb(var(--accent-deep)/0.5) 100%)",
              }}
            />
          )}
        </AnimatePresence>
      </div>

      <div className="p-5 flex-1 flex flex-col">
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="text-left font-display text-[22px] leading-tight hover:text-[rgb(var(--accent-glow))] transition-colors"
        >
          {bundle.bundle_name}
        </button>
        {(bundle.component_count ?? bundle.components?.length ?? 0) > 0 && (
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="mt-1 text-left text-[12.5px] text-[rgb(var(--text-faint))] hover:text-[rgb(var(--text-muted))] transition-colors inline-flex items-center gap-1"
          >
            <Package className="w-3.5 h-3.5" />
            {bundle.component_count ?? bundle.components?.length} pieces · View
            details
          </button>
        )}
        {showPrice ? (
          <div className="mt-4">
            <div className="flex items-baseline gap-3 flex-wrap">
              {/* NOW price — green & bold when there's a saving */}
              <div
                className="font-display text-[28px] tabular-nums font-extrabold"
                style={savings > 0 ? { color: "#16A34A" } : undefined}
              >
                {money(finalPrice)}
              </div>
              {retailTotal && retailTotal > finalPrice && (
                <div className="text-[rgb(var(--text-faint))] line-through font-mono text-[14px]">
                  {money(retailTotal)}
                </div>
              )}
            </div>
            {savings > 0 && (
              <div
                className="text-[12px] mt-1 font-semibold"
                style={{ color: SALE_RED }}
              >
                You save {money(savings)}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 micro">Prices reveal at launch</div>
        )}
        {stockOut && bundle.preorder_enabled && state === "live" && (
          <div className="text-[12.5px] text-[rgb(var(--warn))] mt-2 inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Out of stock — pre-order ships in{" "}
            {preorderLeadWeeks} weeks
          </div>
        )}
        {!stockOut &&
          deliveryWeeks != null &&
          deliveryWeeks > 0 &&
          state === "live" && (
            <div className="text-[12px] text-[rgb(var(--text-faint))] mt-1.5 inline-flex items-center gap-1.5">
              <Clock className="w-3 h-3" /> Delivery: {deliveryWeeks} week
              {deliveryWeeks !== 1 ? "s" : ""}
            </div>
          )}

        <button
          type="button"
          onClick={addToCart}
          disabled={state !== "live" || (stockOut && !bundle.preorder_enabled)}
          className={cn(
            "mt-5 inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold cta-sheen disabled:opacity-50 disabled:cursor-not-allowed",
            state === "live"
              ? "bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))]"
              : "bg-[rgb(var(--text)/0.06)] text-[rgb(var(--text-muted))]",
          )}
        >
          {state === "live" ? (
            <>
              <ShoppingBag className="w-4 h-4" />
              {stockOut && bundle.preorder_enabled
                ? "Pre-order now"
                : `Add to cart · ${money(finalPrice)}`}
            </>
          ) : state === "before" ? (
            "Available when doors open"
          ) : (
            "Sale ended"
          )}
        </button>
      </div>

      <BundleDetailModal
        bundle={bundle}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onAdd={addToCart}
        finalPrice={finalPrice}
        retailTotal={retailTotal}
        savings={savings}
        state={state}
        stockOut={stockOut}
        preorderLeadWeeks={preorderLeadWeeks}
      />
    </motion.article>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="text-center max-w-[680px] mx-auto">
      {eyebrow && <div className="micro mb-3">{eyebrow}</div>}
      <h2 className="font-display text-[clamp(30px,5vw,52px)] leading-[1.05]">
        {title.replace(/\s\S+$/, "")}{" "}
        <em className="not-italic md:italic text-[rgb(var(--accent-glow))]">
          {title.split(/\s+/).slice(-1)[0]}
        </em>
      </h2>
      {subtitle && (
        <p className="mt-4 text-[rgb(var(--text-muted))]">{subtitle}</p>
      )}
    </div>
  );
}

// Avoid unused-import warning from the inline icon import.
void Check;
