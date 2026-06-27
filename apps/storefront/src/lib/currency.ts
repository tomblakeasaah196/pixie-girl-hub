import { api, type ApiContext } from "./api";

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

export type Currency = "NGN" | "USD";

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

const NGN = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});
const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * Format a money value the backend already provided in the target currency.
 * NEVER convert NGN↔USD on the client — pass the matching `price_*` field.
 */
export function formatMoney(amount: number | string, currency: Currency): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return currency === "USD" ? "$—" : "₦—";
  return currency === "USD" ? USD.format(n) : NGN.format(n);
}
