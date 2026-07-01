import { useEffect, useState, useCallback } from "react";
import { getCart, type Currency } from "./storefront";

/**
 * Tiny client stores (no external state lib needed for this surface):
 *  - useCurrency: display currency, persisted, broadcast across components.
 *  - useCartCount: live cart item count, refreshed on a global event.
 * SSR-safe: defaults on the server, hydrates on the client.
 */

const CURRENCY_KEY = "sf_currency";
const CART_EVENT = "sf:cart-changed";
const CURRENCY_EVENT = "sf:currency-changed";

export function notifyCartChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(CART_EVENT));
}

export function useCurrency(): [Currency, (c: Currency) => void] {
  const [currency, setCurrencyState] = useState<Currency>("NGN");

  useEffect(() => {
    const stored = window.localStorage.getItem(CURRENCY_KEY) as Currency | null;
    if (stored === "NGN" || stored === "USD") setCurrencyState(stored);
    const onChange = () => {
      const v = window.localStorage.getItem(CURRENCY_KEY) as Currency | null;
      if (v === "NGN" || v === "USD") setCurrencyState(v);
    };
    window.addEventListener(CURRENCY_EVENT, onChange);
    return () => window.removeEventListener(CURRENCY_EVENT, onChange);
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    window.localStorage.setItem(CURRENCY_KEY, c);
    setCurrencyState(c);
    window.dispatchEvent(new Event(CURRENCY_EVENT));
  }, []);

  return [currency, setCurrency];
}

const CART_OPEN_EVENT = "sf:cart-open";

/** Open the bag slide-over from anywhere (e.g. the header Bag button). */
export function openCart() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT, { detail: true }));
}

/** Shared open state for the cart drawer — event-backed so header + drawer sync. */
export function useCartDrawer(): { open: boolean; setOpen: (o: boolean) => void } {
  const [open, setOpenState] = useState(false);
  useEffect(() => {
    const h = (e: Event) => setOpenState(Boolean((e as CustomEvent).detail));
    window.addEventListener(CART_OPEN_EVENT, h);
    return () => window.removeEventListener(CART_OPEN_EVENT, h);
  }, []);
  const setOpen = (o: boolean) =>
    window.dispatchEvent(new CustomEvent(CART_OPEN_EVENT, { detail: o }));
  return { open, setOpen };
}

export function useCartCount(): number {
  const [count, setCount] = useState(0);
  const refresh = useCallback(() => {
    getCart()
      .then((cart) => {
        const items = (cart && cart.items) || [];
        setCount(items.reduce((n, i) => n + (Number(i.quantity) || 0), 0));
      })
      .catch(() => setCount(0));
  }, []);
  useEffect(() => {
    refresh();
    window.addEventListener("sf:cart-changed", refresh);
    return () => window.removeEventListener("sf:cart-changed", refresh);
  }, [refresh]);
  return count;
}
