"use client";

import { useState } from "react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Clock, Heart, Package, ShoppingBag } from "lucide-react";
import type { LandingPayload, LandingBundle } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";

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
    <section id="bundles" className="section">
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
              payload={payload}
              state={state}
              index={i}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function BundleCard({
  bundle,
  payload,
  state,
  index,
}: {
  bundle: LandingBundle;
  payload: LandingPayload;
  state: "before" | "live" | "ended";
  index: number;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [opened, setOpened] = useState(false);
  const tease = state !== "live";
  const stockOut = (bundle.current_stock_snapshot ?? 1) <= 0;
  const showPrice = !tease;
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
      preorder_lead_weeks: bundle.preorder_lead_weeks ?? undefined,
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
      <div className="relative aspect-[4/5] bg-[rgb(var(--panel-2))]">
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
        {state === "live" && bundle.current_stock_snapshot !== null && (
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] bg-[rgb(0_0_0/0.55)] text-[rgb(var(--text))] backdrop-blur">
            {stockOut
              ? bundle.preorder_enabled
                ? "Preorder"
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
        <h3 className="font-display text-[22px] leading-tight">
          {bundle.bundle_name}
        </h3>
        {showPrice ? (
          <div className="mt-4 flex items-end gap-3">
            <div className="font-display text-[28px] tabular-nums">
              {money(finalPrice)}
            </div>
            {retailTotal && retailTotal > finalPrice && (
              <div className="text-[rgb(var(--text-faint))] line-through font-mono">
                {money(retailTotal)}
              </div>
            )}
          </div>
        ) : (
          <div className="mt-4 micro">Prices reveal at launch</div>
        )}
        {savings > 0 && showPrice && (
          <div className="text-[13px] text-[rgb(var(--success))] mt-1.5 font-medium">
            You save {money(savings)}
          </div>
        )}
        {stockOut && bundle.preorder_enabled && state === "live" && (
          <div className="text-[12.5px] text-[rgb(var(--warn))] mt-2 inline-flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> Pre-order — ships in{" "}
            {bundle.preorder_lead_weeks ?? 3} weeks
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
  const words = title.trim().split(/\s+/);
  const last = words.length > 1 ? words[words.length - 1] : "";
  const head = words.length > 1 ? words.slice(0, -1).join(" ") : title;
  return (
    <div className="text-center max-w-[680px] mx-auto">
      {eyebrow && <div className="eyebrow mb-3">{eyebrow}</div>}
      <h2 className="font-display text-[clamp(30px,5vw,52px)] leading-[1.05]">
        {head}{" "}
        {last && <em className="italic text-gold">{last}</em>}
      </h2>
      {subtitle && (
        <p className="mt-4 text-[rgb(var(--text-muted))]">{subtitle}</p>
      )}
    </div>
  );
}

// Avoid unused-import warning from the inline icon import.
void Check;
