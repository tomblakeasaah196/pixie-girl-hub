import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { GripHorizontal, HelpCircle, Moon, Sun, X } from "lucide-react";
import { useToolbar } from "@/lib/site-config";
import { useCurrency } from "@/lib/useStore";
import { useTheme } from "@/lib/theme";

/**
 * Draggable glass toolbar — the sale-landing concept ported to the storefront
 * and restyled with the maison tokens. A vertical stack of circular buttons
 * (currency, theme, WhatsApp, help) pinned to a viewport edge; grab it and drag
 * it anywhere (it snaps within bounds). Config (which buttons, dock side,
 * WhatsApp number/greeting, help steps) comes from Studio via useToolbar().
 */

const EDGE_GAP = 14;
const DRAG_THRESHOLD = 5;
const HINT_KEY = "sf_toolbar_hinted";

function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const CIRCLE =
  "grid h-11 w-11 place-items-center rounded-full bg-ink/50 backdrop-blur-xl border border-taupe/25 text-cream shadow-[0_10px_28px_rgba(0,0,0,0.35)] transition-[transform,border-color,color] duration-150 hover:scale-110 hover:border-taupe active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70";

export function FloatingToolbar() {
  const cfg = useToolbar();
  const reduceMotion = useReducedMotion();

  const [currency, setCurrency] = useCurrency();
  const { toggle: toggleTheme } = useTheme();

  const [helpOpen, setHelpOpen] = useState(false);

  // Drag state
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  // One-time-per-session "you can drag me" nudge.
  const [hint, setHint] = useState(false);

  const buttons = cfg.buttons;
  const showCurrency = buttons.currency;
  const showTheme = buttons.theme;
  const showWhatsApp = buttons.whatsapp && !!cfg.whatsapp.number;
  const showHelp = buttons.help;
  const anyButton = showCurrency || showTheme || showWhatsApp || showHelp;

  // Place at the docked edge, vertically centred; re-clamp on resize.
  useEffect(() => {
    if (!cfg.enabled || !anyButton) return;
    const place = () => {
      const el = ref.current;
      const w = el?.offsetWidth ?? 44;
      const h = el?.offsetHeight ?? 180;
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
  }, [cfg.enabled, anyButton, cfg.dock]);

  useEffect(() => {
    if (!cfg.enabled || !anyButton || reduceMotion) return;
    let hinted = true;
    try { hinted = sessionStorage.getItem(HINT_KEY) === "1"; } catch { /* private mode */ }
    if (hinted) return;
    const start = setTimeout(() => {
      setHint(true);
      try { sessionStorage.setItem(HINT_KEY, "1"); } catch { /* ignore */ }
    }, 900);
    const stop = setTimeout(() => setHint(false), 3100);
    return () => { clearTimeout(start); clearTimeout(stop); };
  }, [cfg.enabled, anyButton, reduceMotion]);

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
      const w = el.offsetWidth || 44;
      const h = el.offsetHeight || 180;
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

  // A click that follows a drag shouldn't also fire the button action.
  const guard = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (moved.current) return;
    fn();
  };

  if (!cfg.enabled || !anyButton) return null;

  const isUsd = currency === "USD";
  const nextGlyph = isUsd ? "₦" : "$";
  const waHref = `https://wa.me/${cfg.whatsapp.number}?text=${encodeURIComponent(cfg.whatsapp.greeting)}`;

  return (
    <>
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
          gap: 8,
          touchAction: "none",
          userSelect: "none",
          cursor: dragging ? "grabbing" : "grab",
          animation: hint ? "sf-toolbar-nudge 620ms ease-in-out 2" : undefined,
          ["--sf-nudge" as string]: cfg.dock === "right" ? "-9px" : "9px",
        }}
        onPointerDown={onPointerDown}
      >
        {/* Grab handle — signals the whole cluster is draggable */}
        <div
          aria-hidden
          className="grid h-5 w-9 place-items-center rounded-full text-taupe/60"
          title="Drag to move"
        >
          <GripHorizontal size={16} strokeWidth={1.75} />
        </div>

        {showCurrency && (
          <button
            type="button"
            onClick={guard(() => setCurrency(isUsd ? "NGN" : "USD"))}
            aria-label={`Switch to ${isUsd ? "Naira" : "US dollars"}`}
            title={`Tap for ${nextGlyph}`}
            className={CIRCLE}
          >
            <span
              key={nextGlyph}
              className="font-couture"
              style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, animation: "sf-currency-pop 320ms ease-out" }}
            >
              {nextGlyph}
            </span>
          </button>
        )}

        {showTheme && (
          <button
            type="button"
            onClick={guard(toggleTheme)}
            aria-label="Toggle colour theme"
            title="Light / dark"
            className={`group ${CIRCLE}`}
            suppressHydrationWarning
          >
            <Sun size={17} strokeWidth={1.6} aria-hidden className="hidden dark:block transition-transform duration-300 group-hover:rotate-12" />
            <Moon size={17} strokeWidth={1.6} aria-hidden className="dark:hidden transition-transform duration-300 group-hover:-rotate-12" />
          </button>
        )}

        {showWhatsApp && (
          <button
            type="button"
            onClick={guard(() => window.open(waHref, "_blank", "noopener,noreferrer"))}
            aria-label="Chat with us on WhatsApp"
            title="Chat on WhatsApp"
            className={CIRCLE}
          >
            <WhatsAppIcon size={18} />
          </button>
        )}

        {showHelp && (
          <button
            type="button"
            onClick={guard(() => setHelpOpen(true))}
            aria-label="How to shop"
            title="How to shop"
            className={CIRCLE}
          >
            <HelpCircle size={18} strokeWidth={1.7} />
          </button>
        )}
      </div>

      <AnimatePresence>
        {helpOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "fixed", inset: 0, zIndex: 80, display: "grid", placeItems: "center", padding: "1rem" }}
          >
            <div
              className="absolute inset-0 bg-ink/70 backdrop-blur-sm"
              onClick={() => setHelpOpen(false)}
            />
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label={cfg.help.title}
              className="relative w-[min(460px,94vw)] rounded-2xl border border-taupe/20 bg-ink/95 backdrop-blur-xl p-6 shadow-2xl"
            >
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full text-taupe hover:bg-cream/10 hover:text-cream transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <h2 className="font-display text-[26px] leading-tight text-cream">{cfg.help.title}</h2>

              <ol className="mt-5 space-y-4">
                {cfg.help.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-8 w-8 flex-shrink-0 place-items-center rounded-full border border-taupe/40 text-[0.72rem] font-semibold text-taupe">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      {s.title ? <div className="text-[14px] font-semibold text-cream">{s.title}</div> : null}
                      {s.body ? <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{s.body}</div> : null}
                    </div>
                  </li>
                ))}
              </ol>

              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="mt-6 h-11 w-full rounded-full bg-taupe text-ink text-[0.7rem] tracking-[0.28em] uppercase font-semibold hover:bg-cream transition-colors"
              >
                Got it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .sf-toolbar, .sf-toolbar * { touch-action: none; -webkit-user-select: none; }
        @keyframes sf-toolbar-nudge {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(var(--sf-nudge, 9px)); }
        }
        @keyframes sf-currency-pop {
          0%   { transform: scale(0.55) rotate(-16deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg);   opacity: 1; }
          100% { transform: scale(1)    rotate(0deg);   opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sf-toolbar { animation: none !important; }
        }
      `}</style>
    </>
  );
}
