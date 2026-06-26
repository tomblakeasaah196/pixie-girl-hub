import pixie from "@/assets/product-pixie.jpg";
import bob from "@/assets/product-bob.jpg";
import curls from "@/assets/product-curls.jpg";
import straight from "@/assets/product-straight.jpg";
import models from "@/assets/faitlyn-models.jpg.asset.json";
import model2 from "@/assets/faitlyn-model-2.jpg.asset.json";
import type { ArtistryContent, FAQContent, ShadeSlug } from "@/lib/site-content";

export type HeadSize = "S" | "M" | "L" | "XL";

/** Editorial groupings shown across the site (separate from category). */
export type CollectionSlug = "signature" | "essentials" | "couture-edit" | "bundles";

export const COLLECTIONS: { slug: CollectionSlug; label: string; tagline: string }[] = [
  { slug: "signature",    label: "Signature Editions", tagline: "Our most-loved silhouettes." },
  { slug: "essentials",   label: "The Essentials",     tagline: "Everyday luxury, ready to wear." },
  { slug: "couture-edit", label: "Couture Edit",       tagline: "Limited, hand-finished pieces." },
  { slug: "bundles",      label: "Bundles",            tagline: "Curated sets, better together." },
];

export type Product = {
  slug: string;
  name: string;
  tagline: string;
  category: "pixies" | "bobs" | "curls" | "straight";
  collection: CollectionSlug;
  /** Default shade (for /shop?shade= filtering). Optional. */
  shade?: ShadeSlug;
  /** Canonical USD price (used for international currencies + Stripe settlement). */
  price: number;
  /** Hand-set NGN price for Nigerian customers (Paystack/Nomba settlement).
   *  Independent of live FX so the founder controls Naira pricing. */
  priceNgn: number;
  images: string[];
  lengths: string[];
  lace: string[];
  headSizes: HeadSize[];
  description: string;
  details: string[];
  /** Optional per-product overrides for the editorial blocks. */
  artistry?: Partial<ArtistryContent>;
  faq?: FAQContent;
};

export const CATEGORIES = [
  { slug: "pixies", label: "Pixies" },
  { slug: "bobs", label: "Bobs" },
  { slug: "curls", label: "Curls" },
  { slug: "straight", label: "Bone Straight" },
] as const;

export const HEAD_SIZE_CHART: { size: HeadSize; circumference: string; description: string }[] = [
  { size: "S", circumference: '20.5" – 21"', description: "Petite · snug crown" },
  { size: "M", circumference: '21.5" – 22"', description: "Average · most common" },
  { size: "L", circumference: '22.5"', description: "Generous · fuller crown" },
  { size: "XL", circumference: '23" +', description: "Custom · made to measure" },
];

/** How-to-measure tutorial filmed by founder Faith Alex. Public YouTube embed. */
export const SIZE_GUIDE_VIDEO_ID = "8ANsbZzZeVQ";

const ALL_SIZES: HeadSize[] = ["S", "M", "L", "XL"];

export const PRODUCTS: Product[] = [
  {
    slug: "signature-pixie",
    name: "The Signature Pixie",
    tagline: "Hand-cut, glass-finished",
    category: "pixies",
    collection: "signature",
    shade: "blacky-by-nature",
    price: 890,
    priceNgn: 1470000,
    images: [pixie, model2.url],
    lengths: ['6"', '8"', '10"'],
    lace: ["HD Lace", "Transparent"],
    headSizes: ALL_SIZES,
    description:
      "Our signature couture pixie, cut by hand on the head. Cuticle-aligned virgin hair, melted HD lace and a feather-light cap that disappears at the hairline.",
    details: [
      "100% raw, single-donor virgin hair",
      "Hand-tied HD lace, swiss base",
      "Pre-plucked hairline · bleached knots",
      "Reusable up to 18 months with care",
    ],
  },
  {
    slug: "midnight-bob",
    name: "Midnight Bob",
    tagline: "Architectural · blunt · uncompromising",
    category: "bobs",
    collection: "couture-edit",
    shade: "blacky-by-nature",
    price: 1240,
    priceNgn: 2050000,
    images: [bob, models.url],
    lengths: ['10"', '12"', '14"'],
    lace: ["HD Lace", "Full Lace"],
    headSizes: ALL_SIZES,
    description:
      "The bob, sculpted. A sharp, blunt silhouette finished in our Lagos studio. Designed to fall like silk and hold its shape for seasons.",
    details: [
      "Raw single-donor Southeast Asian hair",
      "Hand-knotted full lace · invisible parting",
      "Custom-coloured to your skin tone",
      "Steam-set finish",
    ],
  },
  {
    slug: "sun-curls",
    name: "Sun-Drenched Curls",
    tagline: "Volume that catches light",
    category: "curls",
    collection: "signature",
    shade: "brown-jolie",
    price: 980,
    priceNgn: 1620000,
    images: [curls, models.url],
    lengths: ['18"', '22"', '26"', '30"'],
    lace: ["HD Lace", "13x6"],
    headSizes: ALL_SIZES,
    description:
      "Sculptural, weightless curls. Defined coils with the softness of natural texture — finished to drink in golden hour light.",
    details: [
      "Raw curly hair · steam-defined pattern",
      "Hand-tied 13x6 frontal",
      "Pre-bleached, pre-plucked",
      "Pattern returns after every wash",
    ],
  },
  {
    slug: "ruby-straight",
    name: "Ruby Bone-Straight",
    tagline: "Mirror-finish to the waist",
    category: "straight",
    collection: "couture-edit",
    shade: "plum-cherry",
    price: 1180,
    priceNgn: 1950000,
    images: [straight, model2.url],
    lengths: ['22"', '26"', '30"', '34"'],
    lace: ["HD Lace", "13x6"],
    headSizes: ALL_SIZES,
    description:
      "The cleanest straight on the market. Bone-flat, water-clear shine, never a frizz. The kind of hair that ends a room conversation.",
    details: [
      "Raw, chemical-free virgin hair",
      "Hand-knotted HD lace",
      "Mirror-finished by our master stylist",
      "Heat-tolerant to 220°C",
    ],
  },
  {
    slug: "ivory-pixie",
    name: "Ivory Cropped Pixie",
    tagline: "Boy-cut energy, couture hands",
    category: "pixies",
    collection: "essentials",
    shade: "blonde-mary",
    price: 760,
    priceNgn: 1260000,
    images: [pixie, model2.url],
    lengths: ['4"', '6"'],
    lace: ["HD Lace"],
    headSizes: ["S", "M", "L"],
    description:
      "A confident cropped pixie for the woman who walks first. Razor-cut nape, soft-pushed crown, hairline that vanishes.",
    details: ["Single-donor virgin hair", "HD lace · 100% hand-tied", "Glueless wear", "1-year guarantee"],
  },
  {
    slug: "cocoa-bob",
    name: "Cocoa French Bob",
    tagline: "Parisian, with a Lagos accent",
    category: "bobs",
    collection: "signature",
    shade: "brown-jolie",
    price: 1080,
    priceNgn: 1790000,
    images: [bob, models.url],
    lengths: ['8"', '10"', '12"'],
    lace: ["HD Lace"],
    headSizes: ALL_SIZES,
    description: "A jaw-grazing French bob with a soft fringe option. Light, lived-in, unmistakably elegant.",
    details: ["Raw virgin hair", "Hand-tied HD lace", "Customisable fringe", "Steam-set"],
  },
];

export function getProduct(slug: string) {
  return PRODUCTS.find((p) => p.slug === slug);
}

export function getByCategory(cat: string) {
  return PRODUCTS.filter((p) => p.category === cat);
}

export function getByShade(shade: string) {
  return PRODUCTS.filter((p) => p.shade === shade);
}

export function getByCollection(slug: CollectionSlug) {
  return PRODUCTS.filter((p) => p.collection === slug);
}

/** Related products: same collection first (excluding current), then category, then anything. */
export function getRelated(product: Product, limit = 3): Product[] {
  const sameCollection = PRODUCTS.filter((p) => p.slug !== product.slug && p.collection === product.collection);
  const sameCategory   = PRODUCTS.filter((p) => p.slug !== product.slug && p.category === product.category && p.collection !== product.collection);
  const rest           = PRODUCTS.filter((p) => p.slug !== product.slug && p.category !== product.category && p.collection !== product.collection);
  return [...sameCollection, ...sameCategory, ...rest].slice(0, limit);
}
