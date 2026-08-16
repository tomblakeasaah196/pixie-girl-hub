/**
 * Sales pricing — order-amendment diffing (§6.2 "Change Order").
 *
 * PURE. Given the order's current lines and the replacement set the operator
 * built in the Change Order modal, work out:
 *
 *   • what actually changed, line by line (added / removed / quantity / price)
 *   • the NET stock movement per variant — the only number the stock
 *     reconciliation may act on. Swapping wig A for wig B is A −1 and B +1;
 *     bumping A from 1 to 3 is A +2. Computing this per-variant rather than
 *     per-line is what stops a "swap this size for that size of the same base"
 *     from releasing and re-reserving the identical unit (and failing the
 *     second half when it was the last one on the shelf).
 *   • a plain-English summary for the customer's "your order was updated"
 *     message.
 *
 * Nothing here touches the database, money is handled by the caller via
 * decimal.js, and quantities are plain integers — so every branch is unit
 * testable (tests/unit/sales/amendment-diff.test.js).
 */

"use strict";

/** "Nala Sleek Bangs — Medium" for a line, from whichever snapshot exists. */
function describeLine(line) {
  const name = line.product_name_snapshot || "Item";
  const variant = line.variant_label_snapshot;
  return variant ? `${name} — ${variant}` : name;
}

/**
 * Net stock movement per variant across the whole amendment.
 *
 * @returns {Map<string, number>} variant_id → signed unit delta.
 *   positive = the order now needs MORE of this variant,
 *   negative = units are coming back.
 * Service lines (no variant_id) never appear.
 */
function netVariantDelta(beforeLines, afterLines) {
  const delta = new Map();
  const bump = (variant_id, qty) => {
    if (!variant_id) return; // service line — nothing to move
    const next = (delta.get(variant_id) || 0) + qty;
    if (next === 0) delta.delete(variant_id);
    else delta.set(variant_id, next);
  };
  for (const l of beforeLines) bump(l.variant_id, -Number(l.quantity || 0));
  for (const l of afterLines) bump(l.variant_id, Number(l.quantity || 0));
  return delta;
}

/**
 * Line-by-line change list.
 *
 * `afterLines` carry `_source_line_id` when the operator kept an existing line
 * (the modal round-trips `line_id`); a line without one is new.
 *
 * @returns {Array<{action, line_id?, name, quantity?, from?, to?, unit_price_ngn?}>}
 *   Only genuine changes are emitted — an untouched line produces nothing, so
 *   an empty array means "the lines are identical" and the caller can tell the
 *   operator there is nothing to change.
 */
function buildLineChanges(beforeLines, afterLines) {
  const changes = [];
  const afterBySource = new Map();
  for (const a of afterLines) {
    if (a._source_line_id) afterBySource.set(a._source_line_id, a);
  }

  for (const b of beforeLines) {
    const a = afterBySource.get(b.line_id);
    if (!a) {
      changes.push({
        action: "removed",
        line_id: b.line_id,
        name: describeLine(b),
        quantity: Number(b.quantity),
        unit_price_ngn: String(b.unit_price_ngn),
      });
      continue;
    }
    const qtyBefore = Number(b.quantity);
    const qtyAfter = Number(a.quantity);
    if (qtyBefore !== qtyAfter) {
      changes.push({
        action: "quantity",
        line_id: b.line_id,
        name: describeLine(b),
        from: qtyBefore,
        to: qtyAfter,
      });
    }
    // String compare would flag "5000" vs "5000.00"; compare as numbers and
    // let the caller's decimal arithmetic own the money itself.
    const priceBefore = Number(b.unit_price_ngn);
    const priceAfter = Number(a.unit_price_ngn);
    if (priceBefore !== priceAfter) {
      changes.push({
        action: "price",
        line_id: b.line_id,
        name: describeLine(b),
        from: priceBefore,
        to: priceAfter,
      });
    }
  }

  for (const a of afterLines) {
    if (a._source_line_id) continue;
    changes.push({
      action: "added",
      name: describeLine(a),
      quantity: Number(a.quantity),
      unit_price_ngn: String(a.unit_price_ngn),
    });
  }

  return changes;
}

/**
 * One-paragraph, customer-safe rendering of the change list — the
 * `{{change_summary}}` token in the `order_amended` automation.
 *
 * Deliberately item-and-quantity only: no costs, no internal notes, no SKUs.
 * Returns "" when nothing about the items changed (a delivery-only amendment),
 * so the caller can substitute its own delivery sentence.
 */
function summariseChanges(changes) {
  const parts = [];
  const added = changes.filter((c) => c.action === "added");
  const removed = changes.filter((c) => c.action === "removed");
  const requantified = changes.filter((c) => c.action === "quantity");
  const repriced = changes.filter((c) => c.action === "price");

  if (removed.length) {
    parts.push(
      `Removed: ${removed.map((c) => `${c.name} ×${c.quantity}`).join(", ")}.`,
    );
  }
  if (added.length) {
    parts.push(
      `Added: ${added.map((c) => `${c.name} ×${c.quantity}`).join(", ")}.`,
    );
  }
  if (requantified.length) {
    parts.push(
      `Quantity updated: ${requantified
        .map((c) => `${c.name} (${c.from} → ${c.to})`)
        .join(", ")}.`,
    );
  }
  if (repriced.length) {
    parts.push(
      `Price updated: ${repriced.map((c) => c.name).join(", ")}.`,
    );
  }
  return parts.join(" ");
}

/**
 * Did the delivery details actually move? Compares only the fields that change
 * where a courier goes, so re-submitting the same address is correctly a no-op
 * (and never triggers a "we've updated your order" letter on its own).
 */
const DELIVERY_FIELDS = [
  "line1",
  "line2",
  "city",
  "state",
  "country",
  "country_code",
  "recipient_name",
  "recipient_phone",
];
function deliveryChanged(before, after) {
  if (!after) return false;
  const b = before || {};
  return DELIVERY_FIELDS.some(
    (f) => (b[f] ?? null) !== (after[f] === undefined ? (b[f] ?? null) : (after[f] ?? null)),
  );
}

module.exports = {
  describeLine,
  netVariantDelta,
  buildLineChanges,
  summariseChanges,
  deliveryChanged,
  DELIVERY_FIELDS,
};
