/**
 * @pixie/landing-kit — the single source of truth for the brand "no active
 * sale" landing page. Consumed by BOTH the admin Landing Studio (apps/admin,
 * Vite) and the public sales site (apps/landing, Next.js) so the studio
 * preview and the live page render from one codebase.
 *
 * Apps import this via the "@landing-kit" path alias (configured in each
 * app's bundler + tsconfig). Internal modules use relative imports and third-
 * party deps (react, framer-motion, three, lucide-react) resolve from the
 * consuming app's own node_modules.
 */

export * from "./config";
export { LandingPreview, type LandingSubmit } from "./LandingPreview";
export { AtelierRevealPreview } from "./AtelierRevealPreview";
export { AtelierStage } from "./AtelierStage";
// Retained for back-compat with existing app-level shims; the reveal now uses
// AtelierStage (the faithful logo-plane scene) rather than these variants.
export { ThreeDLogoReveal } from "./ThreeDLogoReveal";
export { ThreeDTextReveal } from "./ThreeDTextReveal";
// Atelier sale-state pieces — shared so the admin campaign preview renders the
// exact same "before/coming-soon" page as the live sales site (no drift).
export { IntroOverlay } from "./IntroOverlay";
export { BeforeHero } from "./BeforeHero";
export { BeforeState } from "./BeforeState";
// Payload contract (campaign landing shape) for typed consumers.
export type {
  LandingState,
  LandingPayload,
  LandingProduct,
  LandingBundle,
  LandingBlock,
  BrandPublic,
} from "./types";
