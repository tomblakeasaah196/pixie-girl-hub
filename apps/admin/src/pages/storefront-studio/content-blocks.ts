/**
 * Journal content blocks — shared shape between Storefront Studio → Content
 * (this file) and the public storefront's renderer
 * (apps/storefront/src/lib/content-blocks.ts). No shared package between the
 * two Vite apps, so the type + helpers are intentionally duplicated rather
 * than reaching across app boundaries; keep the two files in sync by hand.
 *
 * Text blocks carry formatting as data (font/size/color/weight flags), never
 * as raw HTML — there is no rich-text editor injecting markup, so there is no
 * markup-injection surface on the storefront renderer either.
 */

import { api } from "@/lib/api";

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

export const FONT_OPTIONS: { key: FontKey; label: string; sample: string }[] = [
  { key: "cormorant", label: "Cormorant Garamond", sample: "font-family: 'Cormorant Garamond', serif" },
  { key: "instrument-serif", label: "Instrument Serif", sample: "font-family: 'Instrument Serif', serif" },
  { key: "work-sans", label: "Work Sans", sample: "font-family: 'Work Sans Variable', sans-serif" },
  { key: "archivo-black", label: "Archivo Black", sample: "font-family: 'Archivo Black', sans-serif" },
  { key: "playfair", label: "Playfair Display", sample: "font-family: 'Playfair Display', serif" },
  { key: "marcellus", label: "Marcellus", sample: "font-family: 'Marcellus', serif" },
  { key: "montserrat", label: "Montserrat", sample: "font-family: 'Montserrat', sans-serif" },
  { key: "cinzel", label: "Cinzel", sample: "font-family: 'Cinzel', serif" },
  { key: "eb-garamond", label: "EB Garamond", sample: "font-family: 'EB Garamond', serif" },
  { key: "prata", label: "Prata", sample: "font-family: 'Prata', serif" },
];

export type FontSize = "sm" | "base" | "lg" | "xl" | "2xl" | "3xl";
export const FONT_SIZE_OPTIONS: { value: FontSize; label: string }[] = [
  { value: "sm", label: "Small" },
  { value: "base", label: "Body" },
  { value: "lg", label: "Large" },
  { value: "xl", label: "Subheading" },
  { value: "2xl", label: "Heading" },
  { value: "3xl", label: "Display" },
];

export type EmbedAspect = "16:9" | "9:16" | "1:1";
export const ASPECT_OPTIONS: { value: EmbedAspect; label: string }[] = [
  { value: "16:9", label: "Landscape (16:9)" },
  { value: "9:16", label: "Portrait / Shorts / Reels (9:16)" },
  { value: "1:1", label: "Square (1:1)" },
];

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

export const BLOCK_TYPE_LABEL: Record<ContentBlock["type"], string> = {
  text: "Text",
  image: "Image",
  youtube: "YouTube video",
  instagram: "Instagram embed",
  video: "Uploaded video",
};

let seq = 0;
/** Client-side only — never re-used across saves, just needs to be unique per render. */
export function newBlockId(): string {
  seq += 1;
  return `blk_${Date.now().toString(36)}_${seq}`;
}

export function blankBlock(type: ContentBlock["type"]): ContentBlock {
  const id = newBlockId();
  switch (type) {
    case "text":
      return { id, type, text: "", fontFamily: "eb-garamond", fontSize: "base" };
    case "image":
      return { id, type, url: "", alt: "", caption: "" };
    case "youtube":
      return { id, type, url: "", aspect: "16:9", caption: "" };
    case "instagram":
      return { id, type, url: "", aspect: "9:16", caption: "" };
    case "video":
      return { id, type, url: "", caption: "" };
  }
}

/** Accepts watch/shorts/youtu.be URLs; the renderer needs only the raw video ID. */
export function extractYouTubeId(url: string): string | null {
  const m = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/.exec(
    url || "",
  );
  return m ? m[1] : null;
}

/** Accepts /reel/, /p/ and /tv/ Instagram URLs. */
export function extractInstagramShortcode(url: string): string | null {
  const m = /instagram\.com\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/.exec(url || "");
  return m ? m[1] : null;
}

export interface OEmbedResult {
  video_id: string;
  width: number | null;
  height: number | null;
  aspect: EmbedAspect | null;
  title: string | null;
}

/** Server-side lookup (studio.service.js#fetchOEmbed) — avoids a client→YouTube CORS call. */
export async function lookupYouTubeAspect(url: string): Promise<OEmbedResult> {
  return api.get<OEmbedResult>(`/storefront-studio/oembed?url=${encodeURIComponent(url)}`);
}
