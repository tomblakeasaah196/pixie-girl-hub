/**
 * Moved to @landing-kit — the shared renderer used by BOTH the studio and the
 * public sales site, so the preview and the live page can't drift. This thin
 * re-export keeps the existing local import path ("./LandingPreview") working.
 *
 * Edit the component in packages/landing-kit/LandingPreview.tsx.
 */
export { LandingPreview, type LandingSubmit } from "@landing-kit";
