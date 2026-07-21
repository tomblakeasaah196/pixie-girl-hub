/**
 * Customer-facing availability, shared by the catalogue + storefront so the
 * "in stock / pre-order / sold out" decision is computed in exactly one place.
 *
 * Universal pre-orders (000086): with a brand `policy`, any out-of-stock item
 * is offered as a PRE-ORDER unless the brand switch is off or the product is
 * opted out (`preorder_excluded`). Without a policy we fall back to the legacy
 * per-product opt-in (`base.preorder_enabled`) so existing callers are unchanged.
 */

"use strict";

const { formatDate } = require("../../utils/dates");

/** "4–8 weeks" / "6 weeks" / null (from a brand pre-order policy). */
function preorderWindowLabel(policy = {}) {
  const min = Number(policy.min_weeks) || 0;
  const max = Number(policy.max_weeks) || 0;
  if (min && max && min !== max) return `${min}–${max} weeks`;
  const w = max || min;
  return w ? `${w} week${w === 1 ? "" : "s"}` : null;
}

/**
 * @param {number} available  base units available (0 when out of stock)
 * @param {object} opts
 * @param {object} [opts.base]    { preorder_enabled, preorder_excluded,
 *                                  expected_ready_date, production_lead_days }
 * @param {object} [opts.policy]  brand policy { enabled, min_weeks, max_weeks }
 * @returns {{state:'in_stock'|'preorder'|'out_of_stock', available:number, ...}}
 */
function computeAvailability(available, { base = {}, policy = null } = {}) {
  const avail = Number(available) || 0;
  if (avail > 0) return { state: "in_stock", available: avail };

  const excluded = Boolean(base.preorder_excluded);
  const preorderOn = policy
    ? Boolean(policy.enabled)
    : Boolean(base.preorder_enabled);

  if (preorderOn && !excluded) {
    const label = policy ? preorderWindowLabel(policy) : null;
    let message;
    if (base.expected_ready_date) {
      message = `In production · ready ~${formatDate(
        base.expected_ready_date,
        String(base.expected_ready_date),
      )}`;
    } else if (base.production_lead_days) {
      message = `Made to order · ~${base.production_lead_days} days in production`;
    } else if (label) {
      message = `Made to order · ships in ~${label}`;
    } else {
      message = "Made to order · in production";
    }
    return {
      state: "preorder",
      available: 0,
      expected_ready_date: base.expected_ready_date || null,
      production_lead_days: base.production_lead_days || null,
      min_weeks: policy ? policy.min_weeks ?? null : null,
      max_weeks: policy ? policy.max_weeks ?? null : null,
      window_label: label,
      message,
    };
  }
  return { state: "out_of_stock", available: 0 };
}

module.exports = { computeAvailability, preorderWindowLabel };
