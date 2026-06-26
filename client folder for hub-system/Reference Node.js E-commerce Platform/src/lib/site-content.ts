/**
 * Editorial content that powers the marketing blocks (Why Choose, Product
 * Artistry default copy, default FAQ, shade swatches). Editing this file
 * updates the site — no component changes required.
 */

export type Pillar = { n: string; t: string; d: string };

export const WHY_CHOOSE_PILLARS: Pillar[] = [
  { n: "01", t: "100% Human Hair", d: "Single-donor, cuticle-aligned, ethically sourced. Never blended, never synthetic." },
  { n: "02", t: "Expertly Ventilated & Styled", d: "Each cap is hand-ventilated and finished by master stylists before it leaves the studio." },
  { n: "03", t: "Made For Every Woman", d: "Designed with women of colour in mind — every silhouette, every skin tone, every crown." },
  { n: "04", t: "B2B & B2C, Globally", d: "Stylists, salons, and individual clients in 30+ countries. Trade pricing on request." },
  { n: "05", t: "Worldwide Fast Shipping", d: "Express dispatch from Lagos within 48 hours. Complimentary over $2000 (or $1000 in Nigeria)." },
];

export type ArtistryContent = {
  eyebrow: string;
  title: string;
  emphasis?: string;
  body: string;
  bullets: string[];
  footnote: string;
};

export const DEFAULT_ARTISTRY: ArtistryContent = {
  eyebrow: "Pixie artistry, done for you",
  title: "Signature wigs created by specialists who understand how a pixie should",
  emphasis: "fit, frame",
  body: "Each piece arrives fully styled and ready to wear. You will never need to “fix” anything — the cut, the melt, and the finish are already done.",
  bullets: [
    "Expertly crafted by pixie specialists with precision finishing",
    "Premium hair sourced from Cambodia & the Philippines",
    "Swiss HD lace for an ultra-natural melt",
    "Styled only — no unstyled option in this collection",
    "Designed to be worn straight out of the box",
    "Hand-ventilated cap, breathable on long wears",
  ],
  footnote: "Best for: women who want a luxury pixie look with zero stress — perfect shape, perfect finish, instantly.",
};

export type FAQItem = { q: string; a: string };
export type FAQContent = { eyebrow: string; title: string; emphasis?: string; items: FAQItem[] };

export const DEFAULT_FAQ: FAQContent = {
  eyebrow: "Frequently asked",
  title: "Mini frontal or",
  emphasis: "full frontal?",
  items: [
    {
      q: "What is a mini frontal pixie wig?",
      a: "A mini frontal pixie wig has a smaller frontal lace area — typically 6×6. Usually placed at the left side, it has sideburns on one side and the natural hairline of a frontal. It's made for those who want a glueless, low-maintenance look that's always ready to wear.",
    },
    {
      q: "What is a full frontal pixie wig?",
      a: "A full frontal pixie wig has a larger frontal lace area — usually 13×4 or 13×6 — covering the entire front from ear to ear. It allows more parting options, including wearing the hair all back.",
    },
    {
      q: "How do I decide which one to buy?",
      a: "If you prefer side parts and rarely wear it all back, a mini frontal is ideal. If you want full flexibility, choose a full frontal. Mini frontals are lower maintenance and slightly more affordable — the difference is small.",
    },
    {
      q: "Will there be a noticeable difference?",
      a: "In photos and from a distance it's very hard to distinguish between a mini and full frontal — they share the same hairline and silhouette. The difference shows mainly in how far back you can part the hair.",
    },
  ],
};

/** Shade swatches used by the homepage and by the /shop?shade= filter. */
export const SHADES = [
  { slug: "blacky-by-nature", name: "Blacky by Nature", swatch: "linear-gradient(135deg, #0a0808 0%, #2a1f1c 100%)", text: "text-cream" },
  { slug: "brown-jolie",      name: "Brown Jolie",      swatch: "linear-gradient(135deg, #3a201a 0%, #6b3a2a 100%)", text: "text-cream" },
  { slug: "plum-cherry",      name: "Plum Cherry",      swatch: "linear-gradient(135deg, #2a0a14 0%, #6b1530 100%)", text: "text-cream" },
  { slug: "blonde-mary",      name: "Blonde Mary",      swatch: "linear-gradient(135deg, #b3895a 0%, #e8c98f 100%)", text: "text-ink" },
  { slug: "khaleesi-blonde",  name: "Khaleesi Blonde",  swatch: "linear-gradient(135deg, #e8d9b8 0%, #f7eed6 100%)", text: "text-ink" },
  { slug: "icy-grey",         name: "Icy Grey",         swatch: "linear-gradient(135deg, #8a8a92 0%, #d4d4dc 100%)", text: "text-ink" },
] as const;

export type ShadeSlug = (typeof SHADES)[number]["slug"];
