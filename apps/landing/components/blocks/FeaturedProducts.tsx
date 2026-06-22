"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { Clock, ShoppingBag } from "lucide-react";
import type { LandingPayload, LandingProduct } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { SectionHeader } from "./BundleShowcase";

export function FeaturedProducts({
  payload,
  state,
}: {
  payload: LandingPayload;
  state: "before" | "live" | "ended";
}) {
  const products = (payload.products || []).filter(Boolean);
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
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Card({
  product,
  index,
  live,
  deliveryWeeks,
  preorderExtraWeeks,
}: {
  product: LandingProduct;
  index: number;
  live: boolean;
  deliveryWeeks?: number | null;
  preorderExtraWeeks?: number;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [hover, setHover] = useState(false);
  const price = Number(product.campaign_price_ngn || 0);
  const retail = Number(product.regular_price_ngn || 0);
  const isPreorder =
    product.stock_remaining != null && product.stock_remaining <= 0;
  const weeks = isPreorder
    ? (deliveryWeeks || 0) + (preorderExtraWeeks ?? 4)
    : deliveryWeeks;

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
      <div className="relative aspect-[4/5] bg-[rgb(var(--panel-2))]">
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
            Preorder
          </div>
        )}
      </div>
      <div className="p-3.5 flex-1 flex flex-col">
        <div className="text-[13px] font-semibold leading-tight truncate">
          {product.name}
        </div>
        {price > 0 && (
          <div className="mt-2 flex items-end gap-2">
            <div className="font-display text-[18px] tabular-nums">
              {money(price)}
            </div>
            {retail > price && (
              <div className="text-[11px] text-[rgb(var(--text-faint))] line-through font-mono">
                {money(retail)}
              </div>
            )}
          </div>
        )}
        {weeks != null && weeks > 0 && (
          <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[rgb(var(--text-faint))]">
            <Clock className="w-3 h-3" />
            <span>
              {isPreorder ? "Preorder" : "Delivery"}: {weeks} week
              {weeks !== 1 ? "s" : ""}
            </span>
          </div>
        )}
        {live && (
          <button
            type="button"
            onClick={() => {
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
