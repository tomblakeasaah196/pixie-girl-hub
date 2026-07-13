import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Sparkles, X } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useToolbar } from "@/lib/site-config";
import { waDigits } from "@/lib/toolbar";
import { clientBrand } from "@/lib/brand";

function WhatsAppIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const OPTION_PILL =
  "flex items-center gap-3 rounded-full border py-2.5 pl-4 pr-3 text-[0.66rem] tracking-[0.24em] uppercase shadow-[0_10px_28px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-transform duration-150 hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70";

export function ConciergeDock() {
  const cfg = useToolbar();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);

  const brand = typeof document !== "undefined" ? clientBrand() : "faitlynhair";
  const isFaitlyn = brand === "faitlynhair";

  const showAI = cfg.buttons.shade;
  const waNumber = waDigits(cfg.whatsapp.number);
  const showWhatsApp = cfg.buttons.whatsapp;
  const waHref = waNumber
    ? `https://wa.me/${waNumber}?text=${encodeURIComponent(cfg.whatsapp.greeting)}`
    : null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (!cfg.enabled || (!showAI && !showWhatsApp)) return null;

  const rise = (i: number) => ({
    initial: { opacity: 0, y: 12, scale: 0.9 },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: { delay: reduceMotion ? 0 : i * 0.06, duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
    },
    exit: { opacity: 0, y: 12, scale: 0.9, transition: { duration: 0.12 } },
  });

  const glowColor = isFaitlyn
    ? "oklch(0.78 0.11 75)"
    : "oklch(0.45 0.18 25)";
  const glow20 = isFaitlyn
    ? "oklch(0.78 0.11 75 / 0.2)"
    : "oklch(0.45 0.18 25 / 0.2)";
  const glow40 = isFaitlyn
    ? "oklch(0.78 0.11 75 / 0.4)"
    : "oklch(0.45 0.18 25 / 0.4)";
  const glow15 = isFaitlyn
    ? "oklch(0.78 0.11 75 / 0.15)"
    : "oklch(0.45 0.18 25 / 0.15)";
  const glow35 = isFaitlyn
    ? "oklch(0.78 0.11 75 / 0.35)"
    : "oklch(0.45 0.18 25 / 0.35)";
  const glow10 = isFaitlyn
    ? "oklch(0.78 0.11 75 / 0.1)"
    : "oklch(0.45 0.18 25 / 0.1)";
  const iconColor = isFaitlyn
    ? "oklch(0.78 0.11 75 / 0.85)"
    : "oklch(0.45 0.18 25 / 0.85)";

  return (
    <div
      ref={ref}
      className="fixed bottom-5 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6"
    >
      <AnimatePresence>
        {open && (
          <div className="flex flex-col items-end gap-2.5">
            {showAI && (
              <motion.button
                type="button"
                {...rise(showWhatsApp ? 1 : 0)}
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/shade-finder" });
                }}
                className={`${OPTION_PILL} border-champagne/50 text-cream`}
                style={{
                  background:
                    "linear-gradient(135deg, var(--champagne, #b98a4a), var(--burgundy, #5c1a24))",
                }}
              >
                <span>Shop with AI</span>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/25">
                  <Sparkles size={16} strokeWidth={1.8} aria-hidden />
                </span>
              </motion.button>
            )}
            {showWhatsApp && (
              <motion.a
                {...rise(0)}
                href={waHref ?? undefined}
                onClick={(e) => {
                  setOpen(false);
                  if (!waHref) {
                    e.preventDefault();
                    void navigate({ to: "/contact" });
                  }
                }}
                target={waHref ? "_blank" : undefined}
                rel={waHref ? "noopener noreferrer" : undefined}
                className={`${OPTION_PILL} border-taupe/25 bg-ink/60 text-cream`}
              >
                <span>{waHref ? "Chat on WhatsApp" : "Contact us"}</span>
                <span
                  className="grid h-8 w-8 place-items-center rounded-full"
                  style={{ color: iconColor }}
                >
                  <WhatsAppIcon size={17} />
                </span>
              </motion.a>
            )}
          </div>
        )}
      </AnimatePresence>

      {/* The Concierge Beacon */}
      <div className="concierge-beacon-wrap" data-brand={brand}>
        {/* Orbit particles — visible on hover (desktop only) */}
        <div
          ref={orbitRef}
          className="concierge-orbit"
          aria-hidden
          style={{ opacity: hovered && !reduceMotion ? 1 : 0 }}
        >
          <span className="concierge-particle" style={{ ["--delay" as string]: "0s" }} />
          <span className="concierge-particle" style={{ ["--delay" as string]: "-1.5s" }} />
          <span className="concierge-particle" style={{ ["--delay" as string]: "-3s" }} />
          <span className="concierge-particle" style={{ ["--delay" as string]: "-4.5s" }} />
        </div>

        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={open ? "Close contact options" : "Concierge — shop with AI or WhatsApp"}
          title="Concierge"
          className="concierge-beacon"
          style={{
            ["--beacon-glow" as string]: glowColor,
            ["--beacon-glow-20" as string]: glow20,
            ["--beacon-glow-40" as string]: glow40,
            ["--beacon-glow-15" as string]: glow15,
            ["--beacon-glow-35" as string]: glow35,
            ["--beacon-glow-10" as string]: glow10,
            ["--beacon-icon" as string]: iconColor,
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            {open ? (
              <motion.span
                key="x"
                initial={{ rotate: -90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: 90, opacity: 0 }}
                transition={{ duration: 0.15 }}
                style={{ color: "var(--taupe)" }}
              >
                <X size={22} strokeWidth={2} />
              </motion.span>
            ) : (
              <motion.span
                key="wa"
                initial={{ rotate: 90, opacity: 0 }}
                animate={{ rotate: 0, opacity: 1 }}
                exit={{ rotate: -90, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <WhatsAppIcon size={24} />
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        {/* Concierge label — permanent on mobile, hover on desktop */}
        <span className="concierge-label">
          {open ? "" : "Chat"}
        </span>
      </div>

      <style>{`
        .concierge-beacon-wrap {
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }

        .concierge-beacon {
          position: relative;
          display: grid;
          place-items: center;
          width: 56px;
          height: 56px;
          border-radius: 50%;
          border: 1px solid oklch(0.82 0.045 60 / 0.25);
          background: oklch(0.14 0.012 60 / 0.6);
          backdrop-filter: blur(24px) saturate(1.4);
          -webkit-backdrop-filter: blur(24px) saturate(1.4);
          color: var(--beacon-icon);
          box-shadow:
            0 12px 30px rgba(0, 0, 0, 0.35),
            0 0 16px var(--beacon-glow-20),
            inset 0 1px 0 oklch(1 0 0 / 0.04);
          transition: transform 0.2s ease, box-shadow 0.4s ease;
          outline: none;
          animation: concierge-breathe 4s ease-in-out infinite;
        }
        .concierge-beacon:hover {
          transform: scale(1.08);
          animation-play-state: paused;
          box-shadow:
            0 12px 30px rgba(0, 0, 0, 0.35),
            0 0 28px var(--beacon-glow-40),
            0 0 48px var(--beacon-glow-15),
            inset 0 1px 0 oklch(1 0 0 / 0.04);
        }
        .concierge-beacon:active {
          transform: scale(0.94);
        }
        .concierge-beacon:focus-visible {
          box-shadow:
            0 0 0 2px oklch(0.96 0.018 80 / 0.5),
            0 12px 30px rgba(0, 0, 0, 0.35);
        }

        @keyframes concierge-breathe {
          0%, 100% {
            box-shadow:
              0 12px 30px rgba(0, 0, 0, 0.35),
              0 0 12px var(--beacon-glow-15),
              inset 0 1px 0 oklch(1 0 0 / 0.04);
          }
          50% {
            box-shadow:
              0 12px 30px rgba(0, 0, 0, 0.35),
              0 0 24px var(--beacon-glow-35),
              0 0 40px var(--beacon-glow-10),
              inset 0 1px 0 oklch(1 0 0 / 0.04);
          }
        }

        /* Orbit ring — each particle is a wrapper that rotates, with the dot
           offset 36px from centre via translateX. */
        .concierge-orbit {
          position: absolute;
          inset: -10px;
          pointer-events: none;
          transition: opacity 0.4s ease;
        }
        .concierge-particle {
          position: absolute;
          top: 50%;
          left: 50%;
          width: 0;
          height: 0;
          animation: concierge-orbit-spin 6s linear infinite;
          animation-delay: var(--delay, 0s);
        }
        .concierge-particle::after {
          content: '';
          position: absolute;
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--beacon-glow, oklch(0.78 0.11 75));
          box-shadow: 0 0 6px var(--beacon-glow, oklch(0.78 0.11 75));
          transform: translateX(36px) translateY(-1.5px);
        }

        @keyframes concierge-orbit-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }

        .concierge-label {
          font-size: 0.5rem;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: oklch(0.82 0.045 60 / 0.6);
          transition: opacity 0.3s ease;
          min-height: 0.7rem;
        }

        /* Desktop: label visible only on hover */
        @media (hover: hover) {
          .concierge-label {
            opacity: 0;
          }
          .concierge-beacon-wrap:hover .concierge-label {
            opacity: 1;
          }
        }

        /* Light mode overrides */
        :root .concierge-beacon {
          background: oklch(0.97 0.014 80 / 0.6);
          border-color: oklch(0.42 0.04 55 / 0.25);
        }


        @media (prefers-reduced-motion: reduce) {
          .concierge-beacon {
            animation: none !important;
          }
          .concierge-particle {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
