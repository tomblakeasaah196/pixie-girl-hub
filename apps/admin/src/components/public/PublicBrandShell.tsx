import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useBranding, type BusinessBranding } from "@/lib/branding";
import { hexToTriplet, initials } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * Shared chrome for every PUBLIC, token-linked page a customer or
 * candidate lands on from outside the app: the order/catalogue link,
 * the Online-QR welcome form, the document-signing page and the offer
 * packet. One shell so all four are branded identically and per-brand.
 *
 * What it does:
 *   • Resolves the brand from the DB-driven /api/public/branding feed
 *     (business_key, else a display-name fallback for surfaces that only
 *     carry the brand's name) — full display_name, uploaded logo, and
 *     the brand's Layer-B accent + gradient.
 *   • Paints a glassmorphic card over a per-brand colour mesh, so a
 *     Faitlyn Hair link looks like Faitlyn Hair and a Pixie Girl link
 *     looks like Pixie Girl — any new brand gets the same treatment the
 *     moment its business_config row is filled.
 *   • Falls back to the seed palette (migration 000208) while the
 *     branding query is in flight, and to a gradient monogram when a
 *     brand has no logo yet, so the header never flashes generic chrome.
 *
 * Deliberately self-contained: it tints via inline CSS variables on its
 * OWN wrapper and renders its OWN mesh, rather than mutating :root — so
 * it never fights ThemeProvider (which drives the authenticated shell
 * from the active-business store, not the link's brand).
 */

// Fallback palette for brand keys whose branding row hasn't loaded yet
// (or isn't filled in for a brand-new business). Mirrors the seed values
// in migration 000208 so the header matches the rest of the app.
const BRAND_FALLBACK: Record<
  string,
  { name: string; grad1: string; grad2: string; accent: string }
> = {
  pixiegirl: {
    name: "Pixie Girl Global",
    grad1: "#a81d1d",
    grad2: "#690909",
    accent: "#690909",
  },
  faitlynhair: {
    name: "Faitlyn Hair",
    grad1: "#7f703d",
    grad2: "#d5b8a4",
    accent: "#7f703d",
  },
};

interface BrandIdentity {
  name: string;
  monogram: string;
  logoUrl: string | null;
  grad1: string;
  grad2: string;
  accent: string;
  vars: CSSProperties;
  meshStyle: CSSProperties;
}

/**
 * Resolve a brand's public identity from the branding feed. `brand` is a
 * business_key ("faitlynhair"); `fallbackName` is a display string used
 * when no key is available (the offer packet only carries company.name)
 * — we match it against the feed's display_name to still recover the
 * logo + colours.
 */
function useBrandIdentity(
  brand?: string | null,
  fallbackName?: string | null,
): BrandIdentity {
  const { data } = useBranding();
  return useMemo(() => {
    const list = data?.businesses ?? [];
    const row: BusinessBranding | null =
      (brand && list.find((b) => b.business_key === brand)) ||
      (fallbackName &&
        list.find(
          (b) =>
            b.display_name.toLowerCase() === fallbackName.trim().toLowerCase(),
        )) ||
      null;

    const fallback = brand ? BRAND_FALLBACK[brand] : undefined;
    const name =
      row?.display_name || fallback?.name || fallbackName || "Welcome";
    const accent =
      row?.brand_theme?.accent ||
      row?.accent_colour ||
      fallback?.accent ||
      "#690909";
    const grad1 =
      row?.brand_theme?.grad1 ||
      row?.secondary_colour ||
      fallback?.grad1 ||
      accent;
    const grad2 = row?.brand_theme?.grad2 || fallback?.grad2 || accent;
    const accentDeep =
      row?.brand_theme?.accent_deep ||
      row?.brand_theme?.accent ||
      row?.accent_colour ||
      accent;

    // Repaint the accent tokens on THIS wrapper (they inherit to every
    // descendant) so every button / input / focus ring / check on the
    // page carries the brand tint — not the platform maroon.
    const vars: CSSProperties = {
      ["--accent" as string]: hexToTriplet(accent),
      ["--accent-deep" as string]: hexToTriplet(accentDeep),
      ["--accent-glow" as string]: hexToTriplet(accent),
      ["--biz-1" as string]: grad1,
      ["--biz-2" as string]: grad2,
      ["--biz-accent" as string]: accent,
    };
    // Per-brand ambient mesh behind the glass (mirrors the canon §2.5
    // wash), keyed off the brand's own gradient stops.
    const meshStyle: CSSProperties = {
      backgroundImage: [
        `radial-gradient(34% 34% at 10% 6%, color-mix(in srgb, ${grad1} 45%, transparent), transparent 70%)`,
        `radial-gradient(40% 40% at 90% 8%, color-mix(in srgb, ${accent} 22%, transparent), transparent 72%)`,
        `radial-gradient(46% 46% at 88% 92%, color-mix(in srgb, ${grad2} 34%, transparent), transparent 74%)`,
        `radial-gradient(42% 42% at 4% 96%, color-mix(in srgb, ${accent} 22%, transparent), transparent 74%)`,
      ].join(", "),
      filter: "blur(40px) saturate(120%)",
      opacity: 0.55,
    };

    return {
      name,
      monogram: initials(name).slice(0, 2) || "•",
      logoUrl: row?.logo_path || null,
      grad1,
      grad2,
      accent,
      vars,
      meshStyle,
    };
  }, [data, brand, fallbackName]);
}

interface PublicBrandShellProps {
  /** business_key ("faitlynhair" | "pixiegirl" | any new brand). */
  brand?: string | null;
  /** Display-name fallback when no key is available (offer packet). */
  brandNameFallback?: string | null;
  /** Small caption under the brand name ("Confirm your order", …). */
  subtitle?: string;
  /** Card max width in px. Default 560. */
  maxWidth?: number;
  /** Optional centred footer line under the card. */
  footer?: ReactNode;
  /** Card surface. Default glassmorphic. */
  surface?: "glass" | "panel";
  children: ReactNode;
}

export function PublicBrandShell({
  brand,
  brandNameFallback,
  subtitle,
  maxWidth = 560,
  footer,
  surface = "glass",
  children,
}: PublicBrandShellProps) {
  const id = useBrandIdentity(brand, brandNameFallback);
  return (
    // Own scroll: the app pins `body { overflow:hidden }` globally, so this
    // standalone page must scroll ITSELF. The height must be CONSTRAINED
    // (h-[100dvh], not min-h) — a min-height container grows past the
    // viewport and, with body overflow hidden, its lower half (the form
    // fields + submit button) becomes unreachable: the "form is locked at
    // the top, can't scroll" bug. h-[100dvh] caps it to the viewport so
    // overflow-y-auto scrolls the content internally.
    <div
      className="relative h-[100dvh] overflow-y-auto overscroll-contain bg-bg text-text-primary"
      style={id.vars}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={id.meshStyle}
      />
      <div className="relative z-10 px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto w-full" style={{ maxWidth }}>
          <div className="mb-5 flex items-center gap-2.5">
            {id.logoUrl ? (
              <img
                src={id.logoUrl}
                alt={id.name}
                className="h-11 w-11 rounded-xl border hairline bg-panel object-contain p-1.5"
              />
            ) : (
              <div
                className="grid h-11 w-11 place-items-center rounded-xl font-display text-[16px] tracking-wide"
                style={{
                  background: `linear-gradient(135deg, ${id.grad1}, ${id.grad2})`,
                  color: "#fff",
                  textShadow: "0 1px 2px rgba(0,0,0,.35)",
                }}
              >
                {id.monogram}
              </div>
            )}
            <div>
              <p className="font-display text-[18px] leading-none">{id.name}</p>
              {subtitle && (
                <p className="mt-1 text-[11.5px] text-text-faint">{subtitle}</p>
              )}
            </div>
          </div>
          <div
            className={cn(
              "rounded-2xl p-5 sm:p-6",
              surface === "glass" ? "glass" : "border hairline bg-panel",
            )}
          >
            {children}
          </div>
          {footer && (
            <p className="mt-4 text-center text-[10.5px] text-text-faint">
              {footer}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
