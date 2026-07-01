/**
 * Static editorial content for the maison homepage — ported verbatim from the
 * Lovable reference (src/lib/site-content.ts, products.ts, bundles.ts). Demo
 * catalogue used for the marketing blocks; live catalogue is wired via the Hub
 * elsewhere. Editing this file updates the home — no component changes needed.
 */
import { SITE_IMAGES as I } from "./site-assets";

export type Pillar = { n: string; t: string; d: string };

export const WHY_CHOOSE_PILLARS: Pillar[] = [
  { n: "01", t: "100% Human Hair", d: "Single-donor, cuticle-aligned, ethically sourced. Never blended, never synthetic." },
  { n: "02", t: "Expertly Ventilated & Styled", d: "Each cap is hand-ventilated and finished by master stylists before it leaves the studio." },
  { n: "03", t: "Made For Every Woman", d: "Designed with women of colour in mind — every silhouette, every skin tone, every crown." },
  { n: "04", t: "B2B & B2C, Globally", d: "Stylists, salons, and individual clients in 30+ countries. Trade pricing on request." },
  { n: "05", t: "Worldwide Fast Shipping", d: "Express dispatch from Lagos within 48 hours. Complimentary over $2000 (or $1000 in Nigeria)." },
];

export const SHADES = [
  { slug: "blacky-by-nature", name: "Blacky by Nature", swatch: "linear-gradient(135deg, #0a0808 0%, #2a1f1c 100%)", text: "text-cream" },
  { slug: "brown-jolie",      name: "Brown Jolie",      swatch: "linear-gradient(135deg, #3a201a 0%, #6b3a2a 100%)", text: "text-cream" },
  { slug: "plum-cherry",      name: "Plum Cherry",      swatch: "linear-gradient(135deg, #2a0a14 0%, #6b1530 100%)", text: "text-cream" },
  { slug: "blonde-mary",      name: "Blonde Mary",      swatch: "linear-gradient(135deg, #b3895a 0%, #e8c98f 100%)", text: "text-ink" },
  { slug: "khaleesi-blonde",  name: "Khaleesi Blonde",  swatch: "linear-gradient(135deg, #e8d9b8 0%, #f7eed6 100%)", text: "text-ink" },
  { slug: "icy-grey",         name: "Icy Grey",         swatch: "linear-gradient(135deg, #8a8a92 0%, #d4d4dc 100%)", text: "text-ink" },
] as const;

export type Product = {
  slug: string;
  name: string;
  category: "pixies" | "bobs" | "curls" | "straight";
  price: number;
  priceNgn: number;
  images: string[];
};

export const PRODUCTS: Product[] = [
  { slug: "signature-pixie", name: "The Signature Pixie", category: "pixies",   price: 890,  priceNgn: 1470000, images: [I.productPixie, I.model2] },
  { slug: "midnight-bob",    name: "Midnight Bob",        category: "bobs",     price: 1240, priceNgn: 2050000, images: [I.productBob, I.models] },
  { slug: "sun-curls",       name: "Sun-Drenched Curls",  category: "curls",    price: 980,  priceNgn: 1620000, images: [I.productCurls, I.models] },
  { slug: "ruby-straight",   name: "Ruby Bone-Straight",  category: "straight", price: 1180, priceNgn: 1950000, images: [I.productStraight, I.model2] },
  { slug: "ivory-pixie",     name: "Ivory Cropped Pixie", category: "pixies",   price: 760,  priceNgn: 1260000, images: [I.productPixie, I.model2] },
  { slug: "cocoa-bob",       name: "Cocoa French Bob",    category: "bobs",     price: 1080, priceNgn: 1790000, images: [I.productBob, I.models] },
];

export type Bundle = {
  slug: string;
  name: string;
  tagline: string;
  productSlugs: string[];
  priceUsd: number;
  priceNgn: number;
  image?: string;
};

export const BUNDLES: Bundle[] = [
  { slug: "signature-trio", name: "The Signature Trio", tagline: "Three couture silhouettes — saved.", productSlugs: ["signature-pixie", "midnight-bob", "sun-curls"], priceUsd: 2643, priceNgn: 4370000 },
  { slug: "essentials-duo", name: "The Essentials Duo", tagline: "Everyday luxury, paired.",           productSlugs: ["ivory-pixie", "cocoa-bob"],                     priceUsd: 1564, priceNgn: 2580000 },
];

export function getBundleProducts(b: Bundle): Product[] {
  return b.productSlugs
    .map((s) => PRODUCTS.find((p) => p.slug === s))
    .filter((p): p is Product => Boolean(p));
}
export function bundleCompareAtUsd(b: Bundle): number {
  return getBundleProducts(b).reduce((sum, p) => sum + p.price, 0);
}
export function bundleCompareAtNgn(b: Bundle): number {
  return getBundleProducts(b).reduce((sum, p) => sum + p.priceNgn, 0);
}
export function bundleSavingsPct(b: Bundle): number {
  const c = bundleCompareAtUsd(b);
  return c === 0 ? 0 : Math.round(((c - b.priceUsd) / c) * 100);
}
