/**
 * Faitlyn maison imagery.
 *
 * Real, self-hosted stills live in `apps/storefront/public/maison/` (copied from
 * the reference build) and are served at `/maison/*` — no third-party CDN.
 *
 * The full-bleed model shots (hero, editorial models) and the logo wordmark are
 * NOT in the repo — they ship via Studio Branding / home-page slot uploads
 * (`theme.tokens.logo_url`, slot `imageUrl`). Until those are uploaded we fall
 * back to a local still so nothing 404s, and the logo renders as a text wordmark
 * (see SiteHeader/SiteFooter/CinematicPreloader).
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

  // Logo wordmark: uploaded via Studio (theme.tokens.logo_url). Empty → the
  // chrome renders a styled text wordmark instead of an <img>.
  logoCream: "",
} as const;
