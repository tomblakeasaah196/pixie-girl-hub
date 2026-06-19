/**
 * Landing Studio — data layer.
 *
 * The Landing Studio is a standalone, brand-level editor for the public
 * "no active sale" page served on each brand's sales subdomain. Config is a
 * single JSONB blob (per brand) with a working draft + a published snapshot.
 *
 * Colours are stored as #rrggbb hex; the renderer converts them to "r g b"
 * triplets and uses rgb(var(--brand-*) / a), matching the Maroon-Noir token
 * convention used across the platform.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useBusinessStore } from "@/stores/business";

export function useActiveBrand() {
  return useBusinessStore((s) => s.activeKey);
}

// ════════════════════════════════════════════════════════════
// Types — the design config contract (shared with the backend seed)
// ════════════════════════════════════════════════════════════

export type ChannelOption = "email" | "whatsapp" | "both";

export interface SocialLink {
  platform: string;
  href: string;
  label?: string;
}

export interface LandingTheme {
  ink: string;
  paper: string;
  primary: string;
  primaryDeep: string;
  accent: string;
  muted: string;
  glow: string;
}

export interface LandingConfig {
  brandName: string;
  legalName: string;
  tagline: string;
  welcomeLine: string;
  domain: string;
  storefront: string;
  address: string;
  theme: LandingTheme;
  three: { primary: string; accent: string; ink: string; metal: string };
  background: { type: "color" | "image"; imageUrl: string | null };
  logo: {
    url: string | null;
    headerTint: string | null;
    footerTint: string | null;
    headerScale: number;
    footerScale: number;
  };
  hero: {
    imageUrl: string | null;
    eyebrow: string;
    headline: string;
    headlineAccent: string;
    body: string;
    ctaLabel: string;
    launchSeasonLabel: string;
  };
  invitation: {
    eyebrow: string;
    heading: string;
    headingAccent: string;
    body: string;
    seatsTotal: number;
    seatsClaimedBase: number;
    perks: { numeral: string; label: string }[];
    formTitle: string;
    formTitleAccent: string;
    formEyebrow: string;
    referralNote: string;
  };
  form: {
    collectName: boolean;
    collectEmail: boolean;
    collectWhatsapp: boolean;
    collectReferral: boolean;
    channels: ChannelOption[];
    submitLabel: string;
    footnote: string;
  };
  galleryEyebrow: string;
  galleryHeading: string;
  gallery: { url: string; caption?: string }[];
  pillars: { numeral: string; title: string; body: string }[];
  socials: SocialLink[];
  reveal: { enabled: boolean; tagline: string; showScarcity: boolean };
}

export interface LandingStudioPayload {
  business_key: string;
  config: LandingConfig | null;
  published_config: LandingConfig | null;
  is_published: boolean;
  published_at: string | null;
  updated_at: string | null;
}

// ════════════════════════════════════════════════════════════
// Built-in defaults (mirror migration 000225) — used when a brand row
// hasn't been seeded yet, so the studio always renders something on-brand.
// ════════════════════════════════════════════════════════════

const PERKS = [
  { numeral: "I.", label: "First access" },
  { numeral: "II.", label: "Private pricing" },
  { numeral: "III.", label: "Curated gifts" },
];
const PILLARS = [
  { numeral: "I.", title: "Crafted", body: "Hand-selected strands, hand-finished lace. Every cap is made for one head." },
  { numeral: "II.", title: "Curated", body: "Tight seasons. Few pieces. We release only what we would wear ourselves." },
  { numeral: "III.", title: "Limited", body: "When a chapter closes, it closes. No restocks. No second printings." },
];

function baseConfig(): Omit<LandingConfig, "brandName" | "legalName" | "tagline" | "welcomeLine" | "domain" | "storefront" | "address" | "theme" | "three" | "socials" | "reveal"> {
  return {
    background: { type: "color", imageUrl: null },
    logo: { url: null, headerTint: null, footerTint: null, headerScale: 1.15, footerScale: 1.15 },
    hero: {
      imageUrl: null,
      eyebrow: "Between chapters — opening soon",
      headline: "Quiet",
      headlineAccent: "on purpose.",
      body: "The next chapter is being written. Doors closed for now — but the list inside hears first, pays less, and receives the curated gifts reserved for our earliest few. Add your name. Be first through the door.",
      ctaLabel: "Request your invitation",
      launchSeasonLabel: "The doors open in the season ahead",
    },
    invitation: {
      eyebrow: "The Inner Circle",
      heading: "Two hundred names.",
      headingAccent: "Nothing more.",
      body: "Twenty-four hours of early access. Private launch pricing — up to 30% off for the list. A curated launch gift hand-selected for top orders. And for those who bring three friends with them: an additional private discount and bonus loyalty points on every purchase they make.",
      seatsTotal: 200,
      seatsClaimedBase: 73,
      perks: PERKS,
      formTitle: "Reserve your seat",
      formTitleAccent: "at the table.",
      formEyebrow: "Private invitation",
      referralNote: "Invite three. When three friends you refer join the list, you unlock an additional private discount at launch — and every purchase they make adds to your loyalty points.",
    },
    form: {
      collectName: true,
      collectEmail: true,
      collectWhatsapp: true,
      collectReferral: true,
      channels: ["email", "whatsapp", "both"],
      submitLabel: "Add me to the list",
      footnote: "One message when doors open. A quiet inbox otherwise.",
    },
    galleryEyebrow: "The Last Chapter",
    galleryHeading: "A glimpse of what has been.",
    gallery: [],
    pillars: PILLARS,
  };
}

export function defaultConfig(brandKey: string): LandingConfig {
  if (brandKey === "faitlynhair") {
    return {
      ...baseConfig(),
      brandName: "Faitlyn Hair",
      legalName: "The Faitlyn Brand",
      tagline: "Quietly extraordinary.",
      welcomeLine: "Welcome to Faitlyn",
      domain: "sales.thefaitlynbrand.com",
      storefront: "https://thefaitlynbrand.com",
      address: "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos",
      theme: {
        ink: "#1A0F08", paper: "#F8F5F1", primary: "#3A2418",
        primaryDeep: "#281D15", accent: "#D9BFA8", muted: "#B6A696", glow: "#C79C6B",
      },
      three: { primary: "#3A2418", accent: "#D9BFA8", ink: "#1A0F08", metal: "#E5C9A8" },
      socials: [
        { platform: "instagram", href: "https://www.instagram.com/faitlynhair/", label: "Instagram" },
        { platform: "facebook", href: "https://web.facebook.com/faitlynhair/", label: "Facebook" },
        { platform: "twitter", href: "https://twitter.com/Faitlynhair", label: "X" },
        { platform: "whatsapp", href: "https://wa.me/2348061987874", label: "WhatsApp" },
      ],
      reveal: { enabled: true, tagline: "Quietly extraordinary.", showScarcity: true },
    };
  }
  return {
    ...baseConfig(),
    brandName: "Pixie Girl Global",
    legalName: "Pixie Girl Global LLC",
    tagline: "The House of the Pixie",
    welcomeLine: "Welcome to the House of Pixie",
    domain: "sales.pixiegirlglobal.com",
    storefront: "https://pixiegirlglobal.com",
    address: "30 N Gould St Ste R, Sheridan, WY 82801",
    theme: {
      ink: "#100806", paper: "#F8F4F2", primary: "#5C0A14",
      primaryDeep: "#36060D", accent: "#D4AF7A", muted: "#BBAEA8", glow: "#A11225",
    },
    three: { primary: "#5C0A14", accent: "#D4AF7A", ink: "#100806", metal: "#B8112B" },
    socials: [
      { platform: "instagram", href: "https://www.instagram.com/pixiegirlg", label: "Instagram" },
      { platform: "tiktok", href: "https://www.tiktok.com/@pixiegirlg", label: "TikTok" },
      { platform: "youtube", href: "https://www.youtube.com/@PixieGirlG", label: "YouTube" },
      { platform: "twitter", href: "https://x.com/pixiegirlg", label: "X" },
      { platform: "pinterest", href: "https://www.pinterest.com/pixiegirlg", label: "Pinterest" },
    ],
    reveal: { enabled: true, tagline: "The House of the Pixie", showScarcity: true },
  };
}

/** Deep-merge a partial config from the API over the brand defaults so a
 *  sparse or older saved config never leaves the renderer with holes. */
export function withDefaults(brandKey: string, cfg: Partial<LandingConfig> | null): LandingConfig {
  const d = defaultConfig(brandKey);
  if (!cfg) return d;
  return {
    ...d,
    ...cfg,
    theme: { ...d.theme, ...(cfg.theme ?? {}) },
    three: { ...d.three, ...(cfg.three ?? {}) },
    background: { ...d.background, ...(cfg.background ?? {}) },
    logo: { ...d.logo, ...(cfg.logo ?? {}) },
    hero: { ...d.hero, ...(cfg.hero ?? {}) },
    invitation: { ...d.invitation, ...(cfg.invitation ?? {}) },
    form: { ...d.form, ...(cfg.form ?? {}) },
    pillars: cfg.pillars?.length ? cfg.pillars : d.pillars,
    socials: cfg.socials?.length ? cfg.socials : d.socials,
    gallery: cfg.gallery ?? d.gallery,
    reveal: { ...d.reveal, ...(cfg.reveal ?? {}) },
  };
}

// ════════════════════════════════════════════════════════════
// Colour helpers
// ════════════════════════════════════════════════════════════

const HEX_RE = /^#?[0-9a-fA-F]{6}$/;

/** "#5C0A14" → "92 10 20" (the triplet rgb(var(--x) / a) expects). */
export function hexToTriplet(hex: string | null | undefined): string {
  if (!hex || !HEX_RE.test(hex)) return "0 0 0";
  const h = hex.replace("#", "");
  return `${parseInt(h.slice(0, 2), 16)} ${parseInt(h.slice(2, 4), 16)} ${parseInt(h.slice(4, 6), 16)}`;
}

// ════════════════════════════════════════════════════════════
// Queries + mutations
// ════════════════════════════════════════════════════════════

export function useLandingStudio() {
  const brand = useActiveBrand();
  return useQuery<LandingStudioPayload>({
    queryKey: ["landing-studio", brand],
    queryFn: () => api.get<LandingStudioPayload>("/landing-studio"),
  });
}

export function useSaveLandingDraft() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: (config: LandingConfig) =>
      api.put<LandingStudioPayload>("/landing-studio", { config }),
    onSuccess: (data) => {
      qc.setQueryData(["landing-studio", brand], data);
    },
  });
}

export function usePublishLanding() {
  const qc = useQueryClient();
  const brand = useActiveBrand();
  return useMutation({
    mutationFn: () => api.post<LandingStudioPayload>("/landing-studio/publish"),
    onSuccess: (data) => {
      qc.setQueryData(["landing-studio", brand], data);
    },
  });
}

export async function uploadLandingImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const { url } = await api.postForm<{ url: string }>(
    "/landing-studio/upload-image",
    form,
  );
  return url;
}
