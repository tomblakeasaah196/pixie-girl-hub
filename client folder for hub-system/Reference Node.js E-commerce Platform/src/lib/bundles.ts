/**
 * Bundles are promotional packages — completely separate from Collections
 * (which are design families like "Signature Editions"). A bundle bundles
 * existing catalog products at a discounted total. The bundle price is the
 * final price; the saving (vs the sum of member prices) is computed on the
 * fly so the customer can SEE what they're saving.
 */

import { PRODUCTS, type Product } from "./products";

export type Bundle = {
  slug: string;
  name: string;
  tagline: string;
  productSlugs: string[];
  /** Final bundle price (already discounted). */
  priceUsd: number;
  priceNgn: number;
  /** Hero image — falls back to first member's image if omitted. */
  image?: string;
};

export const BUNDLES: Bundle[] = [
  {
    slug: "signature-trio",
    name: "The Signature Trio",
    tagline: "Three couture silhouettes — saved.",
    productSlugs: ["signature-pixie", "midnight-bob", "sun-curls"],
    priceUsd: 2643,   // ~15% off 3110
    priceNgn: 4370000,
  },
  {
    slug: "essentials-duo",
    name: "The Essentials Duo",
    tagline: "Everyday luxury, paired.",
    productSlugs: ["ivory-pixie", "cocoa-bob"],
    priceUsd: 1564,   // ~15% off 1840
    priceNgn: 2580000,
  },
];

export function getBundle(slug: string) {
  return BUNDLES.find((b) => b.slug === slug);
}

export function getBundleProducts(b: Bundle): Product[] {
  return b.productSlugs
    .map((s) => PRODUCTS.find((p) => p.slug === s))
    .filter((p): p is Product => Boolean(p));
}

export function getBundlesIncluding(productSlug: string): Bundle[] {
  return BUNDLES.filter((b) => b.productSlugs.includes(productSlug));
}

/** Sum of member USD prices (the implicit "compare-at" price). */
export function bundleCompareAtUsd(b: Bundle): number {
  return getBundleProducts(b).reduce((sum, p) => sum + p.price, 0);
}
export function bundleCompareAtNgn(b: Bundle): number {
  return getBundleProducts(b).reduce((sum, p) => sum + p.priceNgn, 0);
}
export function bundleSavingsUsd(b: Bundle): number {
  return Math.max(0, bundleCompareAtUsd(b) - b.priceUsd);
}
export function bundleSavingsNgn(b: Bundle): number {
  return Math.max(0, bundleCompareAtNgn(b) - b.priceNgn);
}
export function bundleSavingsPct(b: Bundle): number {
  const c = bundleCompareAtUsd(b);
  return c === 0 ? 0 : Math.round(((c - b.priceUsd) / c) * 100);
}
