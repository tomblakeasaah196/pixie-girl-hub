import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectGeo, setGeoOverride, type GeoInfo } from "./geo";

export type Currency = "USD" | "EUR" | "GBP" | "NGN";

export const CURRENCIES: { code: Currency; symbol: string; label: string }[] = [
  { code: "USD", symbol: "$",  label: "US Dollar" },
  { code: "EUR", symbol: "€",  label: "Euro" },
  { code: "GBP", symbol: "£",  label: "British Pound" },
  { code: "NGN", symbol: "₦",  label: "Nigerian Naira" },
];

/**
 * Fallback FX rates (per 1 USD). Used when the live API hasn't responded yet,
 * fails, or — currently — when the OpenExchangeRates key is not yet wired.
 *
 * PRODUCTION TODO — request `OPENEXCHANGERATES_APP_ID` via the secrets tool and
 * replace `fetchLiveRates()` below with a real call. We already have the user's
 * key on file; this is a stub pending wiring.
 *
 *   GET https://openexchangerates.org/api/latest.json?app_id=APP_ID&base=USD
 *
 * The base plan only allows USD as base on the free tier, which matches our
 * canonical USD pricing in the catalog.
 */
export const FALLBACK_RATES: Record<Currency, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  NGN: 1650,
};

const CURRENCY_KEY = "faitlyn.currency.v1";

function currencyForCountry(code: string): Currency {
  const c = code.toUpperCase();
  if (c === "NG") return "NGN";
  if (c === "GB") return "GBP";
  if (["DE","FR","IT","ES","NL","BE","IE","PT","AT","FI","GR","LU"].includes(c)) return "EUR";
  return "USD";
}

type Ctx = {
  geo: GeoInfo;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  setCountryOverride: (code: string | null) => void;
  rates: Record<Currency, number>;
  ratesSource: "live" | "fallback";
  /** Format a USD amount in the active currency.
   *  Pass `ngnOverride` to use a hand-set Naira price (per-product). */
  format: (usd: number, opts?: { ngnOverride?: number; forceUsd?: boolean }) => string;
  /** Raw conversion (no formatting). */
  convert: (usd: number, ngnOverride?: number) => { value: number; currency: Currency };
};

const CurrencyContext = createContext<Ctx | null>(null);

async function fetchLiveRates(): Promise<Record<Currency, number> | null> {
  // PRODUCTION TODO — replace with real OpenExchangeRates call once the
  // `OPENEXCHANGERATES_APP_ID` secret is wired through a server function.
  // The free tier endpoint is:
  //   `https://openexchangerates.org/api/latest.json?app_id=${APP_ID}`
  // Until then we return null so the provider uses FALLBACK_RATES.
  return null;
}

function formatNumber(value: number, currency: Currency): string {
  const sym = CURRENCIES.find((c) => c.code === currency)?.symbol ?? "";
  if (currency === "NGN") {
    // Round to nearest 100 Naira for retail cleanliness
    const rounded = Math.round(value / 100) * 100;
    return `${sym}${rounded.toLocaleString("en-NG")}`;
  }
  // USD/EUR/GBP — whole dollars (the catalog is whole-dollar priced)
  const rounded = Math.round(value);
  return `${sym}${rounded.toLocaleString("en-US")}`;
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [geo, setGeo] = useState<GeoInfo>(() => detectGeo());
  const [currency, setCurrencyState] = useState<Currency>(() => {
    if (typeof window === "undefined") return "NGN";
    try {
      const saved = localStorage.getItem(CURRENCY_KEY) as Currency | null;
      if (saved && CURRENCIES.some((c) => c.code === saved)) return saved;
    } catch {}
    return currencyForCountry(detectGeo().countryCode);
  });
  const [rates, setRates] = useState<Record<Currency, number>>(FALLBACK_RATES);
  const [ratesSource, setRatesSource] = useState<"live" | "fallback">("fallback");

  useEffect(() => {
    let alive = true;
    fetchLiveRates().then((r) => {
      if (!alive || !r) return;
      setRates(r);
      setRatesSource("live");
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    try { localStorage.setItem(CURRENCY_KEY, c); } catch {}
  };

  const setCountryOverride = (code: string | null) => {
    setGeoOverride(code);
    const next = detectGeo();
    setGeo(next);
    // Re-derive currency from new country unless the user explicitly chose one.
    try {
      const saved = localStorage.getItem(CURRENCY_KEY);
      if (!saved) setCurrencyState(currencyForCountry(next.countryCode));
    } catch {
      setCurrencyState(currencyForCountry(next.countryCode));
    }
  };

  const value = useMemo<Ctx>(() => ({
    geo,
    currency,
    setCurrency,
    setCountryOverride,
    rates,
    ratesSource,
    convert(usd, ngnOverride) {
      if (currency === "NGN" && ngnOverride != null) {
        return { value: ngnOverride, currency: "NGN" };
      }
      return { value: usd * (rates[currency] ?? 1), currency };
    },
    format(usd, opts) {
      if (opts?.forceUsd) return formatNumber(usd, "USD");
      if (currency === "NGN" && opts?.ngnOverride != null) {
        return formatNumber(opts.ngnOverride, "NGN");
      }
      return formatNumber(usd * (rates[currency] ?? 1), currency);
    },
  }), [geo, currency, rates, ratesSource]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency() {
  const c = useContext(CurrencyContext);
  if (!c) throw new Error("useCurrency outside CurrencyProvider");
  return c;
}

/** Whether checkout should settle in NGN (Paystack/Nomba) vs USD (Stripe). */
export function settlementCurrency(currency: Currency): "NGN" | "USD" {
  return currency === "NGN" ? "NGN" : "USD";
}
