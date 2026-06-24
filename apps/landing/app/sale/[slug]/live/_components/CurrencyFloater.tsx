"use client";

/**
 * CurrencyFloater — brand-tinted floating ₦⇄$ toggle for the live sale page.
 *
 * Rewritten June 2026 (owner directive):
 *  • Picks up the campaign's STATIC `ngn_per_usd_rate` from the landing
 *    payload, not a live FX feed. This matches the SSOT we agreed on:
 *    landing display uses the static rate; order settlement still uses the
 *    LIVE rate stamped into sales_orders.fx_rate_used at payment.
 *  • Themed via the brand's CSS variables (Pixie Girl oxblood, Faitlyn
 *    brown) the way the BrandThemeProvider sets them — no more black pill.
 *  • Desktop hover expands the pill to reveal both glyphs as a swap
 *    affordance; mobile single-taps. Hidden when the campaign has no
 *    rate set.
 *  • Initial currency: GeoIP via `/api/public/geo/currency` (NG → ₦,
 *    everything else → $). The visitor's choice is then persisted in
 *    localStorage and wins thereafter.
 *  • USD prices are ceil-rounded to whole dollars (10.29 → $11) per
 *    owner directive. NGN keeps its existing rendering.
 *
 * Conversion approach (kept from the previous floater for compatibility
 * with the existing block library): a MutationObserver rewrites "₦…"
 * text nodes to "$…" in place. Anything that should not be rewritten
 * (the floater itself, the FX rate label) carries `data-no-convert`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { LandingPayload } from "@/lib/types";
import { readStoredCurrency, writeStoredCurrency } from "@/lib/currency";

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
  // Ceil to a whole dollar per owner directive: 10.29 USD → $11.
  const whole = Math.ceil(n);
  return "$" + whole.toLocaleString("en-US");
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

export function CurrencyFloater({ payload }: { payload: LandingPayload }) {
  const fxRate = payload.ngn_per_usd_rate ?? null;
  const hasRate = typeof fxRate === "number" && fxRate > 0;

  const [usd, setUsd] = useState(false);
  // Resolved means: a real default has been applied (either a persisted
  // choice or the geo lookup completed). Until then we don't render to
  // avoid a flash of the wrong currency.
  const [resolved, setResolved] = useState(false);

  const originals = useRef<Map<Text, string>>(new Map());
  const observer = useRef<MutationObserver | null>(null);
  const rateRef = useRef<number>(fxRate || 1);

  useEffect(() => {
    rateRef.current = fxRate || 1;
  }, [fxRate]);

  // Initial pick: persisted user choice wins, else GeoIP (NG → ₦, else → $).
  useEffect(() => {
    if (!hasRate) {
      setResolved(true);
      return;
    }
    const stored = readStoredCurrency();
    if (stored) {
      setUsd(stored === "USD");
      setResolved(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/geo/currency", {
          headers: { Accept: "application/json" },
          credentials: "omit",
        });
        if (!res.ok) throw new Error(`geo ${res.status}`);
        const json = (await res.json()) as {
          data?: { country: string | null; currency: string | null };
        };
        if (cancelled) return;
        const cc = String(json?.data?.country || "").toUpperCase();
        const resolvedCurrency = cc && cc !== "NG" ? "USD" : "NGN";
        if (resolvedCurrency === "USD") setUsd(true);
        // Persist + broadcast the GeoIP default so the React-driven surfaces
        // (cart drawer, checkout) start in the SAME currency as the observer-
        // converted live-page blocks. Without this, a foreign visitor saw $
        // prices on the page but ₦ in the cart drawer.
        writeStoredCurrency(resolvedCurrency);
      } catch {
        // Stay on NGN if the lookup fails.
      } finally {
        if (!cancelled) setResolved(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hasRate]);

  const convertAll = useCallback(() => {
    const rate = rateRef.current;
    if (!rate || rate <= 0) return;
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
        // node detached — nothing to restore
      }
    }
    originals.current.clear();
  }, []);

  useEffect(() => {
    if (!resolved || !hasRate) return;
    if (!usd) {
      observer.current?.disconnect();
      observer.current = null;
      restoreAll();
      return;
    }
    convertAll();
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
  }, [usd, resolved, hasRate, convertAll, restoreAll]);

  if (!resolved || !hasRate) return null;

  const flip = () => {
    const next = usd ? "NGN" : "USD";
    // Persist per session + broadcast so the cart drawer and checkout (which
    // convert in React, not via this observer) switch in lockstep.
    writeStoredCurrency(next);
    setUsd(!usd);
  };

  const activeGlyph = usd ? "$" : "₦";
  const otherGlyph = usd ? "₦" : "$";

  return (
    <button
      type="button"
      data-no-convert
      onClick={flip}
      aria-label={`Switch to ${usd ? "Naira" : "US dollars"}`}
      title={`${activeGlyph} → ${otherGlyph}`}
      className="group fixed bottom-24 right-4 z-50 select-none
                 h-12 min-w-12 px-3 inline-flex items-center justify-center gap-1
                 rounded-full overflow-hidden font-display text-[17px] font-semibold
                 tabular-nums tracking-tight text-white
                 transition-[width,transform,background-color,box-shadow]
                 duration-300 ease-out
                 hover:scale-[1.04] active:scale-95
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
      style={{
        backgroundImage:
          "linear-gradient(135deg, rgb(var(--accent)) 0%, rgb(var(--accent-deep)) 100%)",
        boxShadow:
          "0 10px 30px rgb(var(--accent-deep) / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.18)",
      }}
    >
      <span
        key={activeGlyph}
        className="inline-block leading-none"
        style={{ animation: "pgh-currency-pop 320ms ease-out" }}
      >
        {activeGlyph}
      </span>
      <span
        aria-hidden
        className="hidden md:inline-block leading-none opacity-0 max-w-0 -ml-1 text-white/70
                   transition-[opacity,max-width,margin] duration-300 ease-out
                   group-hover:opacity-100 group-hover:max-w-[1.5em] group-hover:ml-0
                   group-focus-visible:opacity-100 group-focus-visible:max-w-[1.5em] group-focus-visible:ml-0"
      >
        <span className="px-1 text-white/50">/</span>
        {otherGlyph}
      </span>
      <style>{`
        @keyframes pgh-currency-pop {
          0%   { transform: scale(0.55) rotate(-18deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg);   opacity: 1; }
          100% { transform: scale(1)    rotate(0);      opacity: 1; }
        }
      `}</style>
    </button>
  );
}
