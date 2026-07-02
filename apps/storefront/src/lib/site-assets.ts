/**
 * Faitlyn maison imagery.
 *
 * Real, self-hosted stills live in `apps/storefront/public/maison/` (copied from
 * the reference build) and are served at `/maison/*` — no third-party CDN.
 *
 * The full-bleed model shots (hero, editorial models) ship via home-page slot
 * uploads (slot `imageUrl`); until uploaded we fall back to a local still so
 * nothing 404s.
 *
 * The LOGO is no longer here — it comes from Storefront Studio → Branding as
 * dark/light theme tokens, resolved in __root and read via `useBranding()`
 * (see BrandLogo / SiteHeader / SiteFooter / CinematicPreloader). Until a logo
 * is uploaded the chrome renders a text wordmark.
 */

const P = "/maison";

export const SITE_IMAGES = {
  // Self-hosted stills (real files in public/maison/).
  editorialAtelier: `${P}/editorial-atelier.jpg`,
  productPixie: `${P}/product-pixie.jpg`,
  productBob: `${P}/product-bob.jpg`,
  productCurls: `${P}/product-curls.jpg`,
  productStraight: `${P}/product-straight.jpg`,

  // Studio-uploaded (backend) — local placeholders until replaced.
  heroModel: `${P}/editorial-atelier.jpg`,
  models: `${P}/product-curls.jpg`,
  model2: `${P}/product-straight.jpg`,
} as const;
