import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrencies } from "./storefront";
import { activeCurrencies, setCurrencyRuntime, type CurrencyInfo } from "./money";
import { useCurrency, CURRENCY_KEY } from "./useStore";

/**
 * Load the parametric currency feed once (deduped by react-query) and hydrate
 * the client currency runtime (rates/symbols) from it. Also applies the geo
 * default currency the FIRST time — a visitor outside Nigeria sees their own
 * currency until they pick another. Mounted at the app root; the currency
 * toolbar calls it too (same cached query) to render the live list.
 */
export function useCurrencyFeed(): {
  currencies: CurrencyInfo[];
  feedDefault: string;
} {
  const q = useQuery({
    queryKey: ["currencies"],
    queryFn: () => getCurrencies(),
    staleTime: 5 * 60_000,
  });
  const [, setCurrency] = useCurrency();

  useEffect(() => {
    const list = q.data?.currencies;
    if (!list || !list.length) return;
    setCurrencyRuntime(list);
    try {
      // Apply the GeoIP default only when the visitor hasn't already chosen this
      // session (sessionStorage, matching the landing — re-resolves each visit).
      if (
        typeof window !== "undefined" &&
        !window.sessionStorage.getItem(CURRENCY_KEY) &&
        q.data?.default
      ) {
        setCurrency(q.data.default);
      }
    } catch {
      /* private mode — keep the default */
    }
  }, [q.data, setCurrency]);

  return {
    currencies: q.data?.currencies ?? activeCurrencies(),
    feedDefault: q.data?.default ?? "NGN",
  };
}
