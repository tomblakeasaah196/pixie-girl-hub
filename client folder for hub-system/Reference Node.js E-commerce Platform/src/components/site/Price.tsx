import { useCurrency } from "@/lib/currency";
import { getProduct } from "@/lib/products";

/**
 * Centralised price renderer.
 * - `usd`: canonical USD amount (already includes qty multiplier when used in line items)
 * - `slug` + `qty`: resolves the product's hand-set NGN price × qty for Naira display
 * - `ngnOverride`: explicit NGN amount, takes precedence over slug lookup
 * - `forceUsd`: render as USD regardless of active currency (used at checkout review for non-NGN)
 */
export function Price({
  usd, slug, qty = 1, ngnOverride, forceUsd, className,
}: { usd: number; slug?: string; qty?: number; ngnOverride?: number; forceUsd?: boolean; className?: string }) {
  const { format } = useCurrency();
  const ngn =
    ngnOverride ??
    (slug ? (getProduct(slug)?.priceNgn ?? 0) * qty || undefined : undefined);
  return <span className={className}>{format(usd, { ngnOverride: ngn, forceUsd })}</span>;
}
