"use client";

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

// ── Glass circle styling ────────────────────────────────────────────────────

const CIRCLE_STYLE: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  background: "rgba(var(--panel), var(--panel-alpha))",
  border: "1px solid rgba(var(--border-c), 0.10)",
  backdropFilter: "blur(22px) saturate(150%)",
  WebkitBackdropFilter: "blur(22px) saturate(150%)",
  boxShadow:
    "inset 0 1px 0 rgba(255,255,255,0.06), 0 10px 28px rgba(0,0,0,0.45)",
  cursor: "pointer",
  color: "#fff",
  transition: "transform 0.15s ease, box-shadow 0.15s ease",
};

const DRAG_THRESHOLD = 5;
const EDGE_GAP = 12;

// ── WhatsApp SVG icon ───────────────────────────────────────────────────────

function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function FloatingToolbar({ payload }: { payload: LandingPayload }) {
  const fxRate  = payload.ngn_per_usd_rate ?? null;
  const hasRate = typeof fxRate === "number" && fxRate > 0;
  const waNumber = payload.brand?.support_whatsapp ?? null;

  // Currency
  const [usd, setUsd]           = useState(false);
  const [resolved, setResolved] = useState(false);
  const originals = useRef<Map<Text, string>>(new Map());
  const observer  = useRef<MutationObserver | null>(null);
  const rateRef   = useRef<number>(fxRate || 1);

  // Help modal
  const [helpOpen, setHelpOpen] = useState(false);

  // Drag
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [dragPos, setDragPos]   = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  useEffect(() => {
    const place = () => {
      const h = toolbarRef.current?.offsetHeight ?? 130;
      setDragPos((prev) => {
        if (prev) {
          const w = toolbarRef.current?.offsetWidth ?? 38;
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

  useEffect(() => {
    let seen = true;
    try { seen = Boolean(localStorage.getItem(STORAGE_KEY)); } catch { /* private mode */ }
    if (seen) return;
    const t = setTimeout(() => setHelpOpen(true), 1400);
    return () => clearTimeout(t);
  }, []);

  // ── Drag handlers ──────────────────────────────────────────────────────────

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = toolbarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const origin = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    movedRef.current = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - origin.px;
      const dy = ev.clientY - origin.py;
      if (!movedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      movedRef.current = true;
      setDragging(true);
      if (ev.cancelable) ev.preventDefault();
      const w = el.offsetWidth || 38;
      const h = el.offsetHeight || 130;
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
      window.setTimeout(() => { movedRef.current = false; }, 0);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const flip = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) return;
    const next = usd ? "NGN" : "USD";
    writeStoredCurrency(next);
    setUsd(!usd);
  };

  const openHelp = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (movedRef.current) return;
    setHelpOpen(true);
  };

  function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
  }
  function closeHelp() { setHelpOpen(false); markSeen(); }

  // Show the ALTERNATIVE currency so visitors know they can switch.
  const switchGlyph = usd ? "₦" : "$";
  const showCurrency = hasRate && resolved;
  const waHref = waNumber
    ? `https://wa.me/${waNumber.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <>
      {/* ── Glass circles toolbar ── */}
      <div
        ref={toolbarRef}
        data-no-convert
        className="pgh-toolbar"
        style={{
          position: "fixed",
          top: dragPos ? dragPos.y : "50%",
          left: dragPos ? dragPos.x : EDGE_GAP,
          zIndex: 55,
          visibility: dragPos ? "visible" : "hidden",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
          touchAction: "none",
          userSelect: "none",
          cursor: dragging ? "grabbing" : "grab",
          willChange: dragging ? "top, left" : "auto",
        }}
        onPointerDown={onPointerDown}
      >
        {/* Currency toggle */}
        {showCurrency && (
          <button
            type="button"
            onClick={flip}
            aria-label={`Switch to ${usd ? "Naira" : "US dollars"}`}
            title={`Tap for ${usd ? "₦" : "$"}`}
            className="pgh-glass-circle"
            style={CIRCLE_STYLE}
          >
            <span
              key={switchGlyph}
              style={{
                display: "block",
                fontFamily: "var(--font-display, Georgia, serif)",
                fontSize: 17,
                fontWeight: 700,
                lineHeight: 1,
                animation: "pgh-currency-pop 320ms ease-out",
              }}
            >
              {switchGlyph}
            </span>
          </button>
        )}

        {/* Help */}
        <button
          type="button"
          onClick={openHelp}
          aria-label="How to shop"
          title="How to shop"
          className="pgh-glass-circle"
          style={{ ...CIRCLE_STYLE, border: "none" } as React.CSSProperties}
        >
          <HelpCircle style={{ width: 18, height: 18 }} />
        </button>

        {/* WhatsApp */}
        {waHref && (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Chat on WhatsApp"
            title="Chat on WhatsApp"
            onClick={(e) => { if (movedRef.current) e.preventDefault(); }}
            className="pgh-glass-circle"
            style={{ ...CIRCLE_STYLE, textDecoration: "none" } as React.CSSProperties}
          >
            <WhatsAppIcon size={18} />
          </a>
        )}
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
        .pgh-toolbar, .pgh-toolbar * { touch-action: none; -webkit-user-select: none; }
        .pgh-glass-circle:hover { transform: scale(1.1); }
        .pgh-glass-circle:active { transform: scale(0.95); }
        @keyframes pgh-currency-pop {
          0%   { transform: scale(0.55) rotate(-18deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg);   opacity: 1; }
          100% { transform: scale(1)    rotate(0deg);   opacity: 1; }
        }
      `}</style>
    </>
  );
}
