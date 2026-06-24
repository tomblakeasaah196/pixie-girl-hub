"use client";

/**
 * Shared per-session display-currency choice (₦ / $).
 *
 * Why this exists: the live sale page converts prices with a DOM
 * MutationObserver (CurrencyFloater). That observer only runs on the live page
 * and races with React's async re-renders, so figures that arrive after first
 * paint (the server quote's discounts, the delivery fee, the total) were left
 * in ₦ while the line items showed $ — the "mixed currency" bug at checkout.
 *
 * The money-critical surfaces (cart drawer + checkout) instead read the choice
 * from here and convert in React, so every figure on those screens always
 * agrees. The choice is cached PER SESSION (owner directive) so a refresh keeps
 * it — e.g. a Nigerian whom GeoIP defaulted to ₦ but who switched to $ keeps $
 * after reloading, and the choice carries from the live page into checkout.
 */

import { useEffect, useState } from "react";

export type DisplayCurrency = "NGN" | "USD";

const STORAGE_KEY = "pgh.salesCurrency";
const SYNC_EVENT = "pgh:currency";

/** Read the cached choice for this session. Falls back ONCE to a legacy
 *  localStorage value (a visitor who toggled before this change) and mirrors it
 *  into the session so they aren't bounced back to ₦. */
export function readStoredCurrency(): DisplayCurrency | null {
  if (typeof window === "undefined") return null;
  try {
    const s = window.sessionStorage.getItem(STORAGE_KEY);
    if (s === "USD" || s === "NGN") return s;
    const legacy = window.localStorage.getItem(STORAGE_KEY);
    if (legacy === "USD" || legacy === "NGN") {
      window.sessionStorage.setItem(STORAGE_KEY, legacy);
      return legacy;
    }
  } catch {
    /* private mode — ignore */
  }
  return null;
}

/** Persist the choice for THIS SESSION (owner directive: per-session only, so a
 *  new tab/visit re-resolves via GeoIP) and notify every component on the page
 *  (cart drawer, checkout, floater) so they re-render together. */
export function writeStoredCurrency(c: DisplayCurrency): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, c);
  } catch {
    /* private mode — ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: c }));
  } catch {
    /* ignore */
  }
}

/**
 * Per-session currency choice hook. Initialises from the session cache,
 * stays in sync via the window event + cross-tab `storage` event, and persists
 * every change. Defaults to NGN until a real choice is known.
 */
export function useDisplayCurrency(): [
  DisplayCurrency,
  (c: DisplayCurrency) => void,
] {
  const [currency, setCurrencyState] = useState<DisplayCurrency>("NGN");

  useEffect(() => {
    const stored = readStoredCurrency();
    if (stored) setCurrencyState(stored);

    const onSync = (e: Event) => {
      const c = (e as CustomEvent).detail;
      if (c === "USD" || c === "NGN") setCurrencyState(c);
    };
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === STORAGE_KEY &&
        (e.newValue === "USD" || e.newValue === "NGN")
      ) {
        setCurrencyState(e.newValue);
      }
    };
    window.addEventListener(SYNC_EVENT, onSync);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const setCurrency = (c: DisplayCurrency) => {
    setCurrencyState(c);
    writeStoredCurrency(c);
  };

  return [currency, setCurrency];
}
