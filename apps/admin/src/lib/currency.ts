/**
 * Customer-facing currency store for sales-campaign landing pages.
 *
 * SSOT split:
 *  • STATIC FX (this store)   — the campaign's `ngn_per_usd_rate`, used
 *    purely to display prices on the landing page when the visitor flips
 *    the toggle. Stable for the whole drop so the price never wobbles.
 *  • LIVE  FX (server-side)   — captured into `sales_orders.fx_rate_used`
 *    at payment time. Used to settle orders, book realised FX gain/loss,
 *    and price everything in the admin (orders, quotes, accounting).
 *
 * Initial pick:
 *  1. Persisted user choice (localStorage) wins if the visitor has flipped
 *     the toggle before.
 *  2. Otherwise GeoIP (MaxMind via /api/public/geo/currency): NG → NGN,
 *     everything else → USD when a rate is available.
 *  3. Final fallback: NGN.
 *
 * Rounding rule (owner directive): never show decimals on USD — always
 * round UP, so a 10.29 USD price becomes 11. NGN keeps two decimals only
 * when the source number does.
 */

import { useEffect, useMemo } from "react";
import { create } from "zustand";

export type DisplayCurrency = "NGN" | "USD";

const STORAGE_KEY = "pgh.salesCurrency";

interface CurrencyState {
  currency: DisplayCurrency;
  /** Set true once a real choice (user toggle OR GeoIP result) has been
   *  applied — used to avoid replaying the GeoIP pick on every navigation. */
  resolved: boolean;
  setCurrency: (c: DisplayCurrency, opts?: { persist?: boolean }) => void;
  /** Apply a GeoIP-derived default. No-op if the user has already chosen. */
  applyGeoDefault: (c: DisplayCurrency) => void;
}

function readStored(): DisplayCurrency | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "USD" || v === "NGN" ? v : null;
  } catch {
    return null;
  }
}

function persist(c: DisplayCurrency) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, c);
  } catch {
    /* private mode, full disk — ignore */
  }
}

export const useCurrencyStore = create<CurrencyState>((set, get) => {
  const stored = readStored();
  return {
    currency: stored || "NGN",
    resolved: stored != null,
    setCurrency: (c, opts) => {
      const persistChoice = opts?.persist !== false;
      if (persistChoice) persist(c);
      set({ currency: c, resolved: true });
    },
    applyGeoDefault: (c) => {
      if (get().resolved) return;
      set({ currency: c, resolved: true });
    },
  };
});

/**
 * Fetch the visitor's geo-derived default currency on first mount and apply
 * it to the store (unless they've already chosen one). Best-effort: a failed
 * lookup just leaves the default in place. Backed by the local MaxMind
 * GeoLite2-Country database (zero external calls).
 */
export function useGeoCurrencyInit(enabled = true) {
  const applyGeoDefault = useCurrencyStore((s) => s.applyGeoDefault);
  const resolved = useCurrencyStore((s) => s.resolved);
  useEffect(() => {
    if (!enabled || resolved) return;
    let cancelled = false;
    (async () => {
      try {
        const apiRoot =
          (import.meta as unknown as { env?: { VITE_API_ROOT?: string } })
            .env?.VITE_API_ROOT || "/api";
        const res = await fetch(`${apiRoot}/public/geo/currency`, {
          credentials: "omit",
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { country: string | null; currency: string | null };
        };
        if (cancelled) return;
        const cur = body?.data?.currency;
        const country = body?.data?.country;
        // NG → NGN; anywhere else with a real reading → USD. Unknown geo
        // (private IP, mmdb missing) leaves the default unchanged.
        if (country === "NG" || cur === "NGN") applyGeoDefault("NGN");
        else if (cur && cur !== "NGN") applyGeoDefault("USD");
      } catch {
        /* offline / blocked — stay on the default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, resolved, applyGeoDefault]);
}

/**
 * Format an NGN figure for display using the active currency. Returns null
 * when the input is not a finite positive number so callers can hide the
 * label cleanly (the source data is messy — null / undefined / strings).
 *
 * Rounding: USD is `Math.ceil` to a whole dollar — never decimals (owner
 * directive: 10.29 USD → $11). NGN is integer-rounded too so the toggle
 * never reveals trailing kobo on conversion.
 */
export function formatPrice(
  ngn: number | null | undefined,
  currency: DisplayCurrency,
  fxRate: number | null,
): string | null {
  const n = Number(ngn);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (currency === "USD") {
    if (!fxRate || fxRate <= 0) return null;
    const usd = Math.ceil(n / fxRate);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(usd);
  }
  const ngnInt = Math.ceil(n);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(ngnInt);
}

/** Hook variant of formatPrice that re-renders when the currency flips. */
export function usePrice(
  ngn: number | null | undefined,
  fxRate: number | null,
): string | null {
  const currency = useCurrencyStore((s) => s.currency);
  return useMemo(() => formatPrice(ngn, currency, fxRate), [
    ngn,
    currency,
    fxRate,
  ]);
}

/** When the FX rate is null/0 the USD toggle is meaningless — used by the
 *  floater to hide itself and by the active store to clamp to NGN. */
export function isUsdEnabled(fxRate: number | null | undefined): boolean {
  return Number.isFinite(Number(fxRate)) && Number(fxRate) > 0;
}
