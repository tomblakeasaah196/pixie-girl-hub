import { useEffect, useReducer, useState, useCallback } from "react";
import { getCart, type Currency } from "./storefront";

/**
 * Tiny client stores (no external state lib needed for this surface):
 *  - useCurrency: display currency, persisted, broadcast across components.
 *  - useCartCount: live cart item count, refreshed on a global event.
 * SSR-safe: defaults on the server, hydrates on the client.
 */

export const CURRENCY_KEY = "sf_currency";
// P0-3: a captured customer referral code lives here until checkout consumes
// it. Simple key/value in localStorage — checkout reads it on mount, forwards
// it to createOrder as customer_referral_code, then clears it on success.
export const REFERRAL_KEY = "sf_referral_code";
const CART_EVENT = "sf:cart-changed";
const CURRENCY_EVENT = "sf:currency-changed";
// Fired by lib/money when the currency runtime (rates/symbols) hydrates from the
// server feed. useCurrency re-renders on it so prices convert once rates land.
const CURRENCY_RUNTIME_EVENT = "sf:currency-runtime";

export function notifyCartChanged() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(CART_EVENT));
}

export function useCurrency(): [Currency, (c: Currency) => void] {
  const [currency, setCurrencyState] = useState<Currency>("NGN");
  // Re-render when the currency runtime hydrates so module-cached rates take
  // effect on already-mounted price components (priceFor reads that cache).
  const [, bump] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const stored = window.localStorage.getItem(CURRENCY_KEY);
    if (stored) setCurrencyState(stored);
    const onChange = () => {
      const v = window.localStorage.getItem(CURRENCY_KEY);
      if (v) setCurrencyState(v);
    };
    window.addEventListener(CURRENCY_EVENT, onChange);
    window.addEventListener(CURRENCY_RUNTIME_EVENT, bump);
    return () => {
      window.removeEventListener(CURRENCY_EVENT, onChange);
      window.removeEventListener(CURRENCY_RUNTIME_EVENT, bump);
    };
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

const HELP_OPEN_EVENT = "sf:help-open";

/** Open the "How to shop" help guide from anywhere (header icon, footer link). */
export function openHelp() {
  if (typeof window !== "undefined")
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT, { detail: true }));
}

/** Shared open state for the help guide — event-backed so any trigger syncs. */
export function useHelpOpen(): { open: boolean; setOpen: (o: boolean) => void } {
  const [open, setOpenState] = useState(false);
  useEffect(() => {
    const h = (e: Event) => setOpenState(Boolean((e as CustomEvent).detail));
    window.addEventListener(HELP_OPEN_EVENT, h);
    return () => window.removeEventListener(HELP_OPEN_EVENT, h);
  }, []);
  const setOpen = (o: boolean) =>
    window.dispatchEvent(new CustomEvent(HELP_OPEN_EVENT, { detail: o }));
  return { open, setOpen };
}

/**
 * Reads the customer referral code that was captured from a `?ref=` on any
 * page load (see useReferralCapture, mounted in the root shell). Returns the
 * live value + a setter that also clears it. The checkout page consumes this
 * on mount, forwards it to createOrder, then calls clear() on success so the
 * code isn't reused on the next order.
 */
export function useReferralCode(): {
  code: string | null;
  clear: () => void;
} {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      setCode(window.localStorage.getItem(REFERRAL_KEY));
    } catch {
      /* SSR / private mode — leave as null */
    }
  }, []);
  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(REFERRAL_KEY);
    } catch {
      /* ignore */
    }
    setCode(null);
  }, []);
  return { code, clear };
}

/**
 * Mount once at the app root: capture ?ref=<code> from the current URL into
 * localStorage so any subsequent page (product, cart, checkout) can pick it
 * up via useReferralCode. Safe to run on every route change; a page with no
 * ?ref= param leaves the stored value alone. The code is echoed to the
 * checkout Zod validator's customer_referral_code, so it's UPPERCASED here
 * and length-capped defensively.
 */
export function useReferralCapture(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("ref");
      if (!raw) return;
      const code = raw.trim().toUpperCase().slice(0, 80);
      if (!code) return;
      window.localStorage.setItem(REFERRAL_KEY, code);
    } catch {
      /* ignore — nothing depends on this succeeding */
    }
  }, []);
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
