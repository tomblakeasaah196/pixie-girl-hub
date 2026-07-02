/**
 * Home template content layer.
 *
 * The ported maison sections are the TEMPLATE. Their content is resolved at SSR:
 *   1. Marketing copy/images come from the Studio home page `slots` (/site).
 *   2. Catalogue items (products/bundles/shades + their images) come from the
 *      Hub catalogue endpoints.
 *   3. When Studio hasn't published a home page (or the catalogue is empty), we
 *      fall back to the ported defaults so the page looks identical either way.
 *
 * This keeps every pixel Studio-editable and every product/image backend-driven,
 * exactly as ported.
 */
import { SITE_IMAGES as I } from "./site-assets";
import {
  SHADES as DEMO_SHADES,
  WHY_CHOOSE_PILLARS,
  PRODUCTS as DEMO_PRODUCTS,
  BUNDLES as DEMO_BUNDLES,
  getBundleProducts,
  bundleCompareAtNgn,
  bundleSavingsPct,
  type Pillar,
} from "./site-data";
import type { ProductCard } from "./storefront";

/* ── resolved item shapes the components consume ─────────────── */

export interface SignatureItem {
  slug: string;
  name: string;
  category?: string;
  priceUsd?: number | null;
  priceNgn?: number | null;
  image?: string | null;
}
export interface BundleItem {
  slug: string;
  name: string;
  priceNgn: number;
  compareAtNgn: number;
  savingsPct: number;
  members: number;
  cover?: string | null;
}
export interface ShadeItem {
  slug: string;
  name: string;
  image?: string | null;
  swatch?: string;
}

/* ── marketing section content (from Studio slots) ───────────── */

export interface HeroContent {
  eyebrow: string;
  eyebrowAccent?: string;
  heading: string;
  headingAccent?: string;
  headingAfter?: string;
  body: string;
  bodyAccent?: string;
  bodyAfter?: string;
  cta1Label: string;
  cta1Href: string;
  cta2Label: string;
  cta2Href: string;
  imageUrl: string;
}
export interface HeadContent {
  eyebrow?: string;
  heading?: string;
  headingAccent?: string;
  headingAfter?: string;
  body?: string;
  linkLabel?: string;
  linkHref?: string;
}
export interface EditorialContent {
  eyebrow: string;
  heading: string;
  headingAccent?: string;
  headingAfter?: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  imageUrl: string;
}
export interface Testimonial { q: string; a: string; r: string }
export interface FounderContent { eyebrow: string; body: string; attribution: string }

export interface HomeContent {
  hero: HeroContent;
  marquee: string[];
  bundlesHead: HeadContent;
  shadesHead: HeadContent;
  signatureHead: HeadContent;
  whyChoose: HeadContent & { pillars: Pillar[]; bodyAccent?: string };
  editorial: EditorialContent;
  press: { eyebrow: string; items: string[] };
  testimonials: { eyebrow: string; items: Testimonial[] };
  gallery: { eyebrow: string; heading: string; images: string[] };
  founder: FounderContent;
}

/* ── ported defaults (the exact reference content) ───────────── */

export const DEFAULT_HOME: HomeContent = {
  hero: {
    eyebrow: "The Autumn Edit · 2026 · ",
    eyebrowAccent: "nouveauté",
    heading: "Hair, ",
    headingAccent: "sculptée",
    headingAfter: " like couture.",
    body: "A Lagos studio crafting the world's most coveted pixies, bobs and curls. Hand-finished. Lace-perfect. ",
    bodyAccent: "Fait avec amour",
    bodyAfter: " — worn by the women who set the standard.",
    cta1Label: "Shop the Catalogue",
    cta1Href: "/shop",
    cta2Label: "Our Story",
    cta2Href: "/about",
    imageUrl: I.heroModel,
  },
  marquee: [
    "Hand-finished in Lagos",
    "Single-donor virgin hair",
    "HD melt lace",
    "Complimentary worldwide shipping",
    "1-year atelier guarantee",
    "Reusable for 18 months+",
  ],
  bundlesHead: {
    eyebrow: "Shop the edit · ensembles",
    heading: "Curated ",
    headingAccent: "bundles",
    headingAfter: ". Better together.",
    linkLabel: "All bundles →",
    linkHref: "/bundles",
  },
  shadesHead: {
    eyebrow: "Shop by shade",
    heading: "Find the tone that ",
    headingAccent: "speaks",
    headingAfter: " to you",
    body: "Explore our shade catalogue. Every tone is hand-mixed in the studio and colour-matched to your skin.",
  },
  signatureHead: {
    eyebrow: "Signature collection",
    heading: "The house edit",
  },
  whyChoose: {
    eyebrow: "Why choose",
    heading: "Faitlyn ",
    headingAccent: "Hair",
    body: "Each wig is handcrafted by artisans in our Lagos studio — made with precision, passion, and with women of colour in mind. ",
    bodyAccent: "Fait à la main.",
    pillars: WHY_CHOOSE_PILLARS,
  },
  editorial: {
    eyebrow: "The Atelier",
    heading: "Every piece passes through ",
    headingAccent: "eleven pairs",
    headingAfter: " of hands before it reaches yours.",
    body: "From the sourcing of single-donor cuticle-aligned hair, to the hand-tying of every HD lace knot, to the final steam-set on the head of a Lagos master stylist — we refuse a single shortcut. The result is hair that wears like the dress code of the women who set the standard.",
    ctaLabel: "Read the story",
    ctaHref: "/about",
    imageUrl: I.editorialAtelier,
  },
  press: {
    eyebrow: "As seen in",
    items: ["VOGUE", "ELLE", "HARPER'S BAZAAR", "ESSENCE", "BAZAAR ARABIA", "GQ"],
  },
  testimonials: {
    eyebrow: "From the women who wear it",
    items: [
      { q: "I've worn every house. Faitlyn is the only one that makes me feel like I'm not wearing anything at all.", a: "Adaeze O.", r: "Lagos · Stylist" },
      { q: "The lace melts. The cut frames. I get stopped in every room I walk into.", a: "Imani T.", r: "New York · Editor" },
      { q: "Three units in. Each one outlasts the last. This is what luxury hair should have always been.", a: "Sophie L.", r: "London · Founder" },
    ],
  },
  gallery: {
    eyebrow: "@faitlynhair",
    heading: "Tagged on Instagram",
    images: [I.productPixie, I.productBob, I.productCurls, I.productStraight, I.models, I.model2, I.heroModel, I.productPixie],
  },
  founder: {
    eyebrow: "A note from Faitlyn",
    body: "I started Faitlyn because the hair I wanted didn't exist. So I built it — slowly, by hand, with women who care about the craft as much as I do. Everything you see here is the version of luxury I always wished I could buy.",
    attribution: "— Faitlyn, Founder",
  },
};

/* ── catalogue mappers (backend → item shapes) ───────────────── */

const num = (x: unknown) => (x == null ? 0 : Number(x) || 0);

export function mapProducts(cards: ProductCard[]): SignatureItem[] {
  return cards.map((p) => ({
    slug: p.slug,
    name: p.name,
    priceUsd: num(p.effective_price_usd),
    priceNgn: num(p.effective_price_ngn),
    image: p.cover_image_url ?? null,
  }));
}

interface RawShade { slug: string; name: string; cover_image_url?: string | null }
export function mapShades(rows: RawShade[]): ShadeItem[] {
  return rows.map((s) => ({
    slug: s.slug,
    name: s.name,
    image: s.cover_image_url ?? null,
    swatch: DEMO_SHADES.find((d) => d.slug === s.slug)?.swatch,
  }));
}

interface RawBundleComponent { price_ngn?: string | number | null; quantity?: number; image_url?: string | null }
export interface RawBundle {
  bundle_code: string;
  display_name: string;
  pricing_model?: string;
  discount_value?: string | number | null;
  bundle_price_ngn?: string | number | null;
  hero_image_url?: string | null;
  components?: RawBundleComponent[];
}

/**
 * Effective bundle price in NGN — mirrors the backend's computeBundleEconomics so
 * discount-based bundles (pct_off / amount_off) don't show ₦0. `discount_value`
 * is a fraction for pct_off (0.15 = 15%) and ₦/unit for amount_off.
 */
export function bundleEffectiveNgn(
  b: Pick<RawBundle, "pricing_model" | "discount_value" | "bundle_price_ngn">,
  subtotalNgn: number,
  units: number,
): number {
  const dv = num(b.discount_value);
  const bp = num(b.bundle_price_ngn);
  switch (b.pricing_model) {
    case "fixed_bundle_price":
      return bp;
    case "pct_off":
      return Math.max(0, subtotalNgn - Math.min(subtotalNgn * dv, subtotalNgn));
    case "amount_off":
      return Math.max(0, subtotalNgn - Math.min(dv * Math.max(1, units), subtotalNgn));
    default:
      return bp > 0 ? bp : subtotalNgn;
  }
}

export function mapBundles(rows: RawBundle[]): BundleItem[] {
  return rows.map((b) => {
    const comps = b.components ?? [];
    const compareAtNgn = comps.reduce(
      (sum, c) => sum + num(c.price_ngn) * (Number(c.quantity) || 1),
      0,
    );
    const units = comps.reduce((s, c) => s + (Number(c.quantity) || 1), 0);
    const priceNgn = bundleEffectiveNgn(b, compareAtNgn, units);
    const savingsPct =
      compareAtNgn > priceNgn && compareAtNgn > 0
        ? Math.round(((compareAtNgn - priceNgn) / compareAtNgn) * 100)
        : 0;
    return {
      slug: b.bundle_code,
      name: b.display_name,
      priceNgn,
      compareAtNgn,
      savingsPct,
      members: comps.length,
      cover: b.hero_image_url ?? comps[0]?.image_url ?? null,
    };
  });
}

/* ── demo fallbacks (identical to the ported look) ───────────── */

export const DEMO_SIGNATURE: SignatureItem[] = DEMO_PRODUCTS.map((p) => ({
  slug: p.slug,
  name: p.name,
  category: p.category,
  priceUsd: p.price,
  priceNgn: p.priceNgn,
  image: p.images[0],
}));

export const DEMO_SHADE_ITEMS: ShadeItem[] = DEMO_SHADES.map((s) => ({
  slug: s.slug,
  name: s.name,
  swatch: s.swatch,
}));

export const DEMO_BUNDLE_ITEMS: BundleItem[] = DEMO_BUNDLES.map((b) => {
  const members = getBundleProducts(b);
  const compareAtNgn = bundleCompareAtNgn(b);
  return {
    slug: b.slug,
    name: b.name,
    priceNgn: b.priceNgn,
    compareAtNgn,
    savingsPct: bundleSavingsPct(b),
    members: members.length,
    cover: b.image ?? members[0]?.images[0] ?? null,
  };
});

/* ── resolve Studio slots over the defaults ──────────────────── */

type Slots = Record<string, unknown> | null | undefined;

/** Shallow-merge each section's slot object over the ported default. */
export function resolveHomeContent(slots: Slots): HomeContent {
  if (!slots || typeof slots !== "object") return DEFAULT_HOME;
  const s = slots as Record<string, Record<string, unknown>>;
  const merge = <T,>(def: T, key: string): T =>
    s[key] && typeof s[key] === "object" ? { ...def, ...(s[key] as object) } : def;
  return {
    hero: merge(DEFAULT_HOME.hero, "hero"),
    marquee: Array.isArray(s.marquee) ? (s.marquee as string[]) : DEFAULT_HOME.marquee,
    bundlesHead: merge(DEFAULT_HOME.bundlesHead, "bundles"),
    shadesHead: merge(DEFAULT_HOME.shadesHead, "shades"),
    signatureHead: merge(DEFAULT_HOME.signatureHead, "signature"),
    whyChoose: merge(DEFAULT_HOME.whyChoose, "why_choose"),
    editorial: merge(DEFAULT_HOME.editorial, "editorial"),
    press: merge(DEFAULT_HOME.press, "press"),
    testimonials: merge(DEFAULT_HOME.testimonials, "testimonials"),
    gallery: merge(DEFAULT_HOME.gallery, "gallery"),
    founder: merge(DEFAULT_HOME.founder, "founder"),
  };
}
