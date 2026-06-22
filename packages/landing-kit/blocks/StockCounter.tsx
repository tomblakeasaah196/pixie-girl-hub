// @ts-nocheck
"use client";

import { motion } from "framer-motion";
import { Flame } from "lucide-react";
import type { LandingPayload } from "../types";

export function StockCounter({
  payload,
  state,
}: {
  payload: LandingPayload;
  state: "before" | "live" | "ended";
}) {
  if (state !== "live") return null;
  const bundles = (payload.bundles || []).filter(
    (b) =>
      b.current_stock_snapshot !== null &&
      b.current_stock_snapshot !== undefined,
  );
  if (!bundles.length) return null;

  return (
    <section className="section-tight">
      <div className="mx-auto max-w-[920px] glass rounded-[var(--radius)] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Flame className="w-4 h-4 text-[rgb(var(--accent-glow))]" />
          <h3 className="font-display text-[18px]">Live stock — moving fast</h3>
        </div>
        <ul className="space-y-2.5">
          {bundles.map((b) => {
            const remaining = Math.max(0, b.current_stock_snapshot ?? 0);
            const start = Math.max(1, b.starting_stock ?? remaining + 1);
            const pct = Math.min(100, (remaining / start) * 100);
            const low = remaining > 0 && remaining <= Math.max(2, start * 0.2);
            return (
              <li
                key={b.link_id}
                className="grid grid-cols-12 gap-3 items-center"
              >
                <div className="col-span-5 truncate text-[13.5px]">
                  {b.bundle_name}
                </div>
                <div className="col-span-5">
                  <div className="h-1.5 rounded-full bg-[rgb(var(--text)/0.08)] overflow-hidden">
                    <motion.div
                      className={
                        low
                          ? "h-full bg-[rgb(var(--danger))]"
                          : "h-full bg-[rgb(var(--success))]"
                      }
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                </div>
                <div className="col-span-2 text-right tabular-nums text-[12.5px]">
                  {remaining === 0 ? (
                    <span className="text-[rgb(var(--text-faint))]">
                      Sold out
                    </span>
                  ) : (
                    <>
                      <span
                        className={
                          low ? "text-[rgb(var(--danger))] font-semibold" : ""
                        }
                      >
                        {remaining}
                      </span>{" "}
                      <span className="text-[rgb(var(--text-faint))]">
                        left
                      </span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
