"use client";

/**
 * FloatingToolbar — unified draggable currency + help toolbar.
 *
 * Replaces the separate CurrencyFloater and HowToShop, which overlapped at the
 * bottom-right (the help button hid behind the currency pill). This merges them
 * into ONE pill the visitor can drag anywhere on the viewport so it never hides
 * content (price, CTA, etc.).
 *
 * Position: defaults to LEFT-MIDDLE (clear of the bottom cart bar and the
 * right-side price / checkout). Fully draggable — the whole pill is the drag
 * handle, with a small movement threshold so a tap still toggles currency /
 * opens help but a drag relocates it.
 *
 * Colour: the BRAND palette. The component renders inside <BrandThemeProvider>,
 * so `--accent` / `--accent-deep` resolve to the brand's published Atelier
 * colours — Faitlyn dark brown (#3A2418 → #281D15), Pixie oxblood
 * (#5C0A14 → #36060D). No hard-coded hexes.
 *
 * Currency logic is unchanged from the original CurrencyFloater (static
 * ngn_per_usd_rate from the payload, MutationObserver rewrite, GeoIP default,
 * ceil-rounded USD).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CreditCard,
  HelpCircle,
  Package,
  Ruler,
  Search,
  ShoppingBag,
  X,
} from "lucide-react";
import type { LandingPayload } from "@/lib/types";
import { readStoredCurrency, writeStoredCurrency } from "@/lib/currency";

// ── Currency helpers ─────────────────────────────────────────────────────────

const AMOUNT_RE = /₦\s?([\d.,]+\s?[kKmM]?)/g;

function ngnToNumber(raw: string): number | null {
  let s = raw.trim();
  let mult = 1;
  const suffix = s.slice(-1).toLowerCase();
  if (suffix === "k") { mult = 1_000; s = s.slice(0, -1); }
  else if (suffix === "m") { mult = 1_000_000; s = s.slice(0, -1); }
  s = s.replace(/,/g, "").trim();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

function formatUsd(n: number): string {
  return "$" + Math.ceil(n).toLocaleString("en-US");
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
        if (el.tagName === "SCRIPT" || el.tagName === "STYLE") return NodeFilter.FILTER_REJECT;
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

// ── How-to-shop steps ────────────────────────────────────────────────────────

const STORAGE_KEY = "pgh-howto-seen-v1";

const STEPS = [
  { icon: Search,      title: "Find your wig",   body: "Browse styled wigs or a ready-made bundle. Tap any card to see photos, details and the head-size guide." },
  { icon: Ruler,       title: "Pick size & lace", body: "Choose your head size and lace type — the price updates live as you choose." },
  { icon: ShoppingBag, title: "Add to bag",       body: "Tap Add to bag. Discounts stack automatically — the more wigs you add, the more each one saves." },
  { icon: CreditCard,  title: "Checkout & pay",   body: "Open your cart, tap Checkout, fill in delivery, and pay securely with Paystack or Nomba." },
];

// ── Pill styling (brand palette via CSS vars from BrandThemeProvider) ─────────

const PILL_BG =
  "linear-gradient(165deg, rgb(var(--accent)) 0%, rgb(var(--accent-deep)) 100%)";
const PILL_SHADOW =
  "0 10px 34px rgb(var(--accent-deep) / 0.55), 0 2px 8px rgb(0 0 0 / 0.32), inset 0 1px 0 rgb(255 255 255 / 0.16)";
const PILL_BORDER = "1px solid rgb(255 255 255 / 0.12)";

// Movement past this many px (from pointer-down) counts as a drag, not a tap.
const DRAG_THRESHOLD = 5;
const EDGE_GAP = 12; // viewport inset for the default position + clamp

// ── Component ────────────────────────────────────────────────────────────────

export function FloatingToolbar({ payload }: { payload: LandingPayload }) {
  const fxRate  = payload.ngn_per_usd_rate ?? null;
  const hasRate = typeof fxRate === "number" && fxRate > 0;

  // Currency
  const [usd, setUsd]           = useState(false);
  const [resolved, setResolved] = useState(false);
  const originals = useRef<Map<Text, string>>(new Map());
  const observer  = useRef<MutationObserver | null>(null);
  const rateRef   = useRef<number>(fxRate || 1);

  // Help modal
  const [helpOpen, setHelpOpen] = useState(false);

  // Drag — the whole pill is the handle. A pointer-down that moves past
  // DRAG_THRESHOLD relocates the pill; a stationary press is treated as a tap
  // so the buttons still fire. `movedRef` carries the tap/drag verdict into the
  // button onClick (which fires right after pointerup).
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [dragPos, setDragPos]   = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  // Default position: left-middle, once we can measure the viewport + pill.
  // Kept null until mounted to avoid an SSR/hydration mismatch; the pill is
  // hidden for that first frame so it doesn't flash at the wrong spot.
  useEffect(() => {
    const place = () => {
      const h = toolbarRef.current?.offsetHeight ?? 96;
      setDragPos((prev) => {
        if (prev) {
          // Re-clamp an existing position on resize.
          const w = toolbarRef.current?.offsetWidth ?? 52;
          return {
            x: Math.max(EDGE_GAP, Math.min(window.innerWidth - w - EDGE_GAP, prev.x)),
            y: Math.max(EDGE_GAP, Math.min(window.innerHeight - h - EDGE_GAP, prev.y)),
          };
        }
        return { x: EDGE_GAP, y: Math.round(window.innerHeight / 2 - h / 2) };
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => { rateRef.current = fxRate || 1; }, [fxRate]);

  // Initial currency pick: persisted choice > GeoIP
  useEffect(() => {
    if (!hasRate) { setResolved(true); return; }
    const stored = readStoredCurrency();
    if (stored) { setUsd(stored === "USD"); setResolved(true); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/public/geo/currency", {
          headers: { Accept: "application/json" },
          credentials: "omit",
        });
        if (!res.ok) throw new Error(`geo ${res.status}`);
        const json = await res.json() as {
          data?: { country: string | null; currency: string | null };
        };
        if (cancelled) return;
        const cc = String(json?.data?.country || "").toUpperCase();
        const resolvedCurrency = cc && cc !== "NG" ? "USD" : "NGN";
        if (resolvedCurrency === "USD") setUsd(true);
        // Persist so cart/checkout starts in same currency as the page
        writeStoredCurrency(resolvedCurrency);
      } catch { /* stay NGN */ }
      finally { if (!cancelled) setResolved(true); }
    })();
    return () => { cancelled = true; };
  }, [hasRate]);

  const convertAll = useCallback(() => {
    const rate = rateRef.current;
    if (!rate || rate <= 0) return;
    for (const node of priceTextNodes(document.body)) {
      const conv = convertString(node.nodeValue || "", rate);
      if (conv != null) {
        if (!originals.current.has(node)) originals.current.set(node, node.nodeValue || "");
        node.nodeValue = conv;
      }
    }
  }, []);

  const restoreAll = useCallback(() => {
    for (const [node, ngn] of originals.current) {
      try { node.nodeValue = ngn; } catch { /* detached */ }
    }
    originals.current.clear();
  }, []);

  // MutationObserver-driven conversion
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
        obs.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
    });
    obs.observe(document.body, { subtree: true, childList: true, characterData: true });
    observer.current = obs;
    return () => { obs.disconnect(); observer.current = null; };
  }, [usd, resolved, hasRate, convertAll, restoreAll]);

  // Auto-open for first-time visitors
  useEffect(() => {
    let seen = true;
    try { seen = Boolean(localStorage.getItem(STORAGE_KEY)); } catch { /* private mode */ }
    if (seen) return;
    const t = setTimeout(() => setHelpOpen(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────
  //
  // We listen on `window` (not via React handlers + pointer capture) for the
  // duration of a press. This is the most reliable cross-browser pattern on
  // MOBILE: we keep receiving move/up even when the finger outruns the small
  // pill, and we avoid the iOS Safari quirk where setPointerCapture can swallow
  // the follow-up `click`. `touch-action: none` (set in CSS on the pill + its
  // buttons) stops the browser from scrolling instead of dragging.

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = toolbarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const origin = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    movedRef.current = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - origin.px;
      const dy = ev.clientY - origin.py;
      // Only commit to a drag past the threshold — keeps taps tappable.
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      movedRef.current = true;
      setDragging(true);
      if (ev.cancelable) ev.preventDefault();
      const w = el.offsetWidth || 52;
      const h = el.offsetHeight || 96;
      setDragPos({
        x: Math.max(EDGE_GAP, Math.min(window.innerWidth  - w - EDGE_GAP, origin.ex + dx)),
        y: Math.max(EDGE_GAP, Math.min(window.innerHeight - h - EDGE_GAP, origin.ey + dy)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(false);
      // Keep movedRef truthy through the `click` that fires right after a
      // drag-release (so it's suppressed), then clear it on the next tick.
      window.setTimeout(() => { movedRef.current = false; }, 0);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // ── Currency flip ──────────────────────────────────────────────────────────

  const flip = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) return; // was a drag, not a tap
    const next = usd ? "NGN" : "USD";
    writeStoredCurrency(next);
    setUsd(!usd);
  };

  const openHelp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) return; // was a drag, not a tap
    setHelpOpen(true);
  };

  // ── Help modal ─────────────────────────────────────────────────────────────

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
  }
  function closeHelp() { setHelpOpen(false); markSeen(); }

  const activeGlyph = usd ? "$" : "₦";
  const showCurrency = hasRate && resolved;

  return (
    <>
      {/* ── Floating pill ── */}
      <div
        ref={toolbarRef}
        data-no-convert
        className="pgh-toolbar"
        style={{
          position: "fixed",
          top: dragPos ? dragPos.y : "50%",
          left: dragPos ? dragPos.x : EDGE_GAP,
          zIndex: 55,
          // Hidden until the left-middle default is measured, so it never
          // flashes at the wrong spot on first paint.
          visibility: dragPos ? "visible" : "hidden",
          background: PILL_BG,
          boxShadow: PILL_SHADOW,
          border: PILL_BORDER,
          borderRadius: "1.25rem",
          padding: "6px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "2px",
          touchAction: "none",
          userSelect: "none",
          animation: dragging ? "none" : "pgh-heartbeat 3.4s ease-in-out infinite",
          cursor: dragging ? "grabbing" : "grab",
          willChange: dragging ? "top, left" : "auto",
        }}
        onPointerDown={onPointerDown}
      >
        {/* Currency toggle */}
        {showCurrency && (
          <>
            <button
              type="button"
              onClick={flip}
              aria-label={`Switch to ${usd ? "Naira" : "US dollars"}`}
              title={`${activeGlyph} — tap to switch`}
              style={{
                width: 40, height: 40,
                borderRadius: "0.75rem",
                display: "grid", placeItems: "center",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#fff",
                fontFamily: "var(--font-display, Georgia, serif)",
                fontSize: 18,
                fontWeight: 700,
                lineHeight: 1,
                transition: "background 150ms",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <span
                key={activeGlyph}
                style={{ display: "block", animation: "pgh-currency-pop 320ms ease-out" }}
              >
                {activeGlyph}
              </span>
            </button>

            {/* Divider */}
            <div style={{ width: 24, height: 1, background: "rgba(255,255,255,0.20)", margin: "2px 0" }} />
          </>
        )}

        {/* Help button */}
        <button
          type="button"
          onClick={openHelp}
          aria-label="How to shop"
          title="How to shop"
          style={{
            width: 40, height: 40,
            borderRadius: "0.75rem",
            display: "grid", placeItems: "center",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "#fff",
            transition: "background 150ms",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
        >
          <HelpCircle style={{ width: 20, height: 20 }} />
        </button>
      </div>

      {/* ── How-to-shop modal ── */}
      <AnimatePresence>
        {helpOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, zIndex: 90, display: "grid", placeItems: "center", padding: "1rem" }}
          >
            <div
              style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.62)", backdropFilter: "blur(4px)" }}
              onClick={closeHelp}
            />
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="How to shop this sale"
              className="dropglass relative w-[min(460px,94vw)] rounded-2xl p-6"
            >
              <button
                type="button"
                onClick={closeHelp}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl hover:bg-white/10"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <h2 className="font-display text-[24px] leading-tight">
                How to shop the sale
              </h2>
              <p className="mt-1 text-[13px] text-[rgb(var(--text-muted))]">
                Four quick steps — you&apos;ll be done in minutes.
              </p>

              <ol className="mt-5 space-y-3.5">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl bg-[rgb(var(--brand-accent)/0.18)] text-[rgb(var(--brand-accent))]">
                      <s.icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-semibold">
                        <span className="opacity-60">{i + 1}.</span> {s.title}
                      </div>
                      <div className="text-[12.5px] text-[rgb(var(--text-muted))] leading-snug">
                        {s.body}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-4 flex items-start gap-2 rounded-xl border border-[rgb(var(--brand-accent)/0.25)] bg-[rgb(var(--brand-accent)/0.08)] p-3 text-[12px] text-[rgb(var(--text-muted))]">
                <Package className="mt-0.5 h-4 w-4 flex-shrink-0 text-[rgb(var(--brand-accent))]" />
                <span>
                  <span className="font-semibold text-[rgb(var(--text))]">Reseller or buying in bulk?</span>{" "}
                  Open any wig and choose <em>Wholesale — raw wigs</em> to order unstyled at trade
                  prices. The bulk rate unlocks across all styles in your cart.
                </span>
              </div>

              <button
                type="button"
                onClick={closeHelp}
                className="btn-cta cta-sheen mt-5 h-11 w-full rounded-xl font-semibold"
              >
                Got it — let&apos;s shop
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        /* Touch must not pan/scroll the page when it starts on the pill OR any
           of its buttons — otherwise the browser claims the gesture and the
           drag never starts on mobile. Scoped to the pill so the help modal's
           own controls keep normal touch behaviour. */
        .pgh-toolbar, .pgh-toolbar * { touch-action: none; -webkit-user-select: none; }
        @keyframes pgh-heartbeat {
          0%,  56%, 100% { transform: scale(1); }
          14%             { transform: scale(1.07); }
          28%             { transform: scale(1.01); }
          42%             { transform: scale(1.05); }
        }
        @keyframes pgh-currency-pop {
          0%   { transform: scale(0.55) rotate(-18deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg);   opacity: 1; }
          100% { transform: scale(1)    rotate(0deg);   opacity: 1; }
        }
      `}</style>
    </>
  );
}
