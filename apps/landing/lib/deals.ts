import type { LandingPayload, LandingProduct } from "@/lib/types";
import { money } from "@/lib/format";

export const SALE_RED = "#E11414";
export const SALE_RED_SOFT = "#FDE8E8";

export interface CardHeadline {
  beforeNgn: number;
  nowNgn: number;
  saveNgn: number;
  pctOff: number;
  /** Short label shown under the badge, e.g. "On your 1st wig" */
  conditionLabel: string;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Returns the honest headline deal for a product card.
 *
 * Priority:
 *  1. Per-product campaign_price_ngn (explicit was/now)
 *  2. 1st rung of the position ladder (teaser — the full breakdown is in the
 *     explainer modal; the cart shows the real summed total)
 *  3. Top-level campaign discount (% or fixed)
 *  4. Lowest bulk tier teaser (wholesale only)
 *
 * Returns null when nothing applies so the badge stays hidden.
 */
export function cardHeadline(
  product: LandingProduct,
  payload: LandingPayload,
): CardHeadline | null {
  const retail = Number(product.regular_price_ngn || 0);
  const campaign = Number(product.campaign_price_ngn || 0);

  if (campaign > 0 && retail > 0 && retail > campaign) {
    const save = retail - campaign;
    return {
      beforeNgn: retail,
      nowNgn: campaign,
      saveNgn: save,
      pctOff: Math.round((save / retail) * 100),
      conditionLabel: "Sale price",
    };
  }

  const ladder = (payload.position_ladder || []).sort(
    (a, b) => a.position - b.position,
  );
  const firstRung = ladder[0];
  if (firstRung && firstRung.discount_ngn > 0 && retail > 0) {
    const nowNgn = retail - firstRung.discount_ngn;
    if (nowNgn > 0) {
      return {
        beforeNgn: retail,
        nowNgn,
        saveNgn: firstRung.discount_ngn,
        pctOff: Math.round((firstRung.discount_ngn / retail) * 100),
        conditionLabel: `On your ${ordinal(firstRung.position)} wig`,
      };
    }
  }

  const { discount_type: dt, discount_value: dv } = payload;
  if (dt === "percentage" && dv && dv > 0 && retail > 0) {
    const save = Math.round(retail * Number(dv));
    const nowNgn = retail - save;
    if (nowNgn > 0) {
      return {
        beforeNgn: retail,
        nowNgn,
        saveNgn: save,
        pctOff: Math.round(Number(dv) * 100),
        conditionLabel: "Campaign discount",
      };
    }
  }
  if (dt === "fixed_amount" && dv && dv > 0 && retail > 0) {
    const save = Math.round(Number(dv));
    const nowNgn = retail - save;
    if (nowNgn > 0) {
      return {
        beforeNgn: retail,
        nowNgn,
        saveNgn: save,
        pctOff: Math.round((save / retail) * 100),
        conditionLabel: "Campaign discount",
      };
    }
  }

  const bulk = (payload.bulk_tiers || [])
    .filter((t) => t.min_qty > 0 && t.discount_per_item_ngn > 0)
    .sort((a, b) => a.min_qty - b.min_qty);
  const firstBulk = bulk[0];
  if (firstBulk && retail > 0) {
    const nowNgn = retail - firstBulk.discount_per_item_ngn;
    if (nowNgn > 0) {
      return {
        beforeNgn: retail,
        nowNgn,
        saveNgn: firstBulk.discount_per_item_ngn,
        pctOff: Math.round((firstBulk.discount_per_item_ngn / retail) * 100),
        conditionLabel: `Wholesale (${firstBulk.min_qty}+)`,
      };
    }
  }

  return null;
}

export interface DealMechanism {
  id: string;
  headline: string;
  detail: string;
}

/** Ordered, plain-English list of every active discount mechanism. */
export function dealMechanisms(payload: LandingPayload): DealMechanism[] {
  const out: DealMechanism[] = [];

  const ladder = (payload.position_ladder || []).sort(
    (a, b) => a.position - b.position,
  );
  if (ladder.length > 0) {
    const details = ladder
      .map((r) => {
        const label = r.label ? ` (${r.label})` : "";
        return `Your ${ordinal(r.position)} wig: ${money(r.discount_ngn)} off${label}`;
      })
      .join(". ");
    out.push({
      id: "position_ladder",
      headline: "The more wigs you buy, the more each one saves",
      detail:
        details +
        ". Every wig in your cart gets its own reduction — it all adds up before you pay.",
    });
  }

  const qtTiers = (payload.tiers || []).sort(
    (a, b) => a.min_quantity - b.min_quantity,
  );
  if (qtTiers.length > 0) {
    const details = qtTiers
      .map(
        (t) =>
          `${t.min_quantity}+ items${t.label ? ` (${t.label})` : ""}: extra ${money(t.fixed_discount_ngn)} off your total`,
      )
      .join(". ");
    out.push({
      id: "quantity_tier",
      headline: "Hit a quantity milestone, save even more",
      detail: details + ".",
    });
  }

  if (payload.stacking_bonus) {
    const sb = payload.stacking_bonus;
    out.push({
      id: "stacking_bonus",
      headline: "Mix bundles and your savings multiply",
      detail: `Add ${sb.min_distinct_bundles}+ different bundles${sb.label ? ` (${sb.label})` : ""} and unlock an extra ${money(sb.discount_ngn)} off your entire order. Our way of rewarding the full wardrobe.`,
    });
  }

  const bulkTiers = (payload.bulk_tiers || [])
    .filter((t) => t.min_qty > 0 && t.discount_per_item_ngn > 0)
    .sort((a, b) => a.min_qty - b.min_qty);
  if (bulkTiers.length > 0) {
    const details = bulkTiers
      .map(
        (t) =>
          `${t.min_qty}+ raw wigs${t.label ? ` (${t.label})` : ""}: ${money(t.discount_per_item_ngn)} off each`,
      )
      .join(". ");
    out.push({
      id: "bulk_tier",
      headline: "Wholesale rate — for resellers and bulk buyers",
      detail:
        "Ordering raw (unstyled) wigs in volume? These rates unlock automatically at checkout. " +
        details +
        ". All raw wigs in your cart — across any style — count toward the threshold.",
    });
  }

  return out;
}
