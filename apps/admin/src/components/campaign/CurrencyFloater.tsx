/**
 * Floating currency toggle for sales-campaign landing pages.
 *
 * Small icon-only pill in the bottom-right that flips every price on the
 * page between ₦ and $ using the campaign's static FX rate (the SSOT for
 * customer-facing display — order settlement uses the LIVE rate elsewhere).
 *
 * Theming: paints itself with the brand's CSS variables that LandingRender
 * already injects (`--accent`, `--accent-deep`, `--accent-glow`), so it
 * follows Pixie Girl oxblood or Faitlyn brown automatically — never the
 * platform Maroon Noir default.
 *
 * Interaction:
 *  • Desktop hover: pill expands to show both glyphs so the visitor sees
 *    what tapping will switch to.
 *  • Mobile tap: single tap flips the active currency.
 *  • Hidden entirely when the campaign has no `ngn_per_usd_rate` set.
 */

import { useCurrencyStore, isUsdEnabled } from "@/lib/currency";

export function CurrencyFloater({
  fxRate,
  className,
}: {
  fxRate: number | null | undefined;
  className?: string;
}) {
  const currency = useCurrencyStore((s) => s.currency);
  const setCurrency = useCurrencyStore((s) => s.setCurrency);

  if (!isUsdEnabled(fxRate)) return null;

  const isNgn = currency === "NGN";
  const next = isNgn ? "USD" : "NGN";
  const activeGlyph = isNgn ? "₦" : "$";
  const otherGlyph = isNgn ? "$" : "₦";

  return (
    <button
      type="button"
      aria-label={`Switch to ${next === "USD" ? "US dollars" : "Nigerian naira"}`}
      title={`${activeGlyph} → ${otherGlyph}`}
      onClick={() => setCurrency(next)}
      className={
        // The container is a compact circle on idle and grows wide on
        // hover/focus to reveal both glyphs (desktop affordance). The mobile
        // path stays a single-tap swap — no hover, no growth required.
        [
          "group fixed bottom-5 right-5 z-40 select-none",
          "h-12 min-w-12 px-3 inline-flex items-center justify-center gap-1",
          "rounded-full overflow-hidden",
          "font-display text-[17px] font-semibold tabular-nums tracking-tight",
          "text-white",
          "shadow-[0_10px_30px_rgb(var(--accent-deep)/0.45)]",
          "backdrop-blur-md",
          "transition-[width,transform,background-color,box-shadow] duration-300 ease-out",
          "hover:scale-[1.04] active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
          className || "",
        ].join(" ")
      }
      style={{
        // Brand-tinted gradient pulled straight from the injected vars so
        // Pixie Girl, Faitlyn and any future brand all paint themselves.
        backgroundImage:
          "linear-gradient(135deg, rgb(var(--accent)) 0%, rgb(var(--accent-deep)) 100%)",
        boxShadow:
          "0 10px 30px rgb(var(--accent-deep) / 0.45), inset 0 1px 0 rgb(255 255 255 / 0.18)",
      }}
    >
      {/* Active glyph — visible always. The wrapper flips on currency
          change so the icon "spins" into the new value. */}
      <span
        key={activeGlyph}
        className="inline-block leading-none transition-transform duration-300 ease-out"
        style={{ animation: "currency-pop 320ms ease-out" }}
      >
        {activeGlyph}
      </span>
      {/* Hover-only secondary glyph — desktop affordance showing the swap
          target. Hidden on touch (max-pointer: coarse) so phones stay tight. */}
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
      {/* Lightweight keyframes scoped via a style tag so we don't have to
          edit tailwind config for a single one-shot animation. */}
      <style>{`
        @keyframes currency-pop {
          0%   { transform: scale(0.55) rotate(-18deg); opacity: 0; }
          60%  { transform: scale(1.08) rotate(2deg);   opacity: 1; }
          100% { transform: scale(1)    rotate(0);      opacity: 1; }
        }
      `}</style>
    </button>
  );
}
