#!/usr/bin/env node
/**
 * Seed published Storefront Studio config (Storefront Implementation Guide §10).
 *
 * For each brand it publishes:
 *   - storefront_themes      (tokens: logo_url + optional CSS-var overrides)
 *   - storefront_navigation  (header items, footer columns, socials)
 *   - storefront_pages       (a published 'home' page whose `slots` drive the
 *                             ported maison sections — see apps/storefront
 *                             src/lib/home-content.ts for the field contract)
 * and seeds the global storefront_section_templates library (once).
 *
 * Idempotent: re-running replaces the published rows for each brand and leaves
 * any drafts alone. Safe to run after db:migrate:shared.
 *
 *   node scripts/seed-storefront.js
 */

"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const BRANDS = ["pixiegirl", "faitlynhair"];

// Self-hosted stills served by the storefront from public/maison/ (no CDN).
// Hero/model imagery + logo ship via Studio uploads — placeholders until then.
const IMG = {
  hero: "/maison/editorial-atelier.jpg", // placeholder — replace with a Studio hero upload
  models: "/maison/product-curls.jpg",
  model2: "/maison/product-straight.jpg",
  atelier: "/maison/editorial-atelier.jpg",
  pixie: "/maison/product-pixie.jpg",
  bob: "/maison/product-bob.jpg",
  curls: "/maison/product-curls.jpg",
  straight: "/maison/product-straight.jpg",
};

// Theme tokens. `logo_url` is consumed by the storefront chrome (empty → the
// chrome renders a text wordmark). Colour/font CSS-var keys (starting with `--`)
// would override the baked DARK palette only. Upload a real logo via Studio.
const THEMES = {
  faitlynhair: { logo_url: "" },
  pixiegirl: { logo_url: "" },
};

// Nav (matches the ported SiteHeader/SiteFooter — no "Shades" item).
const NAV = {
  header_items: [
    { label: "Shop", url: "/shop", children: [
      { label: "All catalogue", url: "/shop" },
      { label: "Bundles", url: "/bundles" },
    ] },
    { label: "Services", url: "/services" },
    { label: "Maison", url: "/about", children: [
      { label: "Our story", url: "/about" },
      { label: "Journal", url: "/journal" },
    ] },
  ],
  footer_columns: [
    { title: "Shop", links: [
      { label: "All catalogue", url: "/shop" },
      { label: "Bundles", url: "/bundles" },
      { label: "Pixie Cuts", url: "/shop" },
      { label: "Bob Wigs", url: "/shop" },
      { label: "Curly Collection", url: "/shop" },
      { label: "Limited Drops", url: "/shop" },
    ] },
    { title: "Maison", links: [
      { label: "Our Story", url: "/about" },
      { label: "Journal", url: "/journal" },
      { label: "Services", url: "/services" },
    ] },
    { title: "Care", links: [
      { label: "Contact", url: "/contact" },
      { label: "Email Preferences", url: "/account" },
      { label: "Cancellation Policy", url: "/policies/cancellation" },
    ] },
  ],
  socials: {
    instagram: "https://www.instagram.com/faitlynhair/",
    facebook: "https://web.facebook.com/faitlynhair/",
    twitter: "https://twitter.com/Faitlynhair",
    whatsapp: "https://wa.me/2348061987874",
  },
};

// Home template content. Keys match the storefront HomeContent contract, so the
// ported components render this verbatim (and fall back to the same content when
// absent). Catalogue sections (products/bundles/shades) pull live from the Hub.
const HOME_SLOTS = {
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
    imageUrl: IMG.hero,
  },
  marquee: [
    "Hand-finished in Lagos",
    "Single-donor virgin hair",
    "HD melt lace",
    "Complimentary worldwide shipping",
    "1-year atelier guarantee",
    "Reusable for 18 months+",
  ],
  bundles: {
    eyebrow: "Shop the edit · ensembles",
    heading: "Curated ",
    headingAccent: "bundles",
    headingAfter: ". Better together.",
    linkLabel: "All bundles →",
    linkHref: "/bundles",
  },
  shades: {
    eyebrow: "Shop by shade",
    heading: "Find the tone that ",
    headingAccent: "speaks",
    headingAfter: " to you",
    body: "Explore our shade catalogue. Every tone is hand-mixed in the studio and colour-matched to your skin.",
  },
  signature: { eyebrow: "Signature collection", heading: "The house edit" },
  why_choose: {
    eyebrow: "Why choose",
    heading: "Faitlyn ",
    headingAccent: "Hair",
    body: "Each wig is handcrafted by artisans in our Lagos studio — made with precision, passion, and with women of colour in mind. ",
    bodyAccent: "Fait à la main.",
    pillars: [
      { n: "01", t: "100% Human Hair", d: "Single-donor, cuticle-aligned, ethically sourced. Never blended, never synthetic." },
      { n: "02", t: "Expertly Ventilated & Styled", d: "Each cap is hand-ventilated and finished by master stylists before it leaves the studio." },
      { n: "03", t: "Made For Every Woman", d: "Designed with women of colour in mind — every silhouette, every skin tone, every crown." },
      { n: "04", t: "B2B & B2C, Globally", d: "Stylists, salons, and individual clients in 30+ countries. Trade pricing on request." },
      { n: "05", t: "Worldwide Fast Shipping", d: "Express dispatch from Lagos within 48 hours. Complimentary over $2000 (or $1000 in Nigeria)." },
    ],
  },
  editorial: {
    eyebrow: "The Atelier",
    heading: "Every piece passes through ",
    headingAccent: "eleven pairs",
    headingAfter: " of hands before it reaches yours.",
    body: "From the sourcing of single-donor cuticle-aligned hair, to the hand-tying of every HD lace knot, to the final steam-set on the head of a Lagos master stylist — we refuse a single shortcut. The result is hair that wears like the dress code of the women who set the standard.",
    ctaLabel: "Read the story",
    ctaHref: "/about",
    imageUrl: IMG.atelier,
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
    images: [IMG.pixie, IMG.bob, IMG.curls, IMG.straight, IMG.models, IMG.model2, IMG.hero, IMG.pixie],
  },
  founder: {
    eyebrow: "A note from Faitlyn",
    body: "I started Faitlyn because the hair I wanted didn't exist. So I built it — slowly, by hand, with women who care about the craft as much as I do. Everything you see here is the version of luxury I always wished I could buy.",
    attribution: "— Faitlyn, Founder",
  },
};

function homePage(brand) {
  const name = brand === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  return {
    page_key: "home",
    template_key: "maison_home_v1",
    url_path: "/",
    meta_title: `${name} — Luxury Natural Hair, Crafted in Lagos`,
    meta_description: `${name}: a Lagos maison crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury — shipped worldwide.`,
    og_image_url: IMG.hero,
    slots: HOME_SLOTS,
  };
}

// Optional Studio section-template library (guided page composer). Seeded only
// when the table exists (migration 000243); skipped otherwise.
const SECTION_TEMPLATES = [
  { template_key: "maison_hero_v1", category: "hero", display_name: "Maison hero", description: "Full-bleed hero with eyebrow, couture headline, CTAs.", default_slots: { eyebrow: "", heading: "", headingAccent: "" }, display_order: 0 },
  { template_key: "shade_grid_v1", category: "grid", display_name: "Shop by shade", description: "Shade tiles pulled from the catalogue.", default_slots: { eyebrow: "Shop by shade", heading: "" }, display_order: 1 },
  { template_key: "signature_carousel_v1", category: "grid", display_name: "Signature carousel", description: "Product carousel of the house edit.", default_slots: { eyebrow: "Signature collection", heading: "The house edit" }, display_order: 2 },
  { template_key: "editorial_split_v1", category: "editorial", display_name: "Editorial split", description: "Image + copy atelier block.", default_slots: { eyebrow: "The Atelier", heading: "" }, display_order: 3 },
];

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'shared' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function seedBrand(client, brand) {
  await client.query(
    `DELETE FROM shared.storefront_themes WHERE business = $1 AND status = 'published'`,
    [brand],
  );
  await client.query(
    `INSERT INTO shared.storefront_themes (business, status, tokens)
     VALUES ($1, 'published', $2)`,
    [brand, JSON.stringify(THEMES[brand] || THEMES.pixiegirl)],
  );

  await client.query(
    `DELETE FROM shared.storefront_navigation WHERE business = $1 AND status = 'published'`,
    [brand],
  );
  await client.query(
    `INSERT INTO shared.storefront_navigation
       (business, status, header_items, footer_columns, socials)
     VALUES ($1, 'published', $2, $3, $4)`,
    [brand, JSON.stringify(NAV.header_items), JSON.stringify(NAV.footer_columns), JSON.stringify(NAV.socials)],
  );

  const page = homePage(brand);
  await client.query(
    `DELETE FROM shared.storefront_pages
      WHERE business = $1 AND page_key = $2 AND status = 'published'`,
    [brand, page.page_key],
  );
  await client.query(
    `INSERT INTO shared.storefront_pages
       (business, page_key, template_key, status, url_path, meta_title,
        meta_description, og_image_url, slots)
     VALUES ($1, $2, $3, 'published', $4, $5, $6, $7, $8)`,
    [brand, page.page_key, page.template_key, page.url_path, page.meta_title, page.meta_description, page.og_image_url, JSON.stringify(page.slots)],
  );

  process.stdout.write(`  seeded ${brand} (theme + nav + home)\n`);
}

async function seedSectionTemplates(client) {
  if (!(await tableExists(client, "storefront_section_templates"))) {
    process.stdout.write("  (storefront_section_templates absent — skipped)\n");
    return;
  }
  for (const t of SECTION_TEMPLATES) {
    await client.query(
      `INSERT INTO shared.storefront_section_templates
         (template_key, category, display_name, description, default_slots, display_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (template_key) DO UPDATE
         SET category = EXCLUDED.category,
             display_name = EXCLUDED.display_name,
             description = EXCLUDED.description,
             default_slots = EXCLUDED.default_slots,
             display_order = EXCLUDED.display_order`,
      [t.template_key, t.category, t.display_name, t.description, JSON.stringify(t.default_slots), t.display_order],
    );
  }
  process.stdout.write(`  seeded ${SECTION_TEMPLATES.length} section templates\n`);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    process.stdout.write("Seeding storefront studio config...\n");
    await seedSectionTemplates(client);
    for (const brand of BRANDS) {
      await seedBrand(client, brand);
    }
    await client.query("COMMIT");
    process.stdout.write("Done.\n");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
