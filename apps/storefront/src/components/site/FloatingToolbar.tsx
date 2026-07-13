import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { ChevronDown, GripHorizontal } from "lucide-react";
import { useToolbar } from "@/lib/site-config";
import { useCurrency } from "@/lib/useStore";
import { useCurrencyFeed } from "@/lib/useCurrencyFeed";
import { clientBrand } from "@/lib/brand";

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

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);
  const [hint, setHint] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);

  const show = cfg.enabled && cfg.buttons.currency;

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

  useEffect(() => {
    if (!dropOpen) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setDropOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setDropOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [dropOpen]);

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

  const guard = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) return;
    fn();
  };

  if (!show) return null;

  const list = currencies.length
    ? currencies.map((c) => ({ code: c.code, symbol: c.symbol }))
    : FALLBACK_CURRENCIES;

  const brand = typeof document !== "undefined" ? clientBrand() : "faitlynhair";
  const isFaitlyn = brand === "faitlynhair";

  const activeItem = list.find((c) => c.code === currency) || list[0];
  const secondItem = list.find((c) => c.code !== activeItem.code);
  const rest = list.filter((c) => c.code !== activeItem.code && c.code !== secondItem?.code);

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
      <div
        aria-hidden
        className="grid h-4 w-8 place-items-center rounded-full text-taupe/60"
        title="Drag to move"
      >
        <GripHorizontal size={15} strokeWidth={1.75} />
      </div>

      <div
        className="sf-currency-pill"
        style={{
          ["--glow" as string]: isFaitlyn
            ? "oklch(0.78 0.11 75 / 0.25)"
            : "oklch(0.45 0.18 25 / 0.25)",
          ["--glow-active" as string]: isFaitlyn
            ? "oklch(0.78 0.11 75 / 0.5)"
            : "oklch(0.45 0.18 25 / 0.5)",
          ["--accent" as string]: isFaitlyn
            ? "oklch(0.78 0.11 75 / 0.7)"
            : "oklch(0.45 0.18 25 / 0.7)",
        }}
      >
        {/* Active currency — always visible, prominent */}
        <button
          type="button"
          onClick={guard(() => {})}
          aria-pressed
          aria-label={`Showing prices in ${activeItem.code}`}
          title={activeItem.code}
          className="sf-currency-btn sf-currency-active"
        >
          <span className="font-couture text-[1.15rem] leading-none">{activeItem.symbol}</span>
        </button>

        {/* Divider */}
        {secondItem ? <div className="sf-currency-divider" /> : null}

        {/* Second currency — visible, muted, tap to switch */}
        {secondItem ? (
          <button
            type="button"
            onClick={guard(() => setCurrency(secondItem.code))}
            aria-pressed={false}
            aria-label={`Switch to ${secondItem.code}`}
            title={secondItem.code}
            className="sf-currency-btn sf-currency-dim"
          >
            <span className="font-couture text-[1.05rem] leading-none">{secondItem.symbol}</span>
          </button>
        ) : null}

        {/* Overflow indicator for 3+ currencies */}
        {rest.length > 0 ? (
          <div className="relative">
            <div className="sf-currency-divider" />
            <button
              type="button"
              onClick={guard(() => setDropOpen((o) => !o))}
              aria-expanded={dropOpen}
              aria-label={`${rest.length} more currencies`}
              className="sf-currency-btn sf-currency-more"
            >
              <ChevronDown
                size={13}
                strokeWidth={2}
                className={`transition-transform duration-200 ${dropOpen ? "rotate-180" : ""}`}
              />
            </button>

            {dropOpen ? (
              <div className="sf-currency-dropdown">
                {rest.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={guard(() => {
                      setCurrency(c.code);
                      setDropOpen(false);
                    })}
                    aria-label={`Switch to ${c.code}`}
                    title={c.code}
                    className="sf-currency-btn sf-currency-drop-item"
                  >
                    <span className="font-couture text-[1rem] leading-none">{c.symbol}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
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

        .sf-currency-pill {
          display: flex;
          flex-direction: column;
          align-items: center;
          overflow: visible;
          border-radius: 26px;
          border: 1px solid oklch(0.82 0.045 60 / 0.2);
          background: oklch(0.14 0.012 60 / 0.55);
          backdrop-filter: blur(24px) saturate(1.4);
          -webkit-backdrop-filter: blur(24px) saturate(1.4);
          box-shadow:
            0 10px 28px rgba(0, 0, 0, 0.35),
            0 0 12px var(--glow),
            inset 0 1px 0 oklch(1 0 0 / 0.04);
          transition: box-shadow 0.4s ease;
        }
        .sf-currency-pill:hover {
          box-shadow:
            0 10px 28px rgba(0, 0, 0, 0.35),
            0 0 20px var(--glow-active),
            inset 0 1px 0 oklch(1 0 0 / 0.04);
        }

        .sf-currency-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          transition: all 0.3s ease;
          outline: none;
        }
        .sf-currency-btn:focus-visible {
          box-shadow: 0 0 0 2px oklch(0.96 0.018 80 / 0.5);
          border-radius: 50%;
        }

        .sf-currency-active {
          color: var(--cream);
          position: relative;
        }
        .sf-currency-active::after {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 6px var(--glow-active);
        }

        .sf-currency-dim {
          color: oklch(0.96 0.018 80 / 0.4);
        }
        .sf-currency-dim:hover {
          color: oklch(0.96 0.018 80 / 0.8);
        }

        .sf-currency-more {
          color: oklch(0.96 0.018 80 / 0.35);
          height: 32px;
        }
        .sf-currency-more:hover {
          color: oklch(0.96 0.018 80 / 0.7);
        }

        .sf-currency-divider {
          width: 18px;
          height: 1px;
          margin: 0 auto;
          background: oklch(0.82 0.045 60 / 0.15);
        }

        .sf-currency-dropdown {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          border-radius: 20px;
          border: 1px solid oklch(0.82 0.045 60 / 0.2);
          background: oklch(0.14 0.012 60 / 0.7);
          backdrop-filter: blur(24px) saturate(1.4);
          -webkit-backdrop-filter: blur(24px) saturate(1.4);
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
          padding: 4px 0;
          animation: sf-drop-in 0.2s ease-out;
        }
        .sf-currency-drop-item {
          color: oklch(0.96 0.018 80 / 0.5);
          width: 40px;
          height: 40px;
        }
        .sf-currency-drop-item:hover {
          color: oklch(0.96 0.018 80 / 0.9);
        }

        @keyframes sf-drop-in {
          from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }

        :root .sf-currency-pill {
          background: oklch(0.97 0.014 80 / 0.55);
          border-color: oklch(0.42 0.04 55 / 0.2);
        }
        :root .sf-currency-active {
          color: var(--cream);
        }
        :root .sf-currency-dim {
          color: oklch(0.16 0.012 60 / 0.4);
        }
        :root .sf-currency-dim:hover {
          color: oklch(0.16 0.012 60 / 0.7);
        }
        :root .sf-currency-more {
          color: oklch(0.16 0.012 60 / 0.3);
        }
        :root .sf-currency-more:hover {
          color: oklch(0.16 0.012 60 / 0.6);
        }
        :root .sf-currency-divider {
          background: oklch(0.42 0.04 55 / 0.15);
        }
        :root .sf-currency-dropdown {
          background: oklch(0.97 0.014 80 / 0.75);
          border-color: oklch(0.42 0.04 55 / 0.2);
        }
        :root .sf-currency-drop-item {
          color: oklch(0.16 0.012 60 / 0.45);
        }
        :root .sf-currency-drop-item:hover {
          color: oklch(0.16 0.012 60 / 0.85);
        }

        .dark .sf-currency-pill {
          background: oklch(0.14 0.012 60 / 0.55);
          border-color: oklch(0.82 0.045 60 / 0.2);
        }
        .dark .sf-currency-active {
          color: oklch(0.96 0.018 80);
        }
        .dark .sf-currency-dim {
          color: oklch(0.96 0.018 80 / 0.4);
        }
        .dark .sf-currency-dim:hover {
          color: oklch(0.96 0.018 80 / 0.8);
        }
        .dark .sf-currency-dropdown {
          background: oklch(0.14 0.012 60 / 0.7);
          border-color: oklch(0.82 0.045 60 / 0.2);
        }
      `}</style>
    </div>
  );
}
