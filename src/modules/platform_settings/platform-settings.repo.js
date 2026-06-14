/**
 * Platform Settings (Layer-A appearance / white-label) — repository.
 *
 * Two tables:
 *   shared.platform_settings  — the singleton row (one per deployment).
 *   shared.font_catalog       — the picker's curated font list.
 *
 * Per-business (Layer-B) branding is read straight off
 * shared.business_config in getPublicBranding() — kept here so the
 * unauthenticated /api/branding can answer in a single round-trip.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (client) => (client ? client.query.bind(client) : query);

// ── platform_settings (singleton) ────────────────────────
async function getPlatformSettings({ client }) {
  const { rows } = await ex(client)(
    `SELECT settings_id, product_name, tagline, company_name,
            logo_dark_url, logo_light_url, favicon_url,
            font_display, font_body, font_mono, font_css_url,
            theme, login_config, updated_at, updated_by
     FROM shared.platform_settings
     ORDER BY updated_at DESC
     LIMIT 1`,
  );
  return rows[0] || null;
}

// Whitelisted columns the PATCH may touch. `theme` is merged with the
// existing JSONB rather than replaced — a partial colour patch must
// not wipe the other tokens.
const SETTINGS_COLS = [
  "product_name",
  "tagline",
  "company_name",
  "logo_dark_url",
  "logo_light_url",
  "favicon_url",
  "font_display",
  "font_body",
  "font_mono",
  "font_css_url",
];

async function updatePlatformSettings({ client, patch, user_id }) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const col of SETTINGS_COLS) {
    if (patch[col] === undefined) continue;
    sets.push(`${col} = $${i++}`);
    params.push(patch[col]);
  }
  if (patch.theme !== undefined) {
    // jsonb || jsonb — top-level keys ('dark', 'light') get replaced
    // wholesale by the patch when present; absent ones stay intact.
    sets.push(`theme = theme || $${i++}::jsonb`);
    params.push(JSON.stringify(patch.theme));
  }
  if (patch.login_config !== undefined) {
    // Same top-level-merge semantics as `theme`: a patch carrying only
    // `hero` replaces hero wholesale and leaves quotes/standards/etc.
    // intact, so the editor can save one section at a time.
    sets.push(`login_config = login_config || $${i++}::jsonb`);
    params.push(JSON.stringify(patch.login_config));
  }
  if (sets.length === 0) return getPlatformSettings({ client });
  sets.push(`updated_at = now()`, `updated_by = $${i++}`);
  params.push(user_id || null);

  await ex(client)(
    `UPDATE shared.platform_settings SET ${sets.join(", ")}`,
    params,
  );
  return getPlatformSettings({ client });
}

// ── font_catalog ─────────────────────────────────────────
async function listFonts({ client, activeOnly = true }) {
  const { rows } = await ex(client)(
    `SELECT font_id, family, css_value, loader_url, category,
            use_hint, is_active, display_order
     FROM shared.font_catalog
     WHERE ($1::BOOLEAN = false OR is_active = true)
     ORDER BY category ASC, display_order ASC, family ASC`,
    [activeOnly],
  );
  return rows;
}

// ── public branding (no auth) ────────────────────────────
// Returns everything the login page + shell need before a token
// exists: platform identity + the list of active businesses with
// their Layer-B accents and logos so the switcher renders correctly.
async function getPublicBranding({ client }) {
  const platform = await getPlatformSettings({ client });
  const { rows: businesses } = await ex(client)(
    `SELECT business_key, display_name, accent_colour, secondary_colour,
            logo_path, logo_alt_path, favicon_path, brand_theme, brand_fonts,
            website
     FROM shared.business_config
     WHERE is_active = true
     ORDER BY display_name ASC`,
  );
  return { platform, businesses };
}

module.exports = {
  getPlatformSettings,
  updatePlatformSettings,
  listFonts,
  getPublicBranding,
};
