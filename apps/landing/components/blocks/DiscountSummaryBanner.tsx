"use client";

import { useState } from "react";
import { ChevronRight, Tag } from "lucide-react";
import type { LandingPayload } from "@/lib/types";
import { SALE_RED, dealMechanisms } from "@/lib/deals";
import { DealExplainerModal } from "./DealExplainerModal";

export function DiscountSummaryBanner({
  payload,
}: {
  payload: LandingPayload;
}) {
  const [open, setOpen] = useState(false);
  const mechanisms = dealMechanisms(payload);
  if (mechanisms.length === 0) return null;

  const hasLadder = mechanisms.some((m) => m.id === "position_ladder");
  const hasBulk = mechanisms.some((m) => m.id === "bulk_tier");
  const hasStacking = mechanisms.some((m) => m.id === "stacking_bonus");
  const count = mechanisms.length;

  let headline = "This is a sale — every wig saves you money.";
  if (hasLadder && hasBulk) {
    headline =
      "This is a sale — save more on every wig you add, plus deep wholesale rates.";
  } else if (hasLadder) {
    headline = "This is a sale — every wig you add saves you even more.";
  } else if (hasBulk) {
    headline =
      "This is a sale — bulk buyers unlock wholesale prices automatically.";
  } else if (hasStacking) {
    headline = "This is a sale — mix bundles and stack your savings.";
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-center gap-2 py-3.5 px-4 text-white font-semibold text-[13px] sm:text-[14px] transition-opacity hover:opacity-90 active:opacity-80"
        style={{ background: SALE_RED }}
        aria-label="See all the ways you save in this sale"
      >
        <Tag className="w-4 h-4 flex-shrink-0" />
        <span className="text-center">
          {headline}{" "}
          <span className="underline underline-offset-2 inline-flex items-center gap-0.5 whitespace-nowrap">
            See all {count} way{count !== 1 ? "s" : ""} to save
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </span>
      </button>
      <DealExplainerModal
        payload={payload}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
