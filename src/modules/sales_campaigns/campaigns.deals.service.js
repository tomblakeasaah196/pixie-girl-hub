/**
 * Sales Campaigns v3 — DEALS LADDER ENGINE (pure).
 *
 * The single place that turns a campaign's manually-configured deal rules
 * (set in the builder's Pricing tab) into a concrete ₦ saving for a cart.
 * Everything here is PURE given its inputs — the caller (public quote
 * endpoint + checkout) resolves prices/floors from the DB and feeds them
 * in. No I/O, no req/res, no events.
 *
 * THREE INDEPENDENT LANES (owner's rule): each mechanism discounts ONLY its own
 * slice of the cart, so they never double-dip. A cart can trigger all three at
 * once, but only when it actually contains all three kinds of item.
 *
 *   ┌ Individual-wig lane — STYLED wigs bought outside a bundle ──────────────┐
 *   │  1. position_ladder  — per-wig escalating ₦ off, SUMMED across filled    │
 *   │                        positions: 3 wigs [16k,25k,28k] ⇒ ₦69,000 off.    │
 *   │                        Positions past the last defined rung add nothing. │
 *   │  2. quantity_tier    — "buy N save X" ladder, keyed off the individual-  │
 *   │                        wig count (highest qualifying tier; single).      │
 *   ├ Bundle lane — bundles only ─────────────────────────────────────────────┤
 *   │  3. stacking_bonus   — buy ≥ N DISTINCT bundles ⇒ a one-off ₦ bonus.     │
 *   ├ Bulk / reseller lane — RAW (unstyled) base wigs only ───────────────────┤
 *   │  4. bulk_tiers       — discount_per_item_ngn × raw-wig qty (per item).   │
 *   └─────────────────────────────────────────────────────────────────────────┘
 *
 * The summed total is then clamped at the margin floor so no line can ever sell
 * below cost. The engine also returns "next rung" hints (add 1 more wig / 1
 * more bundle / N more raw wigs to unlock X) so the cart can nudge the buyer.
 */

"use strict";

const Decimal = require("decimal.js");

function d(v) {
  if (v === null || v === undefined || v === "") return new Decimal(0);
  return new Decimal(v);
}
function s2(v) {
  return d(v).toFixed(2);
}

/**
 * @typedef {Object} DealLine
 * @property {"bundle"|"styled"|"raw"} kind
 * @property {string} [bundle_id]            present for bundle lines (distinct-bundle count)
 * @property {string|number} unit_price_ngn  server-resolved unit price (never client-trusted)
 * @property {number} quantity
 * @property {number} [wig_units]            wigs this line contributes per unit (default 1;
 *                                           a bundle of 3 wigs = 3). Total wig units =
 *                                           Σ wig_units × quantity. Drives the position ladder.
 * @property {string|number|null} [floor_ngn] per-unit margin floor (NULL = no floor)
 */

/**
 * @param {Object} args
 * @param {Object} args.campaign  campaign row (position_ladder / stacking_bonus / bulk_tiers JSONB)
 * @param {DealLine[]} args.lines
 * @param {Array} [args.tiers]    sales_campaign_quantity_tiers rows
 * @returns {Object} breakdown
 */
function computeDeals({ campaign, lines = [], tiers = [] }) {
  const positionLadder = normaliseLadder(campaign && campaign.position_ladder);
  const stackingBonus = normaliseStacking(campaign && campaign.stacking_bonus);
  const bulkTiers = normaliseBulk(campaign && campaign.bulk_tiers);

  // ── Cart aggregates, split into the THREE independent lanes ──
  const totalQty = lines.reduce((a, l) => a + Number(l.quantity || 0), 0);
  // Individual-wig lane: STYLED wigs bought outside a bundle. These — and ONLY
  // these — feed the position ladder and the quantity tier. Bundles have their
  // own lane; raw wigs have theirs; so nothing double-dips.
  const styledWigUnits = lines
    .filter((l) => l.kind === "styled")
    .reduce((a, l) => a + wigUnitsOf(l) * Number(l.quantity || 0), 0);
  // Bulk / reseller lane: RAW (unstyled) base wigs.
  const rawWigQty = lines
    .filter((l) => l.kind === "raw")
    .reduce((a, l) => a + Number(l.quantity || 0), 0);
  // Bundle lane: distinct bundles in the cart.
  const distinctBundles = new Set(
    lines.filter((l) => l.kind === "bundle" && l.bundle_id).map((l) => l.bundle_id),
  ).size;

  const subtotal = lines.reduce(
    (a, l) => a.plus(d(l.unit_price_ngn).times(l.quantity || 0)),
    new Decimal(0),
  );

  // ── Individual-wig lane: position ladder (summed) + quantity tier ──
  const position = computePositionLadder(positionLadder, styledWigUnits);
  const quantityTier = computeQuantityTier(tiers, styledWigUnits);

  // ── Bundle lane: stacking bonus ──────────────────────────
  const stacking = computeStackingBonus(stackingBonus, distinctBundles);

  // ── Bulk / reseller lane: raw wigs only (per-item × qty) ──
  const bulk = computeBulkTier(bulkTiers, rawWigQty);

  // ── Sum, then clamp at the margin floor ──────────────────
  const grossDiscount = d(position.discount_ngn)
    .plus(stacking.discount_ngn)
    .plus(quantityTier.discount_ngn)
    .plus(bulk.discount_ngn);

  // Headroom = how much we can discount before any line breaches its floor.
  // Lines with no floor contribute their whole net value (can go to ₦0).
  const headroom = lines.reduce((acc, l) => {
    const lineTotal = d(l.unit_price_ngn).times(l.quantity || 0);
    if (l.floor_ngn === null || l.floor_ngn === undefined) return acc.plus(lineTotal);
    const floorTotal = d(l.floor_ngn).times(l.quantity || 0);
    const hr = lineTotal.minus(floorTotal);
    return acc.plus(hr.lt(0) ? new Decimal(0) : hr);
  }, new Decimal(0));

  let finalDiscount = grossDiscount;
  let clamped = false;
  if (finalDiscount.gt(headroom)) {
    finalDiscount = headroom.lt(0) ? new Decimal(0) : headroom;
    clamped = true;
  }
  if (finalDiscount.lt(0)) finalDiscount = new Decimal(0);

  const finalTotal = subtotal.minus(finalDiscount);

  return {
    subtotal_ngn: s2(subtotal),
    components: {
      position_ladder: position,
      stacking_bonus: stacking,
      quantity_tier: quantityTier,
      bulk_tier: bulk,
    },
    cart: {
      total_quantity: totalQty,
      styled_wig_units: styledWigUnits,
      raw_wig_quantity: rawWigQty,
      distinct_bundles: distinctBundles,
    },
    gross_discount_ngn: s2(grossDiscount),
    total_discount_ngn: s2(finalDiscount),
    final_total_ngn: s2(finalTotal.lt(0) ? new Decimal(0) : finalTotal),
    clamped,
  };
}

// ── Component calculators ──────────────────────────────────

function computePositionLadder(ladder, wigUnits) {
  if (!ladder.length || wigUnits <= 0) {
    return { applied: false, discount_ngn: "0.00", filled_positions: 0, next: nextLadderRung(ladder, wigUnits) };
  }
  // Sum the discount for each filled position. The ladder is keyed by
  // `position` (1-based); a wig at position p earns the rung whose
  // position === p. Positions beyond the highest defined rung earn nothing.
  let total = new Decimal(0);
  let filled = 0;
  for (const rung of ladder) {
    if (rung.position <= wigUnits) {
      total = total.plus(d(rung.discount_ngn));
      filled += 1;
    }
  }
  return {
    applied: total.gt(0),
    discount_ngn: s2(total),
    filled_positions: filled,
    next: nextLadderRung(ladder, wigUnits),
  };
}

function nextLadderRung(ladder, wigUnits) {
  const upcoming = ladder.find((r) => r.position > wigUnits);
  if (!upcoming) return null;
  return {
    position: upcoming.position,
    add_wigs: upcoming.position - wigUnits,
    extra_discount_ngn: s2(upcoming.discount_ngn),
    label: upcoming.label || null,
  };
}

function computeStackingBonus(bonus, distinctBundles) {
  if (!bonus) return { applied: false, discount_ngn: "0.00", next: null };
  const need = bonus.min_distinct_bundles;
  if (distinctBundles >= need) {
    return {
      applied: true,
      discount_ngn: s2(bonus.discount_ngn),
      label: bonus.label || null,
      next: null,
    };
  }
  return {
    applied: false,
    discount_ngn: "0.00",
    next: {
      add_bundles: need - distinctBundles,
      unlock_discount_ngn: s2(bonus.discount_ngn),
      label: bonus.label || null,
    },
  };
}

function computeQuantityTier(tiers, totalQty) {
  const active = (tiers || []).filter((t) => t.is_active !== false);
  const sortedDesc = [...active].sort((a, b) => b.min_quantity - a.min_quantity);
  const selected = sortedDesc.find((t) => totalQty >= t.min_quantity) || null;
  const upcoming = [...active]
    .sort((a, b) => a.min_quantity - b.min_quantity)
    .find((t) => t.min_quantity > totalQty);
  return {
    applied: !!selected,
    discount_ngn: selected ? s2(selected.fixed_discount_ngn) : "0.00",
    tier_id: selected ? selected.tier_id : null,
    label: selected ? selected.label || null : null,
    next: upcoming
      ? {
          add_quantity: upcoming.min_quantity - totalQty,
          unlock_discount_ngn: s2(upcoming.fixed_discount_ngn),
          label: upcoming.label || null,
        }
      : null,
  };
}

function computeBulkTier(bulkTiers, rawWigQty) {
  if (!bulkTiers.length || rawWigQty <= 0) {
    return {
      applied: false,
      discount_ngn: "0.00",
      next: nextBulkTier(bulkTiers, rawWigQty),
    };
  }
  const sortedDesc = [...bulkTiers].sort((a, b) => b.min_qty - a.min_qty);
  const selected = sortedDesc.find((t) => rawWigQty >= t.min_qty) || null;
  // Per-item × quantity (the buyer's chosen model).
  const discount = selected
    ? d(selected.discount_per_item_ngn).times(rawWigQty)
    : new Decimal(0);
  return {
    applied: !!selected,
    discount_ngn: s2(discount),
    per_item_ngn: selected ? s2(selected.discount_per_item_ngn) : "0.00",
    raw_wig_quantity: rawWigQty,
    label: selected ? selected.label || null : null,
    next: nextBulkTier(bulkTiers, rawWigQty),
  };
}

function nextBulkTier(bulkTiers, rawWigQty) {
  const upcoming = [...bulkTiers]
    .sort((a, b) => a.min_qty - b.min_qty)
    .find((t) => t.min_qty > rawWigQty);
  if (!upcoming) return null;
  return {
    add_raw_wigs: upcoming.min_qty - rawWigQty,
    per_item_ngn: s2(upcoming.discount_per_item_ngn),
    label: upcoming.label || null,
  };
}

// ── Normalisers (defensive: JSONB may be null / partial) ───

function normaliseLadder(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && Number.isFinite(Number(r.position)))
    .map((r) => ({
      position: Number(r.position),
      discount_ngn: Number(r.discount_ngn || 0),
      label: r.label || null,
    }))
    .sort((a, b) => a.position - b.position);
}

function normaliseStacking(raw) {
  if (!raw || !Number.isFinite(Number(raw.min_distinct_bundles))) return null;
  return {
    min_distinct_bundles: Number(raw.min_distinct_bundles),
    discount_ngn: Number(raw.discount_ngn || 0),
    label: raw.label || null,
  };
}

function normaliseBulk(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && Number.isFinite(Number(r.min_qty)))
    .map((r) => ({
      min_qty: Number(r.min_qty),
      discount_per_item_ngn: Number(r.discount_per_item_ngn || 0),
      label: r.label || null,
    }))
    .sort((a, b) => a.min_qty - b.min_qty);
}

function wigUnitsOf(line) {
  const w = Number(line.wig_units);
  if (Number.isFinite(w) && w > 0) return w;
  return 1;
}

module.exports = {
  computeDeals,
  // Exported for unit tests / reuse.
  computePositionLadder,
  computeStackingBonus,
  computeQuantityTier,
  computeBulkTier,
  normaliseLadder,
  normaliseStacking,
  normaliseBulk,
};
