import type { CartLine } from "./cart";

/**
 * Bulk savings tiers (applied across total item count in the bag, any mix).
 * Editable from one place — rates the founder will revise later.
 */
export const BULK_TIERS: { qty: number; discount: number; label: string }[] = [
  { qty: 2, discount: 40, label: "2 pieces · $40 off" },
  { qty: 3, discount: 90, label: "3 pieces · $90 off" },
];

export function computeBulkDiscount(lines: CartLine[]): { amount: number; tier: typeof BULK_TIERS[number] | null } {
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const tier = [...BULK_TIERS].reverse().find((t) => totalQty >= t.qty) ?? null;
  return { amount: tier?.discount ?? 0, tier };
}

/** Complimentary worldwide shipping over $2000 — $1000 for Nigeria. */
export function shippingThreshold(country?: string | null): number {
  const c = (country ?? "").trim().toLowerCase();
  if (!c) return 2000;
  if (c === "nigeria" || c === "ng" || c === "nga") return 1000;
  return 2000;
}

export function isFreeShipping(itemsSubtotalAfterDiscount: number, country?: string | null) {
  return itemsSubtotalAfterDiscount >= shippingThreshold(country);
}

export function computeOrderTotals(lines: CartLine[], country?: string | null) {
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const { amount: bulkDiscount, tier } = computeBulkDiscount(lines);
  const afterDiscount = Math.max(0, subtotal - bulkDiscount);
  const threshold = shippingThreshold(country);
  const freeShipping = afterDiscount >= threshold;
  const amountToFreeShipping = Math.max(0, threshold - afterDiscount);
  const total = afterDiscount; // shipping fee handled by concierge at confirmation
  return {
    subtotal,
    bulkDiscount,
    bulkTier: tier,
    afterDiscount,
    freeShipping,
    shippingThreshold: threshold,
    amountToFreeShipping,
    total,
  };
}
