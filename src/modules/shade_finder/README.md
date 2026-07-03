# Shade Finder — Praxis Shade Match (public)

Upload-a-photo → "here is your shade, and the exact styles that carry it" —
a conversational, AI-guided shade recommendation on the Storefront Website.
Open to **anyone** (no account); each visitor gets **10 photo analyses per
day** (Africa/Lagos midnight reset) with an IP-ceiling backstop and a
separate cap on follow-up chat turns.

## Pipeline (perceive → match → advise)

1. **Perceive** — Gemini Flash (vision) extracts *colour attributes only*
   (skin undertone/depth + hex, hair colour + hex, lighting quality,
   confidence) as schema-forced JSON. Prompt is explicitly calibrated for
   accuracy on deep skin tones.
2. **Match** — deterministic CIELAB ΔE (`colour-distance.js`) ranks the
   brand's **active `styled_shades`** (~7 families) by perceptual distance
   between the perceived hexes and each shade's live colourway swatches
   (`styled_product_colours.hex`).
3. **Advise** — a second Gemini turn writes the conversational reply, with
   `recommended_shade_slug` / `product_slugs` constrained to **closed enums
   of live catalogue slugs** — the model cannot invent shades, styles,
   prices, or availability. Products are hydrated from the DB (same pricing
   LATERAL as the storefront cards) and returned with deeplinks
   (`/shades/:slug`, `/product/:slug`).

## Privacy contract

- Photo is received via multer **memoryStorage**, downscaled in memory
  (sharp → ≤1024px JPEG, EXIF/GPS stripped by re-encode), sent to Gemini as
  **inline bytes**, then falls out of scope. It is never written to disk,
  object storage, Redis, or the DB.
- Session state in Redis holds only derived colour notes + chat text, with
  a 2h TTL; `DELETE /session/:sid` wipes it immediately. The UI surfaces
  this promise (`PRIVACY_NOTICE`).

## Live feel

`shade-finder.events.js` emits `session.stage` (`reading_photo`,
`matching_shades`, `picking_styles`, `thinking`, `done`, `error`) and
`session.reply`; `src/realtime/shade-finder-realtime.js` relays them into
the **public Socket.io namespace** (`/public`, guest-token auth) room
`brand:{brand}:shade_session:{sid}`. The HTTP response carries the full
result too — the socket is progressive enhancement, never a dependency.

## Governance

Feature flag `shade_finder` (migration `000254`) — toggling it off turns
the feature off storefront-wide; the monthly AI budget hard cap also gates
it. Every Gemini call is recorded in `shared.ai_usage_ledger`
(`user_id NULL`, `business` = brand) with token-rate costing.
