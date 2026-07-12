import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { GripHorizontal } from "lucide-react";
import { useToolbar } from "@/lib/site-config";
import { useCurrency } from "@/lib/useStore";
import { useCurrencyFeed } from "@/lib/useCurrencyFeed";

/**
 * Draggable glass currency switcher — the sole occupant of the "displaceable"
 * toolbar now that theme moved to the header, help to the header/footer, and the
 * AI stylist + WhatsApp to the bottom-right ConciergeDock. Grab the handle and
 * drag it anywhere (it snaps within bounds). Both active display currencies are
 * shown side by side; the SELECTED one is bright/filled and the other is dim —
 * tap the dim one to switch. Config (dock side, whether the currency shows)
 * comes from Studio via useToolbar().
 */

const EDGE_GAP = 14;
const DRAG_THRESHOLD = 5;
const HINT_KEY = "sf_toolbar_hinted";

const FALLBACK_CURRENCIES: { code: string; symbol: string }[] = [
  { code: "NGN", symbol: "₦" },
  { code: "USD", symbol: "$" },
];

export function FloatingToolbar() {
  const cfg = useToolbar();
  const reduceMotion = useReducedMotion();

  const [currency, setCurrency] = useCurrency();
  const { currencies } = useCurrencyFeed();

  // Drag state
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  // One-time-per-session "you can drag me" nudge.
  const [hint, setHint] = useState(false);

  const show = cfg.enabled && cfg.buttons.currency;

  // Place at the docked edge, vertically centred; re-clamp on resize.
  useEffect(() => {
    if (!show) return;
    const place = () => {
      const el = ref.current;
      const w = el?.offsetWidth ?? 120;
      const h = el?.offsetHeight ?? 64;
      setPos((prev) => {
        if (prev) {
          return {
            x: Math.max(EDGE_GAP, Math.min(window.innerWidth - w - EDGE_GAP, prev.x)),
            y: Math.max(EDGE_GAP, Math.min(window.innerHeight - h - EDGE_GAP, prev.y)),
          };
        }
        const x = cfg.dock === "right" ? window.innerWidth - w - EDGE_GAP : EDGE_GAP;
        return { x, y: Math.round(window.innerHeight / 2 - h / 2) };
      });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [show, cfg.dock]);

  useEffect(() => {
    if (!show || reduceMotion) return;
    let hinted = true;
    try { hinted = sessionStorage.getItem(HINT_KEY) === "1"; } catch { /* private mode */ }
    if (hinted) return;
    const start = setTimeout(() => {
      setHint(true);
      try { sessionStorage.setItem(HINT_KEY, "1"); } catch { /* ignore */ }
    }, 900);
    const stop = setTimeout(() => setHint(false), 3100);
    return () => { clearTimeout(start); clearTimeout(stop); };
  }, [show, reduceMotion]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    setHint(false);
    const rect = el.getBoundingClientRect();
    const origin = { px: e.clientX, py: e.clientY, ex: rect.left, ey: rect.top };
    moved.current = false;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - origin.px;
      const dy = ev.clientY - origin.py;
      if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved.current = true;
      setDragging(true);
      if (ev.cancelable) ev.preventDefault();
      const w = el.offsetWidth || 120;
      const h = el.offsetHeight || 64;
      setPos({
        x: Math.max(EDGE_GAP, Math.min(window.innerWidth - w - EDGE_GAP, origin.ex + dx)),
        y: Math.max(EDGE_GAP, Math.min(window.innerHeight - h - EDGE_GAP, origin.ey + dy)),
      });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(false);
      window.setTimeout(() => { moved.current = false; }, 0);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  // A tap that follows a drag shouldn't also switch the currency.
  const guard = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) return;
    fn();
  };

  if (!show) return null;

  const list = currencies.length
    ? currencies.map((c) => ({ code: c.code, symbol: c.symbol }))
    : FALLBACK_CURRENCIES;

  return (
    <div
      ref={ref}
      data-no-convert
      className="sf-toolbar"
      style={{
        position: "fixed",
        top: pos ? pos.y : "50%",
        left: pos ? pos.x : EDGE_GAP,
        zIndex: 40,
        visibility: pos ? "visible" : "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        touchAction: "none",
        userSelect: "none",
        cursor: dragging ? "grabbing" : "grab",
        animation: hint ? "sf-toolbar-nudge 620ms ease-in-out 2" : undefined,
        ["--sf-nudge" as string]: cfg.dock === "right" ? "-9px" : "9px",
      }}
      onPointerDown={onPointerDown}
    >
      {/* Grab handle — signals the control is draggable */}
      <div
        aria-hidden
        className="grid h-4 w-8 place-items-center rounded-full text-taupe/60"
        title="Drag to move"
      >
        <GripHorizontal size={15} strokeWidth={1.75} />
      </div>

      {/* Currency segments — selected is bright/filled, the other dim */}
      <div className="flex overflow-hidden rounded-full border border-taupe/25 bg-ink/50 backdrop-blur-xl shadow-[0_10px_28px_rgba(0,0,0,0.35)]">
        {list.map((c) => {
          const active = c.code === currency;
          return (
            <button
              key={c.code}
              type="button"
              onClick={guard(() => setCurrency(c.code))}
              aria-pressed={active}
              aria-label={`Show prices in ${c.code}`}
              title={c.code}
              className={`flex items-center gap-1.5 px-3 py-2 text-[0.6rem] tracking-[0.18em] uppercase transition-colors focus-visible:outline-none ${
                active
                  ? "bg-taupe text-ink font-semibold"
                  : "text-cream/55 hover:text-cream"
              }`}
            >
              <span className="font-couture text-[0.95rem] leading-none">{c.symbol}</span>
              <span>{c.code}</span>
            </button>
          );
        })}
      </div>

      <style>{`
        .sf-toolbar, .sf-toolbar * { touch-action: none; -webkit-user-select: none; }
        @keyframes sf-toolbar-nudge {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(var(--sf-nudge, 9px)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .sf-toolbar { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
