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
    { label: "Shop", url: "/shop" },
    { label: "Bundles", url: "/bundles" },
    { label: "Services", url: "/services" },
    { label: "Maison", url: "/about" },
    { label: "Journal", url: "/journal" },
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

const POLICY_TITLES = {
  cancellation: "Cancellation Policy",
  returns: "Returns & Refunds",
  shipping: "Shipping Policy",
  privacy: "Privacy Policy",
  terms: "Terms of Service",
};

// Every storefront page as an editable Studio record. The `slots` keys match the
// storefront's per-page defaults (usePageSlots / withSlots), so editing them in
// Studio changes the live page. Catalogue data (products/services/bundles) still
// comes from the Hub — these slots are the surrounding copy/imagery.
function pagesFor(brand) {
  const name = brand === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  const pages = [
    {
      page_key: "home", template_key: "maison_home_v1", url_path: "/", og_image_url: IMG.hero,
      meta_title: `${name} — Luxury Natural Hair, Crafted in Lagos`,
      meta_description: `${name}: a Lagos maison crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury — shipped worldwide.`,
      slots: HOME_SLOTS,
    },
    {
      page_key: "shop", template_key: "catalogue_v1", url_path: "/shop", og_image_url: IMG.hero,
      meta_title: `Shop the Catalogue — ${name}`,
      meta_description: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched.",
      slots: { eyebrow: "The Catalogue", heading: "Shop the ", headingAccent: "maison", headingAfter: ".", body: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched." },
    },
    {
      page_key: "about", template_key: "maison_about_v1", url_path: "/about", og_image_url: IMG.models,
      meta_title: `The Maison — Our Story · ${name}`,
      meta_description: "Inside the Lagos atelier crafting hand-finished pixies, bobs and curls for women of colour worldwide.",
      slots: { eyebrow: "Est. Lagos · 2021", heading: "The hair we always wished we could ", headingAccent: "buy", headingAfter: ".", imageUrl: IMG.models },
    },
    {
      page_key: "services", template_key: "services_v1", url_path: "/services", og_image_url: IMG.hero,
      meta_title: `Services & Bookings — ${name}`,
      meta_description: "Installs, in-home styling sessions and virtual consults with a senior stylist.",
      slots: { eyebrow: "Services · Prestations", heading: "Book with the ", headingAccent: "maison", headingAfter: ".", body: "Installs, in-home styling sessions and virtual consults — each booked with a senior Faitlyn stylist." },
    },
    {
      page_key: "bundles", template_key: "bundles_v1", url_path: "/bundles", og_image_url: IMG.hero,
      meta_title: `Bundles — Better Together · ${name}`,
      meta_description: "Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save.",
      slots: { eyebrow: "Bundles · Ensembles", heading: "Better ", headingAccent: "together", headingAfter: ".", body: "Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save." },
    },
    {
      page_key: "journal", template_key: "journal_v1", url_path: "/journal", og_image_url: IMG.atelier,
      meta_title: `Journal — Notes from the Atelier · ${name}`,
      meta_description: "Notes, care guides and edits from the Lagos atelier.",
      slots: { eyebrow: "Journal", heading: "Notes from the ", headingAccent: "atelier", headingAfter: "." },
    },
    {
      page_key: "contact", template_key: "contact_v1", url_path: "/contact", og_image_url: IMG.hero,
      meta_title: `Contact — ${name}`,
      meta_description: "Reach the Lagos studio for sizing, orders and aftercare.",
      slots: { eyebrow: "Concierge", heading: "Let's talk ", headingAccent: "hair", headingAfter: ".", body: "Sizing, shade-matching, bulk & trade orders, aftercare — our Lagos studio answers every message personally. ", bodyAccent: "Fait avec soin.", email: "hello@faitlynhair.com", whatsapp: "2348061987874", studio: "10B Emma Abimbola Cole Street, Lekki Phase 1, Lagos", hours: "Mon – Sat · 9am – 6pm WAT" },
    },
  ];
  for (const [slug, title] of Object.entries(POLICY_TITLES)) {
    pages.push({
      page_key: `policy-${slug}`, template_key: "policy_v1", url_path: `/policies/${slug}`, og_image_url: null,
      meta_title: `${title} — ${name}`,
      meta_description: `${title} for ${name}.`,
      slots: { title },
    });
  }
  return pages;
}

// Studio-managed popups (newsletter "The Letter"). Content keys mirror what the
// storefront modal reads; seeded only where the table exists.
const POPUPS = [
  {
    popup_key: "newsletter",
    trigger_type: "time_delay",
    trigger_value: 25,
    audience: "all",
    content: {
      eyebrow: "The Letter",
      heading: "One curated note. Once a month.",
      bullets: ["Early access to limited drops", "Hair education from the Lagos atelier", "Founder picks, no spam, ever"],
      cta_label: "Join the list",
      placeholder: "your@email.com",
      image_url: IMG.model2,
    },
    display_rules: { frequency: "session" },
    display_order: 0,
  },
];

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

  const pages = pagesFor(brand);
  for (const page of pages) {
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
  }

  process.stdout.write(`  seeded ${brand}: theme + nav + ${pages.length} pages\n`);
}

// Popups live in a NEWER table (may be absent, or its columns may differ) — keep
// it best-effort in its own transaction so it can NEVER roll back the pages.
async function seedPopupsFor(client, brand) {
  if (!(await tableExists(client, "storefront_popups"))) {
    process.stdout.write(`  (storefront_popups absent — popups skipped for ${brand})\n`);
    return;
  }
  for (const p of POPUPS) {
    await client.query(
      `DELETE FROM shared.storefront_popups
        WHERE business = $1 AND popup_key = $2 AND status = 'published'`,
      [brand, p.popup_key],
    );
    await client.query(
      `INSERT INTO shared.storefront_popups
         (business, status, popup_key, trigger_type, trigger_value, audience,
          content, display_rules, display_order)
       VALUES ($1, 'published', $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [brand, p.popup_key, p.trigger_type, p.trigger_value, p.audience, JSON.stringify(p.content), JSON.stringify(p.display_rules), p.display_order],
    );
  }
  process.stdout.write(`  seeded ${brand}: ${POPUPS.length} popup(s)\n`);
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
    process.stdout.write("Seeding storefront studio config...\n");

    // Section templates — best-effort, isolated.
    try {
      await client.query("BEGIN");
      await seedSectionTemplates(client);
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("  section templates skipped:", e.message);
    }

    // Each brand's core (theme/nav/pages) commits independently; popups are a
    // separate best-effort txn so a popups schema mismatch can't wipe the pages.
    for (const brand of BRANDS) {
      try {
        await client.query("BEGIN");
        await seedBrand(client, brand);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`  ${brand} core seed FAILED:`, e.message);
      }
      try {
        await client.query("BEGIN");
        await seedPopupsFor(client, brand);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        console.error(`  ${brand} popups skipped:`, e.message);
      }
    }

    // Verify — print what actually landed so you can confirm at a glance.
    const { rows } = await client.query(
      `SELECT business, count(*)::int AS n
         FROM shared.storefront_pages
        WHERE status = 'published'
        GROUP BY business ORDER BY business`,
    );
    process.stdout.write("Published pages now in DB:\n");
    if (!rows.length)
      process.stdout.write("  (none — see the errors above)\n");
    for (const r of rows)
      process.stdout.write(`  ${r.business}: ${r.n} pages\n`);
    process.stdout.write("Done.\n");
  } catch (err) {
    console.error("Seed failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
