# Bundled fonts

These TTFs are bundled so the **bundle collage generator**
(`src/services/collage.service.js`) can typeset its badge with exact, host-
independent vector glyphs via `fontkit` — no system-font / fontconfig
dependency, so the output is deterministic across machines.

They mirror the curated faces the rest of the platform already offers
(`shared.font_catalog` / `packages/landing-kit` `CURATED_FONTS`).

| File | Family / weight | Role |
| --- | --- | --- |
| `cormorant-garamond-600.ttf` | Cormorant Garamond SemiBold | title (default) |
| `marcellus-400.ttf` | Marcellus | title |
| `italiana-400.ttf` | Italiana | title |
| `dm-serif-display-400.ttf` | DM Serif Display | title |
| `montserrat-600.ttf` | Montserrat SemiBold | (reserved) |
| `montserrat-500.ttf` | Montserrat Medium | eyebrow |

All are from Google Fonts and licensed under the **SIL Open Font License
1.1**, which permits redistribution/bundling. To add a face, drop its static
TTF here and register it in `TITLE_FONTS` in the collage service.
