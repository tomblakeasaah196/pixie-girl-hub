/**
 * Resolve a brand's public identity (name, logo, accent) for the
 * unauthenticated customer forms, from the same /api/public/branding feed the
 * login screen uses. Replaces the hardcoded name map + generic icon so the
 * Walk-in / Online-QR forms show the real brand — logo, display name and
 * accent colour — straight from Settings.
 */

import { useMemo } from "react";
import { useBranding, hexToTriplet } from "./branding";

export interface PublicBrand {
  name: string | null;
  logoUrl: string | null;
  /** CSS custom-property overrides that re-tint the form with the brand accent. */
  styleVars: React.CSSProperties;
}

export function usePublicBrand(
  brandKey: string,
  fallbackName?: string,
): PublicBrand {
  const { data } = useBranding();
  return useMemo(() => {
    const biz = data?.businesses?.find((b) => b.business_key === brandKey);
    const accent = biz?.brand_theme?.accent || biz?.accent_colour || null;
    const accentDeep =
      biz?.brand_theme?.accent_deep || biz?.secondary_colour || accent;

    const vars: Record<string, string> = {};
    const at = accent ? hexToTriplet(accent) : null;
    const adt = accentDeep ? hexToTriplet(accentDeep) : null;
    if (at) {
      vars["--accent"] = at;
      vars["--accent-glow"] = at;
    }
    if (adt) vars["--accent-deep"] = adt;

    return {
      name: biz?.display_name ?? fallbackName ?? null,
      logoUrl: biz?.logo_path ?? null,
      styleVars: vars as React.CSSProperties,
    };
  }, [data, brandKey, fallbackName]);
}
