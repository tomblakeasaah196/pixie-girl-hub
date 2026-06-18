"use client";

import { motion } from "framer-motion";
import type { LandingPayload } from "@/lib/types";
import { useCart } from "@/lib/cart-store";
import { money } from "@/lib/format";
import { SectionHeader } from "./BundleShowcase";

export function QuantityTierVisualizer({
  payload,
  state,
}: {
  payload: LandingPayload;
  state: "before" | "live" | "ended";
}) {
  const tiers = (payload.tiers || [])
    .filter((t) => t.fixed_discount_ngn > 0)
    .sort((a, b) => a.min_quantity - b.min_quantity);
  const totalQty = useCart((s) => s.totalQty());
  if (tiers.length === 0) return null;

  const next = tiers.find((t) => totalQty < t.min_quantity);
  const reached = tiers.filter((t) => totalQty >= t.min_quantity);
  const reachedBest = reached.length ? reached[reached.length - 1] : null;
  const maxQty = tiers[tiers.length - 1].min_quantity;
  const pct = Math.min(100, (totalQty / maxQty) * 100);

  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[920px] glass rounded-[var(--radius)] p-7 md:p-9">
        <SectionHeader title="Buy more — save more." />
        <p className="text-center text-[rgb(var(--text-muted))] mt-2">
          Fixed ₦ amounts at the cart. The ladder is honest — no fine print, no
          stacking quirks.
        </p>

        <div className="relative mt-9 h-2 rounded-full bg-[rgb(var(--text)/0.08)] overflow-hidden">
          <motion.div
            className="absolute inset-y-0 left-0 bg-[rgb(var(--accent-deep))]"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>

        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
          {tiers.map((t) => {
            const isReached = totalQty >= t.min_quantity;
            const isNext = next?.tier_id === t.tier_id;
            return (
              <div
                key={t.tier_id}
                className={`rounded-[14px] p-4 border transition-colors ${
                  isReached
                    ? "border-[rgb(var(--success)/0.4)] bg-[rgb(var(--success)/0.08)]"
                    : isNext
                      ? "border-[rgb(var(--accent)/0.5)] bg-[rgb(var(--accent)/0.06)]"
                      : "border-[rgb(var(--border-c)/0.1)] bg-[rgb(var(--text)/0.04)]"
                }`}
              >
                <div className="text-[13px] font-semibold mb-1">
                  Buy {t.min_quantity}+ items
                </div>
                <div className="font-display text-[22px] tabular-nums">
                  {money(t.fixed_discount_ngn)} <span className="text-[12px] font-body text-[rgb(var(--text-faint))]">off</span>
                </div>
                {t.label && (
                  <div className="text-[11px] text-[rgb(var(--text-faint))] mt-1.5">{t.label}</div>
                )}
              </div>
            );
          })}
        </div>

        {state === "live" && (
          <div className="mt-7 text-center text-[14px] text-[rgb(var(--text-muted))]">
            {reachedBest ? (
              <>
                You&apos;ve unlocked <span className="text-[rgb(var(--success))] font-semibold">{money(reachedBest.fixed_discount_ngn)} off</span>
                {next && (
                  <>
                    {" — "}add {next.min_quantity - totalQty} more for{" "}
                    <span className="text-[rgb(var(--accent-glow))] font-semibold">{money(next.fixed_discount_ngn)} off</span>.
                  </>
                )}
              </>
            ) : next ? (
              <>
                Add {next.min_quantity - totalQty} more to unlock <span className="text-[rgb(var(--accent-glow))] font-semibold">{money(next.fixed_discount_ngn)} off</span>.
              </>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
