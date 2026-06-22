// @ts-nocheck
"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import type { LandingPayload } from "../types";

interface RecentOrder {
  bundle_name: string;
  city: string;
  at: number;
}

/**
 * "Y just bought from Lagos" social proof ticker — bottom-left, throttled
 * to 1 message per 8 seconds. Pulls a snapshot of recent purchases from
 * the campaign payload (server-side, anonymised city only).
 *
 * If the payload exposes no recent orders the ticker stays hidden — we
 * never invent purchases.
 */
export function JustBoughtTicker({ payload }: { payload: LandingPayload }) {
  // Backend exposes recent_orders as optional in the public landing payload
  // (a follow-up may wire socket events). For now, derive from the payload.
  const recent: RecentOrder[] =
    (payload as unknown as { recent_orders?: RecentOrder[] }).recent_orders ??
    [];
  const [cursor, setCursor] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (recent.length === 0) return;
    setVisible(true);
    const t1 = setTimeout(() => setVisible(false), 6500);
    const t2 = setTimeout(() => {
      setCursor((c) => (c + 1) % recent.length);
    }, 8000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [cursor, recent.length]);

  if (recent.length === 0) return null;
  const current = recent[cursor];

  return (
    <div className="fixed bottom-[88px] left-3 z-30 pointer-events-none max-w-[320px]">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="dropglass rounded-2xl px-3.5 py-2.5 flex items-center gap-2.5"
          >
            <span className="grid place-items-center w-8 h-8 rounded-xl bg-[rgb(var(--accent)/0.12)] text-[rgb(var(--accent-glow))]">
              <ShoppingBag className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold truncate">
                {current.bundle_name}
              </div>
              <div className="text-[11px] text-[rgb(var(--text-muted))]">
                Just bought from {current.city}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
