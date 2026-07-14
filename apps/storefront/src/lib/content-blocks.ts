/**
 * Journal content blocks — public-renderer mirror of
 * apps/admin/src/pages/storefront-studio/content-blocks.ts. No shared package
 * between the two Vite apps, so this is intentionally duplicated; keep the
 * two files in sync by hand when the block shape changes.
 */

export type FontKey =
  | "cormorant"
  | "instrument-serif"
  | "work-sans"
  | "archivo-black"
  | "playfair"
  | "marcellus"
  | "montserrat"
  | "cinzel"
  | "eb-garamond"
  | "prata";

/** CSS font-family value per key — matches the @fontsource imports in styles.css. */
export const FONT_CSS: Record<FontKey, string> = {
  cormorant: "'Cormorant Garamond', ui-serif, Georgia, serif",
  "instrument-serif": "'Instrument Serif', ui-serif, Georgia, serif",
  "work-sans": "'Work Sans Variable', ui-sans-serif, system-ui, sans-serif",
  "archivo-black": "'Archivo Black', ui-sans-serif, sans-serif",
  playfair: "'Playfair Display', ui-serif, Georgia, serif",
  marcellus: "'Marcellus', ui-serif, Georgia, serif",
  montserrat: "'Montserrat', ui-sans-serif, sans-serif",
  cinzel: "'Cinzel', ui-serif, Georgia, serif",
  "eb-garamond": "'EB Garamond', ui-serif, Georgia, serif",
  prata: "'Prata', ui-serif, Georgia, serif",
};

export type FontSize = "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";
export const FONT_SIZE_REM: Record<FontSize, string> = {
  sm: "0.875rem",
  base: "1.0625rem",
  lg: "1.25rem",
  xl: "1.625rem",
  "2xl": "2.125rem",
  "3xl": "2.75rem",
};

export type EmbedAspect = "16:9" | "9:16" | "1:1";
export const ASPECT_RATIO_CSS: Record<EmbedAspect, string> = {
  "16:9": "16 / 9",
  "9:16": "9 / 16",
  "1:1": "1 / 1",
};

export interface TextBlock {
  id: string;
  type: "text";
  text: string;
  fontFamily?: FontKey | null;
  fontSize?: FontSize | null;
  color?: string | null;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | null;
  align?: "left" | "center" | "right" | null;
}
export interface ImageBlock {
  id: string;
  type: "image";
  url: string;
  alt?: string | null;
  caption?: string | null;
}
export interface YoutubeBlock {
  id: string;
  type: "youtube";
  url: string;
  aspect: EmbedAspect;
  caption?: string | null;
}
export interface InstagramBlock {
  id: string;
  type: "instagram";
  url: string;
  aspect: EmbedAspect;
  caption?: string | null;
}
export interface VideoBlock {
  id: string;
  type: "video";
  url: string;
  poster_url?: string | null;
  width?: number | null;
  height?: number | null;
  caption?: string | null;
}
export type ContentBlock =
  | TextBlock
  | ImageBlock
  | YoutubeBlock
  | InstagramBlock
  | VideoBlock;

/** Accepts watch/shorts/youtu.be URLs; only ever used to build a
 *  youtube-nocookie.com embed src, never fetched or navigated to directly. */
export function extractYouTubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/.exec(
    url || "",
  );
  return m ? m[1] : null;
}

/** Privacy-enhanced embed: no cookies until playback, minimal chrome, no
 *  related-video suggestions from other channels at the end. */
export function youTubeEmbedSrc(url: string): string | null {
  const id = extractYouTubeId(url);
  if (!id) return null;
  const params = new URLSearchParams({
    modestbranding: "1",
    rel: "0",
    iv_load_policy: "3",
    playsinline: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

export function extractInstagramShortcode(url: string): string | null {
  const m = /instagram\.com\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/.exec(url || "");
  return m ? m[1] : null;
}

/** Instagram's own iframe embed — no third-party <script> widget is injected
 *  into the page, just a sandboxed frame, same trust model as the YouTube embed. */
export function instagramEmbedSrc(url: string): string | null {
  const code = extractInstagramShortcode(url);
  return code ? `https://www.instagram.com/reel/${code}/embed/captioned/` : null;
}
