// @ts-nocheck
"use client";

import { motion } from "framer-motion";
import { Package, TrendingUp } from "lucide-react";
import type { LandingPayload } from "../types";
import { money } from "../format";
import { SectionHeader } from "./BundleShowcase";

export function ResellerBulkSection({
  payload,
}: {
  payload: LandingPayload;
}) {
  const tiers = (payload.bulk_tiers || [])
    .filter((t) => t.min_qty > 0 && t.discount_per_item_ngn > 0)
    .sort((a, b) => a.min_qty - b.min_qty);

  if (tiers.length === 0) return null;

  return (
    <section data-block="reseller_bulk" className="section-tight">
      <div className="mx-auto max-w-[920px] glass rounded-[var(--radius)] p-7 md:p-9">
        <SectionHeader
          eyebrow="Resellers & bulk buyers"
          title="Scale your order."
          subtitle="The more you buy, the lower your per-unit rate. Perfect for stylists, shop owners, and resellers."
        />

        <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {tiers.map((tier, i) => (
            <motion.div
              key={tier.min_qty}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="rounded-[14px] p-5 border border-[rgb(var(--border-c)/0.1)] bg-[rgb(var(--text)/0.04)] hover:border-[rgb(var(--accent)/0.4)] hover:bg-[rgb(var(--accent)/0.04)] transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="grid place-items-center w-10 h-10 rounded-xl bg-[rgb(var(--accent)/0.1)] text-[rgb(var(--accent-glow))] flex-shrink-0">
                  {i === tiers.length - 1 ? (
                    <TrendingUp className="w-5 h-5" />
                  ) : (
                    <Package className="w-5 h-5" />
                  )}
                </span>
                <div>
                  <div className="text-[14px] font-semibold">
                    {tier.min_qty}+ units
                  </div>
                  <div className="font-display text-[24px] tabular-nums mt-1">
                    {money(tier.discount_per_item_ngn)}{" "}
                    <span className="text-[12px] font-body text-[rgb(var(--text-faint))]">
                      off per item
                    </span>
                  </div>
                  {tier.label && (
                    <div className="text-[12px] text-[rgb(var(--text-muted))] mt-1.5">
                      {tier.label}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        <p className="text-center text-[12px] text-[rgb(var(--text-faint))] mt-6">
          Bulk discounts apply automatically at checkout. DM for custom
          wholesale terms.
        </p>
      </div>
    </section>
  );
}
