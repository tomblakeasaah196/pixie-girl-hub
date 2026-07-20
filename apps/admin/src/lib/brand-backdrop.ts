/**
 * Branded backgrounds for catalogue images.
 *
 * The upload modal (BrandedImageUpload) uses this to: (1) build the brand-colour
 * dropdown from real branding data, (2) send an uploaded image to the server to
 * have its subject isolated onto transparency, and (3) composite that cut-out
 * over the chosen brand colour on a canvas — so switching colour/style is
 * instant and the final image flows through the normal upload endpoints.
 *
 * Palette policy (owner directive): BRAND COLOURS ONLY — no free hex, no
 * off-brand neutrals — so backgrounds stay consistent across the site. The
 * options are the ACTIVE brand's full palette from the Storefront Studio
 * Branding/Theme tab (the same CSS-variable tokens the live website paints
 * with) — every core colour and brand accent, not just the primary — reusing
 * the shared `useBrandPalette` reader so the two stay in lockstep. Defaults to
 * the brand primary (the first swatch). Falls back to the storefront's shipped
 * defaults when the theme is unset or the studio API is unreadable.
 */

import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBrandPalette } from "@/lib/brand-colors";

export type BackdropStyle = "flat" | "gradient";

export interface BrandColour {
  /** Stable id for the option (swatch label). */
  token: string;
  /** Human label shown in the dropdown. */
  label: string;
  /** #rrggbb. */
  hex: string;
}

/**
 * The brand-colour palette + default for the ACTIVE brand, sourced from the
 * Storefront Studio Branding/Theme tab. De-duped by colour so two tokens that
 * resolve to the same hex show once. Defaults to the first (brand primary).
 */
export function useBrandBackdrop(): { colours: BrandColour[]; defaultHex: string } {
  const palette = useBrandPalette();
  return useMemo(() => {
    const colours: BrandColour[] = [];
    for (const s of palette) {
      const hex = s.hex.toLowerCase();
      if (colours.some((c) => c.hex.toLowerCase() === hex)) continue;
      colours.push({ token: s.label, label: s.label, hex: s.hex });
    }
    return { colours, defaultHex: colours[0]?.hex ?? "#690909" };
  }, [palette]);
}

// ── Server cut-out ────────────────────────────────────────
export interface CutoutResult {
  cutout_data_url: string;
  engine: "ai" | "alpha" | "keyer";
  keyed: boolean;
  warning: string | null;
  width: number | null;
  height: number | null;
}

/** POST an image to have its subject isolated onto transparency. */
export function useImageCutout() {
  return useMutation({
    mutationFn: ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (p: number) => void;
    }) => {
      const form = new FormData();
      form.append("file", file);
      return api.postForm<CutoutResult>("/catalogue/image-cutout", form, {
        onProgress,
      });
    },
  });
}

// ── Canvas compositing (client-side, instant) ─────────────
function darken(hex: string, factor: number): string {
  const h = hex.replace("#", "");
  const r = Math.round(parseInt(h.slice(0, 2), 16) * factor);
  const g = Math.round(parseInt(h.slice(2, 4), 16) * factor);
  const b = Math.round(parseInt(h.slice(4, 6), 16) * factor);
  const to = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the cut-out image"));
    img.src = src;
  });
}

/**
 * Composite a transparent cut-out over a brand backdrop and return a JPEG File
 * plus an object URL for preview. Flat = solid fill; gradient = the brand
 * colour at the top easing to a darker shade at the base (the same top-to-bottom
 * wash the app's brand surfaces use). The subject keeps its original framing —
 * only the background is replaced.
 *
 * The caller owns the returned previewUrl and must URL.revokeObjectURL() it.
 */
export async function compositeBranded(
  cutoutDataUrl: string,
  hex: string,
  style: BackdropStyle,
  filename = "branded.jpg",
): Promise<{ file: File; previewUrl: string }> {
  const img = await loadImage(cutoutDataUrl);
  const w = img.naturalWidth || 1200;
  const h = img.naturalHeight || 1200;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");

  if (style === "gradient") {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, hex);
    g.addColorStop(1, darken(hex, 0.55));
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = hex;
  }
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.92),
  );
  if (!blob) throw new Error("Could not render the branded image");
  const file = new File([blob], filename, { type: "image/jpeg" });
  return { file, previewUrl: URL.createObjectURL(blob) };
}
