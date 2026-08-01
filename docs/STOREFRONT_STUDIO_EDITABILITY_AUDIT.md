# Storefront Studio — Editability Audit

_Audit of the customer-facing Storefront Website (`apps/storefront`) against what
can actually be edited in Storefront Studio (`apps/admin` → Storefront Studio)._

This documents **what is editable, where you edit it, and what is still
hardcoded** — page by page and component by component. It also records the fixes
made in this change set.

---

## How storefront content flows

```
Studio → Pages (slots JSON per page_key)
   └─ published → GET /api/public/storefront/site
        └─ storefront usePageSlots("<page_key>") → withSlots(defaults, slots) → render
```

- Every storefront page reads its editable copy/images from **`slots`** keyed by a
  `page_key`, merged over baked-in defaults.
- Studio → **Pages** edits those slots. Studio → **Navigation** edits header +
  footer + socials. Studio → **Content** edits FAQs / guides / journal posts /
  policies. Studio → **Branding / Theme / Toolbar / Popups** edit the chrome.

### The gap this audit fixes

Previously the **Pages tab listed only the `storefront_pages` rows that existed in
the database**, and the editor only rendered the slot keys that happened to be
saved on that row. Consequences:

1. A page the seed never inserted was **invisible and un-editable** even though
   the storefront reads its slots — e.g. **`shade_finder`, `shades`,
   `collections`, `bundle_detail`** were missing from the Pages list entirely.
2. A page seeded with only some fields exposed **only that subset** — e.g.
   `about` was seeded with just its hero copy, so the **editorial / press /
   founder** blocks it actually renders had **no field in the UI**.

Fix: a canonical **page catalog**
(`apps/admin/src/pages/storefront-studio/page-catalog.ts`) is now the source the
Pages tab lists from. Every storefront content page appears with its **full**
default field set, merged over whatever is saved — so every field always has a
control, even before a DB row exists.

---

## Where do I edit the Shade Finder? (and the AI)

**The page copy:** Studio → **Pages → “Shade Finder (Praxis AI page)”**. Every
line the page shows is a field there now — the heading/subheading, the welcome
message, the tap-to-start suggestion chips, the “Analyse” / consent / privacy
copy, the thinking-stage lines, the quota label, and the end/expired/error
messages. (Route: `/shade-finder`, `page_key: shade_finder`.)

**The AI’s actual answers / knowledge** are **not** page copy and are **not**
edited here. Praxis composes replies from the AI layer + the RAG knowledge base:

- What Praxis knows about styles/care/policies → Studio → **Content** (FAQs,
  guides, journal, policies) and **AI Control → Knowledge & Training**
  (`/ai-control/training`).
- Shade matching pulls from the live **shade catalogue** (Catalogue module).

So: **wording of the Shade Finder screen → Pages → Shade Finder.** **What Praxis
says back → Content + AI Control.**

---

## Page-by-page status

Legend: ✅ editable in Studio · ⚠️ partially / indirectly editable · ❌ hardcoded.

### Content pages — all now listed in Studio → Pages with full fields ✅

| Page | Route | `page_key` | Notes |
|---|---|---|---|
| Home | `/` | `home` | Full sections: hero (+ looping video & bg image), marquee, bundles/shades/signature heads, why-choose pillars, editorial, press, testimonials, gallery (+ IG profile), founder. |
| Shop | `/shop` | `shop` | Eyebrow/heading/body. Products come from Catalogue. |
| Shades | `/shades` | `shades` | **Newly listed.** heading/body + shade-finder invite copy + empty state. |
| Collections | `/collections` | `collections` | **Newly listed.** heading/body + empty state. |
| Bundles | `/bundles` | `bundles` | Eyebrow/heading/body. |
| Bundle detail | `/bundles/:slug` | `bundle_detail` | **Newly listed.** Shared per-bundle copy (eyebrow, “What’s included”, CTA + toasts). |
| Services | `/services` | `services` | Eyebrow/heading/body. |
| About | `/about` | `about` | **Now exposes editorial + press + founder groups** (were hidden). |
| Journal | `/journal` | `journal` | Listing banner. Articles are written in Studio → Content. |
| Contact | `/contact` | `contact` | Eyebrow/heading/body + email/whatsapp/studio/hours. |
| Shade Finder | `/shade-finder` | `shade_finder` | **Newly listed.** See section above. |
| Policies ×5 | `/policies/:slug` | `policy-*` | Page title as a slot; body written in Content → Policies. |

### Navigation & chrome

| Surface | Status | Where / gap |
|---|---|---|
| Header menu (desktop) | ✅ **Fixed** | Studio → Navigation. Now honours the published nav (was ignored unless items had children — which the editor couldn’t create). |
| Mobile ☰ menu | ✅ **Fixed** | Same nav drives it. Dropdown **children** are now editable; **Home** is now present. |
| Header/mobile dropdowns | ✅ **New** | Navigation editor now supports nested “Dropdown links”. |
| Footer columns / links | ✅ **Fixed** | Studio → Navigation. Edited links now use `url` (was written as `href`, which the storefront ignored → dead links). |
| Socials | ✅ | Studio → Navigation. |
| Logo / favicon / share card | ✅ | Studio → Branding. |
| Theme (colours/fonts) | ✅ | Studio → Theme. |
| Floating toolbar / concierge / WhatsApp / help | ✅ | Studio → Toolbar. |
| Popups (newsletter etc.) | ✅ | Studio → Popups. |
| Promo bar (scrolling strip) | ✅ **New** | Studio → Pages → **Site chrome** → Promo bar. Add/edit/remove offers (+ optional emphasis & link). |
| Footer blurb & signature | ✅ **New** | Studio → Pages → **Site chrome** → Footer. |
| Mobile ☰ feature card + buttons | ✅ **New** | Studio → Pages → **Site chrome** → Mobile menu (image, eyebrow, title, CTA, link, concierge labels, signature). |

---

## Still hardcoded (known remaining gaps)

These are **not yet editable** and are the honest remaining backlog.

### Site chrome copy
- **`site-assets.ts` `SITE_IMAGES`** — local placeholder stills used as fallbacks
  until a real image is uploaded into the matching slot. (Not user copy; these
  are just the “nothing 404s” defaults.)

### Functional / transactional routes — now editable ✅ (PR #605)
Every transactional route now reads its microcopy (button labels, form
placeholders, headings, toasts, validation messages) from `usePageSlots` +
`withSlots`, is registered in `page-catalog.ts`, and appears in Studio → Pages:

| Page | `page_key` |
|---|---|
| Cart | `cart` |
| Checkout | `checkout` |
| Order confirmation | `checkout_thank_you` |
| Sign in / register | `auth` |
| Account | `account` |
| Product detail | `product_detail` |
| Service detail (booking) | `service_detail` |
| Shop category | `shop_category` |
| Collection detail | `collection_detail` |
| Shade detail | `shade_detail` |
| Journal article chrome | `journal_article` |
| Order tracking link | `track_order` |
| Care hub (install link) | `install_hub` |
| Delivery confirmation (agent) | `deliver_confirm` |
| Pay-by-link checkout | `order_link` |

> Pattern for any future page: add a `usePageSlots("<key>")` + `withSlots(...)`
> read in the route, a catalog entry in `page-catalog.ts`, and a seed row in
> `scripts/seed-storefront.js`.

---

## Changes made in this set

1. **Navigation is genuinely editable end-to-end.**
   - `SiteHeader` now uses the published Studio nav whenever it has items (was
     ignored unless an item had `children`), for both desktop and the mobile ☰.
   - Studio Navigation editor gained **nested dropdown (children)** editing.
   - Standardised link target on **`url`** (editor was writing `href`, which the
     storefront/footer never read → edited links broke). Storefront normalises
     legacy `href` on load so old drafts don’t break.
   - **Home** now always appears in the mobile drawer (skipped only if the nav
     already defines its own `/` link, to avoid duplicates).
   - Seed nav updated to the grouped structure (Shop ▾ / Services / Maison ▾) so
     a fresh seed carries the dropdowns.
2. **Every content page is listed and fully editable** via the new page catalog +
   `deepMergeSlots`, independent of DB seed state. `shade_finder`, `shades`,
   `collections`, `bundle_detail` now appear; `about` exposes its editorial/press/
   founder groups.
3. **Site-wide chrome is now editable** via a synthetic `site_chrome` page
   (`useSiteChrome()` in `site-config.tsx`): the promo bar offers, the footer
   blurb/signature, and the mobile drawer’s feature card + concierge labels.
   `PromoBar`, `SiteFooter` and the mobile drawer now read it (defaults
   preserved). `SmartLink` gained `onClick` for the drawer.
4. **Seed** (`scripts/seed-storefront.js`) adds `shades`, `collections`,
   `bundle_detail` and `site_chrome` rows plus the grouped nav.

### To apply on an existing install
Re-run `npm run db:seed` (or just re-publish Navigation in Studio) to pick up the
grouped nav defaults. The catalog fix needs no seed — the pages appear
immediately; opening one and pressing **Publish** writes its first row.
