"use client";

/**
 * CurrencyFloater — a floating NGN⇄USD toggle for the live sale page.
 *
 * All prices on the page are rendered in NGN (via lib/format.money). Rather
 * than thread a currency context through ~29 call sites, this widget converts
 * the *rendered* prices in place:
 *
 *   • fetches the live USD→NGN rate from /api/public/storefront/currency
 *     (which also tells us the visitor's country, so we can default to USD for
 *     international shoppers);
 *   • when USD is on, it walks the DOM, finds "₦…" amounts and rewrites them to
 *     "$…", remembering the original so it can switch back instantly;
 *   • a MutationObserver keeps prices converted as React re-renders (countdown
 *     ticks, cart updates, products loading in).
 *
 * It only changes what's shown. Checkout still charges the real amount the Hub
 * backend computes. The widget marks itself data-no-convert so it never
 * rewrites its own rate label.
 */

import { useCallback, useEffect, useRef, useState } from "react";

// Display-only fallback when the Hub has FX disabled (FX_PROVIDER=none → rate
// comes back null). Clearly marked approximate in the UI. Override per deploy.
const FALLBACK_USD_NGN = Number(
  process.env.NEXT_PUBLIC_USD_NGN_FALLBACK || "1600",
);

const AMOUNT_RE = /₦\s?([\d.,]+\s?[kKmM]?)/g;

function ngnToNumber(raw: string): number | null {
  let s = raw.trim();
  let mult = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (suffix === "k") {
    mult = 1_000;
    s = s.slice(0, -1);
  } else if (suffix === "m") {
    mult = 1_000_000;
    s = s.slice(0, -1);
  }
  s = s.replace(/,/g, "").trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

function formatUsd(n: number): string {
  if (n >= 100) return "$" + Math.round(n).toLocaleString("en-US");
  return (
    "$" +
    n.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function convertString(value: string, rate: number): string | null {
  let changed = false;
  const out = value.replace(AMOUNT_RE, (match, amount: string) => {
    const ngn = ngnToNumber(amount);
    if (ngn == null) return match;
    changed = true;
    return formatUsd(ngn / rate);
  });
  return changed ? out : null;
}

/** Collect price-bearing text nodes under `root`, skipping our own UI. */
function priceTextNodes(root: Node): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const v = node.nodeValue;
      if (!v || v.indexOf("₦") === -1) return NodeFilter.FILTER_REJECT;
      let el = node.parentElement;
      while (el) {
        if (el.hasAttribute("data-no-convert")) return NodeFilter.FILTER_REJECT;
        if (el.tagName === "SCRIPT" || el.tagName === "STYLE")
          return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes: Text[] = [];
  let cur: Node | null;
  while ((cur = walker.nextNode())) nodes.push(cur as Text);
  return nodes;
}

export function CurrencyFloater() {
  const [rate, setRate] = useState<number | null>(null);
  const [approx, setApprox] = useState(false);
  const [usd, setUsd] = useState(false);
  const [ready, setReady] = useState(false);

  // Original NGN text per node, so we can switch back to NGN instantly.
  const originals = useRef<Map<Text, string>>(new Map());
  const observer = useRef<MutationObserver | null>(null);
  const rateRef = useRef<number>(FALLBACK_USD_NGN);

  // Resolve the rate (and the visitor's country) once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/storefront/currency", {
          headers: { Accept: "application/json" },
        });
        const json = res.ok ? await res.json() : null;
        const d = json?.data ?? null;
        if (cancelled) return;
        const live = Number(d?.usd_to_ngn);
        if (Number.isFinite(live) && live > 0) {
          rateRef.current = live;
          setRate(live);
          setApprox(false);
        } else {
          rateRef.current = FALLBACK_USD_NGN;
          setRate(FALLBACK_USD_NGN);
          setApprox(true);
        }
        // Default international visitors to USD; Nigeria (and unknown) stays NGN.
        const cc = String(d?.country || "").toUpperCase();
        if (cc && cc !== "NG" && cc !== "XX") setUsd(true);
      } catch {
        if (cancelled) return;
        rateRef.current = FALLBACK_USD_NGN;
        setRate(FALLBACK_USD_NGN);
        setApprox(true);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const convertAll = useCallback(() => {
    const rate = rateRef.current;
    for (const node of priceTextNodes(document.body)) {
      const conv = convertString(node.nodeValue || "", rate);
      if (conv != null) {
        if (!originals.current.has(node))
          originals.current.set(node, node.nodeValue || "");
        node.nodeValue = conv;
      }
    }
  }, []);

  const restoreAll = useCallback(() => {
    for (const [node, ngn] of originals.current) {
      try {
        node.nodeValue = ngn;
      } catch {
        // node detached by React — nothing to restore
      }
    }
    originals.current.clear();
  }, []);

  // Engage / disengage USD mode.
  useEffect(() => {
    if (!ready) return;
    if (!usd) {
      observer.current?.disconnect();
      observer.current = null;
      restoreAll();
      return;
    }
    convertAll();
    // Keep prices converted as the page re-renders (debounced to one pass
    // per frame; we disconnect while mutating so our own writes don't loop).
    let scheduled = false;
    const obs = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        obs.disconnect();
        convertAll();
        obs.observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      });
    });
    obs.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    observer.current = obs;
    return () => {
      obs.disconnect();
      observer.current = null;
    };
  }, [usd, ready, convertAll, restoreAll]);

  if (!ready || rate == null) return null;

  return (
    <div
      data-no-convert
      className="fixed bottom-24 right-4 z-50 select-none"
      style={{ pointerEvents: "auto" }}
    >
      <button
        type="button"
        onClick={() => setUsd((v) => !v)}
        aria-pressed={usd}
        title={
          usd
            ? "Showing approximate USD prices — tap to switch back to Naira"
            : "Show prices in USD"
        }
        className="group flex items-center gap-2 rounded-full border border-white/15 bg-black/70 px-3.5 py-2 text-[12px] font-medium text-white shadow-lg backdrop-blur-md transition hover:border-white/30 hover:bg-black/80"
      >
        <span className="grid grid-cols-2 overflow-hidden rounded-full border border-white/20 text-[11px] leading-none">
          <span
            className={
              "px-2 py-1 transition " +
              (!usd ? "bg-white text-black" : "text-white/60")
            }
          >
            ₦
          </span>
          <span
            className={
              "px-2 py-1 transition " +
              (usd ? "bg-white text-black" : "text-white/60")
            }
          >
            $
          </span>
        </span>
        <span className="whitespace-nowrap">
          {usd ? "USD prices" : "Show USD"}
        </span>
      </button>
      {usd && (
        <div className="mt-1 text-right text-[10px] text-white/55">
          {approx ? "≈ " : ""}$1 = ₦{Math.round(rate).toLocaleString("en-NG")}
        </div>
      )}
    </div>
  );
}
