import { useCurrency } from "@/lib/useStore";
import { fmt } from "@/lib/storefront";

/**
 * Price renderer for the demo home blocks.
 * - `usd`: canonical USD amount
 * - `ngnOverride`: explicit NGN amount for Naira display
 * - `forceUsd`: render USD regardless of active currency
 * Uses the storefront display-currency store; never does client FX math.
 */
export function Price({
  usd,
  ngnOverride,
  forceUsd,
  className,
}: {
  usd: number;
  ngnOverride?: number;
  forceUsd?: boolean;
  className?: string;
}) {
  const [currency] = useCurrency();
  const cur = forceUsd ? "USD" : currency;
  const amount = cur === "USD" ? usd : (ngnOverride ?? usd);
  return <span className={className}>{fmt(amount, cur)}</span>;
}
