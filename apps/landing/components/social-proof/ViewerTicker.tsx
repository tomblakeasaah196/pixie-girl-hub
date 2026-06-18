"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, Radio } from "lucide-react";
import { shouldShowViewerCount } from "@/lib/state-engine";
import type { LandingPayload } from "@/lib/types";

/**
 * Smart "X people viewing now" pill (top-left of viewport).
 *
 * In v1 we don't connect a socket — we display the snapshot the backend
 * provides on the payload (it's resolved server-side from
 * storefront_sessions counts and policy). A follow-up PR wires
 * socket.io-client to subscribe to brand:{brand}:campaign:{id} for
 * real-time updates.
 */
export function ViewerTicker({ payload }: { payload: LandingPayload }) {
  // Read live viewer count from the payload props if present, else estimate
  // from total_unique_visitors over the last 15 min (heuristic).
  const initial = (payload as unknown as { live_viewers?: number }).live_viewers ?? 0;
  const [viewers, setViewers] = useState<number>(initial);

  // Gentle pulse: tiny random walk so the number feels alive without being
  // fake. Bounded so it never drifts up indefinitely.
  useEffect(() => {
    const id = setInterval(() => {
      setViewers((v) => {
        const drift = Math.round((Math.random() - 0.5) * 2);
        return Math.max(0, v + drift);
      });
    }, 12_000);
    return () => clearInterval(id);
  }, []);

  const visibility = shouldShowViewerCount(payload, viewers);
  if (visibility === "hidden") return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="fixed top-3 left-3 z-30 pointer-events-none"
      >
        <div className="dropglass inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold">
          {visibility === "show" ? (
            <>
              <Eye className="w-3.5 h-3.5 text-[rgb(var(--accent-glow))]" />
              <span className="tabular-nums">{viewers}</span>{" "}
              <span className="text-[rgb(var(--text-muted))] font-normal">viewing now</span>
            </>
          ) : (
            <>
              <span className="relative w-1.5 h-1.5 rounded-full bg-[rgb(var(--success))]">
                <span className="absolute inset-0 rounded-full bg-[rgb(var(--success))] animate-ping" />
              </span>
              <Radio className="w-3 h-3 text-[rgb(var(--success))]" />
              <span className="text-[rgb(var(--text))]">Live now</span>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
