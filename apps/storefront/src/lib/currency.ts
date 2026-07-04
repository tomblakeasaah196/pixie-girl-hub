import { api, type ApiContext } from "./api";
import { formatCurrency } from "./money";

/**
 * Geo + display currency.
 *
 * The Aura reference shipped a STUB geo (src/lib/geo.ts) that it flagged should
 * call MaxMind. The Hub already does this server-side (src/services/geoip.js +
 * the geo-currency middleware), exposed at `/api/public/geo/currency`. So the
 * website just consumes it — no client GeoIP, no FX math.
 *
 * NGN is canonical. NG → NGN; elsewhere → USD (charged via Nomba; Stripe later).
 * The user can override display currency via the header toggle (cookie-persisted
 * server-side); this resolver returns the server's decision.
 */

// A currency CODE. Widened from "NGN" | "USD" so any admin-activated currency
// flows through unchanged; the active set + rates come from the currency feed.
export type Currency = string;

export interface GeoCurrency {
  country_code: string;
  currency: Currency;
  /** Charge currency the checkout will actually use. */
  charge_currency: Currency;
  rate_to_ngn?: number;
}

export async function getGeoCurrency(ctx?: ApiContext): Promise<GeoCurrency> {
  try {
    return await api.get<GeoCurrency>("/api/public/geo/currency", ctx);
  } catch {
    // Safe canonical fallback if geo is unavailable.
    return { country_code: "NG", currency: "NGN", charge_currency: "NGN" };
  }
}

/**
 * Format a money value ALREADY denominated in `currency` (a server-provided
 * *_display figure, or an amount converted via lib/money). Parametric across
 * any active currency — the symbol/decimals come from the currency runtime.
 */
export function formatMoney(amount: number | string, currency: Currency): string {
  return formatCurrency(amount, currency);
}
