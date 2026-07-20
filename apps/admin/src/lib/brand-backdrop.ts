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
 * options come from the active brand's theme (DB-driven via the branding feed),
 * defaulting to the brand's primary: burgundy for Pixie Girl, bronze for
 * Faitlyn Hair.
 */

import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBranding, type BusinessBranding } from "@/lib/branding";
import { useBusinessStore } from "@/stores/business";

export type BackdropStyle = "flat" | "gradient";

export interface BrandColour {
  /** Stable id for the option (theme token key). */
  token: string;
  /** Human label shown in the dropdown. */
  label: string;
  /** #rrggbb. */
  hex: string;
}

// Seed fallback mirrors migration 000208 so the dropdown is populated even
// before the branding feed resolves, or for a brand with no theme configured
// yet. The live branding data takes precedence when present.
const SEED: Record<string, BrandColour[]> = {
  pixiegirl: [
    { token: "accent", label: "Burgundy", hex: "#690909" },
    { token: "grad1", label: "Crimson", hex: "#A81D1D" },
    { token: "accent_deep", label: "Deep Maroon", hex: "#3A0505" },
  ],
  faitlynhair: [
    { token: "accent", label: "Bronze", hex: "#7F703D" },
    { token: "accent_deep", label: "Deep Bronze", hex: "#5B4F2A" },
    { token: "secondary", label: "Champagne", hex: "#D5B8A4" },
  ],
};

const HEX6 = /^#?[0-9a-fA-F]{6}$/;
const norm = (hex?: string | null) =>
  hex && HEX6.test(hex) ? (hex.startsWith("#") ? hex : `#${hex}`) : null;

/** Build the brand ramp from a business's live branding, de-duped by colour. */
function rampFromBusiness(biz?: BusinessBranding): BrandColour[] {
  if (!biz) return [];
  const theme = biz.brand_theme ?? {};
  const out: BrandColour[] = [];
  const push = (token: string, label: string, hex?: string | null) => {
    const n = norm(hex);
    if (!n) return;
    if (out.some((o) => o.hex.toLowerCase() === n.toLowerCase())) return;
    out.push({ token, label, hex: n });
  };
  push("accent", "Brand primary", theme.accent ?? biz.accent_colour);
  push("accent_deep", "Deep", theme.accent_deep);
  push("secondary", "Secondary", biz.secondary_colour);
  push("grad1", "Gradient top", theme.grad1);
  push("grad2", "Gradient base", theme.grad2);
  return out;
}

/** The brand-colour palette + default for the ACTIVE brand. */
export function useBrandBackdrop(): { colours: BrandColour[]; defaultHex: string } {
  const { data } = useBranding();
  const activeKey = useBusinessStore((s) => s.activeKey);
  return useMemo(() => {
    const biz = data?.businesses?.find((b) => b.business_key === activeKey);
    let colours = rampFromBusiness(biz);
    if (colours.length === 0) colours = SEED[activeKey ?? ""] ?? SEED.pixiegirl;
    return { colours, defaultHex: colours[0]?.hex ?? "#690909" };
  }, [data, activeKey]);
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
