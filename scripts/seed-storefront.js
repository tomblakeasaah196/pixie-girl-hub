#!/usr/bin/env node
/**
 * Seed published Storefront Studio config (Storefront Implementation Guide S10).
 *
 * For each brand it publishes:
 *   - storefront_themes      (CSS-variable tokens the website injects at SSR)
 *   - storefront_navigation  (header items, footer columns, socials)
 *   - storefront_pages       (a published 'home' page with hero + product_grid)
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

// Per-brand published theme tokens. Faitlyn keeps the Aura dark palette; Pixie
// Girl gets a distinct variant. Both are fully editable in Studio afterwards.
const THEMES = {
  faitlynhair: {
    "--color-primary": "oklch(0.82 0.045 60)",
    "--color-accent": "oklch(0.71 0.06 60)",
    "--font-heading": "\"Work Sans Variable\", system-ui, sans-serif",
    "--font-body": "\"Work Sans Variable\", system-ui, sans-serif",
    "--radius": "0.25rem",
    "--logo-url": "",
    "--favicon-url": "",
    "--og-image": "",
  },
  pixiegirl: {
    "--color-primary": "oklch(0.62 0.13 350)",
    "--color-accent": "oklch(0.72 0.12 350)",
    "--font-heading": "\"Work Sans Variable\", system-ui, sans-serif",
    "--font-body": "\"Work Sans Variable\", system-ui, sans-serif",
    "--radius": "0.5rem",
    "--logo-url": "",
    "--favicon-url": "",
    "--og-image": "",
  },
};

const NAV = {
  header_items: [
    { label: "Shop", href: "/shop" },
    { label: "Shades", href: "/shades" },
    { label: "Bundles", href: "/bundles" },
  ],
  footer_columns: [
    {
      title: "Shop",
      links: [
        { label: "All", href: "/shop" },
        { label: "Shades", href: "/shades" },
        { label: "Bundles", href: "/bundles" },
      ],
    },
    {
      title: "Help",
      links: [
        { label: "Contact", href: "/contact" },
        { label: "Returns", href: "/policies/returns" },
        { label: "Shipping", href: "/policies/shipping" },
      ],
    },
  ],
  socials: { instagram: "", tiktok: "" },
};

function homePage(brand) {
  const name = brand === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  return {
    page_key: "home",
    template_key: "home_hero_v1",
    url_path: "/",
    meta_title: `${name} - Luxury wigs`,
    meta_description: `Hand-finished, shade-matched wigs from ${name}, shipped worldwide.`,
    og_image_url: null,
    slots: {
      sections: [
        {
          type: "hero",
          subheading: name,
          heading: "Luxury wigs, deliberately yours.",
          body: "Hand-finished styles, shade-matched and shipped worldwide.",
          cta_label: "Shop all",
          cta_href: "/shop",
        },
        { type: "product_grid", heading: "New in" },
      ],
    },
  };
}

const SECTION_TEMPLATES = [
  {
    template_key: "hero_split_v1",
    category: "hero",
    display_name: "Hero (split)",
    description: "Headline + subheading + CTA over a feature image.",
    default_slots: { type: "hero", heading: "", subheading: "", cta_label: "Shop", cta_href: "/shop" },
    display_order: 0,
  },
  {
    template_key: "product_grid_v1",
    category: "grid",
    display_name: "Product grid",
    description: "A responsive grid of products.",
    default_slots: { type: "product_grid", heading: "Featured" },
    display_order: 1,
  },
  {
    template_key: "editorial_v1",
    category: "editorial",
    display_name: "Editorial split",
    description: "Image + copy block with an optional link.",
    default_slots: { type: "editorial", heading: "", body: "" },
    display_order: 2,
  },
  {
    template_key: "banner_v1",
    category: "cta",
    display_name: "Announcement banner",
    description: "A thin promo banner strip.",
    default_slots: { type: "banner", text: "" },
    display_order: 3,
  },
];

async function seedBrand(client, brand) {
  // Theme (one published per brand).
  await client.query(
    `DELETE FROM shared.storefront_themes WHERE business = $1 AND status = 'published'`,
    [brand],
  );
  await client.query(
    `INSERT INTO shared.storefront_themes (business, status, tokens)
     VALUES ($1, 'published', $2)`,
    [brand, JSON.stringify(THEMES[brand] || THEMES.pixiegirl)],
  );

  // Navigation (one published per brand).
  await client.query(
    `DELETE FROM shared.storefront_navigation WHERE business = $1 AND status = 'published'`,
    [brand],
  );
  await client.query(
    `INSERT INTO shared.storefront_navigation
       (business, status, header_items, footer_columns, socials)
     VALUES ($1, 'published', $2, $3, $4)`,
    [
      brand,
      JSON.stringify(NAV.header_items),
      JSON.stringify(NAV.footer_columns),
      JSON.stringify(NAV.socials),
    ],
  );

  // Home page (one published per (brand, page_key)).
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
    [
      brand,
      page.page_key,
      page.template_key,
      page.url_path,
      page.meta_title,
      page.meta_description,
      page.og_image_url,
      JSON.stringify(page.slots),
    ],
  );

  process.stdout.write(`  seeded ${brand} (theme + nav + home)\n`);
}

async function seedSectionTemplates(client) {
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
