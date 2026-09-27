import { useCurrency } from "@/lib/useStore";
import { formatCurrency, formatFromNgn, rateToNgn } from "@/lib/money";

/**
 * Price renderer for the demo home blocks.
 * - `usd`: canonical USD amount
 * - `ngnOverride`: explicit NGN amount for the Naira anchor
 * - `forceUsd`: render USD regardless of active currency
 *
 * Parametric: anchors the figure in NGN (an explicit ngnOverride, else derived
 * from the canonical USD via the USD SSOT rate) and renders it in the active
 * display currency — so any admin-activated currency shows here too. Falls back
 * to the canonical USD before the currency runtime hydrates.
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
  // Dollars: the canonical (catalogue) USD price as-is — $249.99 stays $249.99,
  // exactly what checkout charges — never re-derived from Naira.
  if (cur === "USD" && Number.isFinite(usd) && usd > 0)
    return <span className={className}>{formatCurrency(usd, "USD")}</span>;
  const rateUsd = rateToNgn("USD");
  const ngn =
    ngnOverride != null ? ngnOverride : rateUsd != null ? usd * rateUsd : null;
  const text =
    ngn != null && (cur === "NGN" || rateToNgn(cur) != null)
      ? formatFromNgn(ngn, cur)
      : formatCurrency(usd, "USD");
  return <span className={className}>{text}</span>;
}
