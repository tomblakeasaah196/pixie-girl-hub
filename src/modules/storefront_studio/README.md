# StorefrontStudio module

**Spec:** Storefront Studio (V2.2 §6.28)
**Permission key:** `storefront_studio`

## Backing tables

- `storefront_themes`
- `storefront_pages`
- `storefront_navigation`
- `storefront_revisions`
- `<brand>.storefront_content_posts` (per-brand — the Content CMS)

## Content CMS (FAQ / care guide / journal / policy)

The **Content** tab manages `storefront_content_posts` — the shop's public
words. Unlike theme/nav/pages (one draft + one published row in shared
tables), a content post is a **single per-brand row** with its own `status`
lifecycle, so publish/unpublish just flip `status` (no row duplication, no
revision snapshot).

Published posts do double duty: they render on the storefront (journal,
policy, care pages) **and** feed Praxis's Brand Brain, so a shop grows what
its AI stylist can talk about just by writing here. The public reads and the
Brand Brain both filter `status = 'published'`, so a **draft is never shown
or quoted** — which is what lets Praxis stay honest. The editor derives the
slug, reading time and empty SEO fields (see `content-helpers.js`), so an
operator only types a title and the answer/body.

## Looping hero video ("living image")

`POST /upload-video` takes one raw clip (multipart `file` + `trim_start`,
`trim_end`, `aspect`, `focus`) and returns the storefront loop set the page
slot stores: an HD MP4 loop, an SD loop for poor connections, and a poster
frame. FFmpeg trims to ≤20s, crops to the operator's aspect/focus, then
denoises + sharpens while compressing (see
`src/services/video-clip.service.js`). The Pages editor offers the
trim/crop studio on every hero section (`VideoField`), and the storefront
`Hero` plays the result like a GIF — autoplay, muted, looping, poster-first
so slow networks still paint instantly.

The route accepts up to 200MB, but on a live deploy the proxy in front must
allow that too — a raw `HTTP 413` on upload means nginx/Cloudflare rejected
the body before it reached the app. See `docs/UPLOAD_SIZE_LIMITS.md`.

## Files

| File                   | Purpose                              |
| ---------------------- | ------------------------------------ |
| `studio.routes.js`     | Express router — URL → controller    |
| `studio.controller.js` | HTTP handlers (req/res only)         |
| `studio.service.js`    | Business logic, transactions, events |
| `studio.repo.js`       | Parameterised SQL only               |
| `studio.validator.js`  | Zod input schemas                    |
| `studio.events.js`     | Domain events for realtime + AI      |
| `content-helpers.js`   | Pure slug / reading-time / SEO derivation (unit-tested) |

## TODOs

- [ ] Implement repo create/update with real columns
- [ ] Implement validator schemas with actual field definitions
- [ ] Add module-specific endpoints to routes (state transitions, sub-resources)
- [ ] Wire events to Socket.io rooms (see `src/realtime/rooms.js`)
- [ ] Add unit tests in `tests/unit/storefront_studio/`
- [ ] Add integration tests in `tests/integration/storefront_studio/`
