# @pixie/landing-kit

**Single source of truth** for the brand-level "no active sale" landing page —
the design authored in the **Landing Studio** (`apps/admin`) and served live on
each brand's **sales subdomain** (`apps/landing`).

Before this package existed, the renderer was copied into both apps and the two
copies drifted: the studio preview showed the upgraded "Atelier" design while
the live page rendered an older, plainer fork (different form, different CTA,
and the 3D reveal fell back to plain text). That broke WYSIWYG. **Do not fork
these components back into an app.** Edit them here; both apps pick up the change.

## What's in here

| File | Responsibility |
| --- | --- |
| `config.ts` | `LandingConfig` types, brand `defaultConfig()`, `withDefaults()` deep-merge, `hexToTriplet()`. Pure TS — safe in a Server Component. |
| `LandingPreview.tsx` | The page renderer (hero, invitation form, gallery, pillars, footer). Does **not** render the reveal — the host composes it. |
| `AtelierRevealPreview.tsx` | The cinematic "velvet drapes" intro overlay. `absolute inset-0`; the host provides a positioned full-bleed parent. |
| `ThreeDLogoReveal.tsx` / `ThreeDTextReveal.tsx` | Three.js brand reveals, lazy-loaded by the reveal overlay. |

## How the apps consume it

Both apps map the `@landing-kit` alias to this folder and compile it as source
(no build step). Third-party deps (`react`, `framer-motion`, `three`,
`@react-three/*`, `lucide-react`) resolve from the **consuming app's**
`node_modules`, so there's a single React instance per app.

- **apps/admin (Vite):** alias in `vite.config.ts` + `tsconfig.json`. The studio
  files re-export from here (`@/lib/landing-studio` re-exports the config layer;
  `LandingPreview`/`AtelierRevealPreview` are thin shims).
- **apps/landing (Next.js):** alias in `tsconfig.json`, `experimental.externalDir`
  + a webpack `resolve.modules` entry in `next.config.mjs` so the out-of-root
  source resolves the app's deps. `components/*` are thin shims; `PublicLanding`
  composes `LandingPreview` + `AtelierRevealPreview`.

## WYSIWYG contract

The studio and the public page must both run the published/draft config through
`withDefaults(brandKey, cfg)` before rendering, and must compose the renderer +
reveal the same way (renderer in a `fixed/absolute inset-0` parent, reveal as an
overlay sibling). Keeping that identical is what guarantees the live page equals
the preview.
