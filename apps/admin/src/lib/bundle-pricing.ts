/**
 * Bundle economics — the live preview twin of the backend's
 * `computeBundleEconomics` (src/modules/retention/bundle.service.js).
 *
 * The editor needs the real price + saving to update the instant you change
 * the discount or add a product — before Save round-trips to the server. This
 * mirrors the server math exactly (same per-model rules, same clamp) so the
 * preview never disagrees with what's stored, or with what a customer is
 * charged. Backend is decimal.js; here we keep the arithmetic in integer-safe
 * NGN whole units and round once at the end, which matches for the 2dp money
 * the platform uses. A parity test guards the shared cases.
 */

export interface BundleEconomics {
  /** Σ component unit price × quantity (the gross "components total"). */
  subtotal: number;
  /** The amount taken off (always ≥ 0, never more than the subtotal). */
  discount: number;
  /** What the customer actually pays = subtotal − discount (never < 0). */
  effective: number;
  /** Σ component quantities (a qty-2 line counts twice). */
  units: number;
}

export interface BundleEconomicsInput {
  pricing_model: string;
  /** Fraction for pct_off (0.10 = 10%); ₦/unit for amount_off. */
  discount_value?: number | null;
  /** The flat price for fixed_bundle_price. */
  bundle_price_ngn?: number | null;
  subtotal_ngn: number;
  units: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeBundleEconomics({
  pricing_model,
  discount_value,
  bundle_price_ngn,
  subtotal_ngn,
  units,
}: BundleEconomicsInput): BundleEconomics {
  const subtotal = Math.max(0, Number(subtotal_ngn) || 0);
  const unitCount = Math.max(1, Number(units) || 0);
  let discount = 0;
  let effective = subtotal;

  switch (pricing_model) {
    case "fixed_bundle_price": {
      effective = Math.max(0, Number(bundle_price_ngn) || 0);
      discount = subtotal > effective ? subtotal - effective : 0;
      break;
    }
    case "pct_off": {
      discount = subtotal * (Number(discount_value) || 0);
      if (discount > subtotal) discount = subtotal;
      effective = subtotal - discount;
      break;
    }
    case "amount_off": {
      discount = (Number(discount_value) || 0) * unitCount;
      if (discount > subtotal) discount = subtotal;
      effective = subtotal - discount;
      break;
    }
    default:
      // buy_x_get_y / tiered_qty need per-line context — not previewable here.
      discount = 0;
      effective = subtotal;
  }
  if (effective < 0) effective = 0;
  return {
    subtotal: round2(subtotal),
    discount: round2(discount),
    effective: round2(effective),
    units: unitCount,
  };
}

/** Sum a component list to { subtotal, units } from each line's unit price ×
 *  quantity — matches the backend's componentTotals. */
export function componentTotals(
  components: { unit_price_ngn?: number | null; quantity?: number | null }[],
): { subtotal: number; units: number } {
  let subtotal = 0;
  let units = 0;
  for (const c of components) {
    const qty = Number(c.quantity) || 1;
    subtotal += (Number(c.unit_price_ngn) || 0) * qty;
    units += qty;
  }
  return { subtotal, units };
}
