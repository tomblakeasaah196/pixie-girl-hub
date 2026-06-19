"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ShoppingBag } from "lucide-react";
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
    <section className="section">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader
          eyebrow="Styled products"
          title="Pick one and play."
          subtitle="For the woman who wants one perfect piece, not the whole set."
        />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-10">
          {products.map((p, i) => (
            <Card
              key={p.product_id || i}
              product={p}
              index={i}
              live={state === "live"}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function Card({
  product,
  index,
  live,
}: {
  product: LandingProduct;
  index: number;
  live: boolean;
}) {
  const add = useCart((s) => s.add);
  const openCart = useCart((s) => s.openCart);
  const [hover, setHover] = useState(false);
  const price = Number(product.campaign_price_ngn || 0);
  const retail = Number(product.regular_price_ngn || 0);
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
        {live && (
          <button
            type="button"
            onClick={() => {
              if (!product.product_id) return;
              add({
                id: product.product_id,
                type: "product",
                product_id: product.product_id,
                name: product.name || "",
                image_url: product.image_url || undefined,
                unit_price_ngn: price,
                retail_price_ngn: retail || undefined,
                quantity: 1,
              });
              openCart();
            }}
            className="mt-3 inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-[rgb(var(--accent-deep))] text-[rgb(var(--text))] text-[12px] font-semibold cta-sheen"
          >
            <ShoppingBag className="w-3.5 h-3.5" /> Add
          </button>
        )}
      </div>
    </motion.article>
  );
}
