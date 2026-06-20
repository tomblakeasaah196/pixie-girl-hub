# Sales Campaigns v2 — Build Plan

Status: **PR 1 shipped (admin builder + backend deltas).** PR 2 (Next.js public landing app on `sales.*` subdomains) follows after deploy.

## Locked decisions (from the Q&A round)

1. **Public landing stack** — Next.js (App Router) app on the per-brand `sales_subdomain` (dynamic, read from `shared.business_config`). React+Vite stays for the admin.
2. **Motion** — `framer-motion` (core), `lottie-react` (micro-icons), measured `@react-three/fiber` (one 2.5D centrepiece per state, desktop-only with CSS fallback). No GSAP.
3. **Sales subdomain** — `sales.pixiegirlglobal.com` + Faitlyn (dynamic — CEO types the host in Business Setup → Public Identity; password-gated change).
4. **Bundles** — Catalogue-first with one-off escape hatch. New `{brand}.product_bundles` entity, attached to campaigns via `sales_campaign_bundles`.
5. **Pricing** — Goal-seek margin + charm rounding + quantity-tier ladder (fixed ₦) + Temu-style escalating cart upsells + preorder discount-loss % per bundle (default 70%). Hard floor enforcement at every layer.
6. **Preorder** — Per-campaign per-bundle toggle (default OFF). When on, sold-out bundles flip to "Pre-order · ships in N weeks" at the preorder price.
7. **AI** — Praxis drafts copy + layout + discount maths only. **No image generation in v1.** Every suggestion is `pending_acceptance` until CEO clicks Accept. Voice profile per brand in `business_config.praxis_voice_profile` with hard rails (no banned words, no fabricated reviews).
8. **"X people viewing"** — `smart` policy default (auto-hide below floor, default 20). No synthetic figures. CEO can flip per campaign.
9. **VIP rewards** — Top-N spenders (configurable, default 10) auto-tagged `campaign_vip`. Anyone above the lifetime-spend threshold → `Platinum VIP`. Auto-generated "Send VIP gift" task assigned to the CEO with Praxis-suggested gift category. Email + Instagram DM thank-you on dispatch. WhatsApp reserved for the top 3.
10. **Ambassadors** — Promoted contacts via `shared.contacts.is_ambassador`. Per-campaign attribution via `sales_campaign_ambassadors`.
11. **Help Center** — 10 articles seeded under a new `sales-campaigns` category, mirrored to `ai_knowledge_chunks` so Praxis can answer how-to questions.
12. **Checkout fields** — Inline guest checkout (separate from main storefront orders) with first/last name, email, phone (country code), Instagram handle (optional), Google-Maps address, WhatsApp + marketing opt-in, T&Cs, anti-bot honeypot, gift order toggle. PR 2.
13. **No free shipping** — DHL rates are real. Free-shipping meter slot repurposed for the next-tier ladder.
14. **Storefront pre-sale promotion** — Banner auto-appears days before sale + 'on sale soon' chip on products in the campaign. PR 2.
15. **Calendar & wallet** — iCal + Google Calendar quick-add + Apple Wallet / Google Pay refreshable pass + T-1h reminder to signups. PR 2.
16. **Approver** — Anyone with `sales_campaigns.approve` (broader than CEO-only, per Faith's call).
17. **Multi-currency** — Geo-detect → display NGN/USD/GBP, backend stays NGN truth. Both brands enabled.

## What ships in PR 1 (this PR — admin builder + backend)

### Backend

- `migrations/000220_shared_sales_campaigns_v2.sql` — `business_config.sales_subdomain` + `praxis_voice_profile` + `show_viewer_count_policy` + `viewer_count_floor`; `contacts.is_ambassador` + `ambassador_profile`.
- `migrations/000221_shared_praxis_campaign_actions.sql` — Praxis action-catalogue entries for `draft_copy`, `suggest_layout`, `suggest_discount_math`, `dry_run_pricing`, `analytics_qna`, `daily_briefing`.
- `migrations/000222_shared_help_sales_campaigns.sql` — 10 Help Center articles + RAG mirror.
- `migrations/template/000040_business_campaign_v2.sql.template` — `product_bundles`, `product_bundle_items`, `sales_campaign_bundles`, `sales_campaign_quantity_tiers`, `sales_campaign_cart_upsells`, `sales_campaign_vip_grants`, `sales_campaign_ambassadors`; new columns on `sales_campaigns` + `sales_campaign_products` + `sales_orders` (campaign + ambassador attribution, preorder columns).
- `src/middleware/host-brand-resolver.js` — host → brand via `business_config.sales_subdomain` (cached 60s).
- `src/modules/sales_campaigns/campaigns.pricing.service.js` — goal-seek margin, charm rounding, quantity-tier reconciliation, cart upsell picker, preorder pricing, floor assertion.
- `src/modules/sales_campaigns/campaigns.bundles.{repo,service}.js` — bundle CRUD, campaign attachment, tiers, upsells, ambassadors.
- `src/modules/sales_campaigns/campaigns.praxis.service.js` — Praxis assist (drafts copy / layout / pricing, dry-run, analytics Q&A, daily briefing). Hard rails on banned words + floor.
- `src/modules/sales_campaigns/campaigns.vip.service.js` — top-spender rollup + gift-task workflow + Platinum promotion.
- `src/modules/sales_campaigns/campaigns.v2.controller.js` — HTTP glue for all v2 endpoints.
- `campaigns.routes.js` — registered all v2 endpoints under `/api/v1/sales-campaigns/*`.
- `campaigns.validator.js` — Zod schemas for all v2 payloads.
- `business_setup` repo + validator — surfaces `sales_subdomain` + `praxis_voice_profile` + `show_viewer_count_policy` + `viewer_count_floor`.
- `src/routes/index.js` — `hostBrandResolverMiddleware` wired onto public `/sale/:slug`.

### Frontend (admin)

- `apps/admin/src/lib/campaigns.ts` — TanStack Query hooks for everything (40+ endpoints).
- `apps/admin/src/pages/sales-campaigns/SalesCampaignsListPage.tsx` — hero strip + KPIs + filters + cards + create modal.
- `apps/admin/src/pages/sales-campaigns/CampaignBuilderPage.tsx` — 6-step wizard (Brief / Bundles / Pricing / Landing / Ambassadors / Approval) with drag-reorder block editor (@dnd-kit) + Praxis assist drawer.
- `apps/admin/src/pages/sales-campaigns/CampaignDetailPage.tsx` — Live dashboard + signups + share kit + VIP + Praxis Q&A chat.
- `apps/admin/src/pages/sales-campaigns/CampaignBundlesPage.tsx` — catalogue bundles management.
- `apps/admin/src/pages/BusinessSetupPage.tsx` (IdentityTab) — extended with Public Identity (sales subdomain + Praxis voice + viewer policy).
- `apps/admin/src/router.tsx` — routes registered.
- New admin deps: `framer-motion`, `lottie-react`, `@react-three/fiber`, `@react-three/drei`, `three`.

## What ships in PR 2 (next session — public landing page)

- Next.js 14 (App Router) app at `apps/landing/`, deployed to `sales.pixiegirlglobal.com` + `sales.thefaitlynbrand.com`.
- 3 base states (Before / Live / Ended) + 4 extras (VIP early access, Last-call surge, Sold-out hold, Waitlist-for-next-drop).
- Block renderers for every block in the library (hero, countdown, bundle showcase, tier ladder, lookbook, story, founder quote, why-buy, testimonials, UGC carousel, FAQ, wig care, stylist spotlight, shipping/returns, newsletter capture, VIP signup).
- Inline guest checkout with Paystack/Opay/Nomba/Stripe.
- 2.5D `@react-three/fiber` hero on Live state + countdown ring on Before state (desktop only with CSS fallback).
- PWA manifest + service worker + Wallet pass + iCal + Google Calendar.
- Storefront pre-sale banner (auto-appears days before sale).
- Cart abandonment email recovery (60-min outbound nudge).
- Praxis daily briefing scheduler (8am during live campaign).
- VIP grant scheduler (runs at campaign end automatically).

## Routes Added — Backend

```
GET    /api/v1/sales-campaigns/bundles
POST   /api/v1/sales-campaigns/bundles
GET    /api/v1/sales-campaigns/bundles/:id
PATCH  /api/v1/sales-campaigns/bundles/:id
DELETE /api/v1/sales-campaigns/bundles/:id
POST   /api/v1/sales-campaigns/bundles/:id/items
DELETE /api/v1/sales-campaigns/bundles/:id/items/:itemId
PATCH  /api/v1/sales-campaigns/bundles/:id/reorder

GET    /api/v1/sales-campaigns/ambassadors
POST   /api/v1/sales-campaigns/ambassadors/:contactId/promote
DELETE /api/v1/sales-campaigns/ambassadors/:contactId

GET    /api/v1/sales-campaigns/:id/bundles
POST   /api/v1/sales-campaigns/:id/bundles
DELETE /api/v1/sales-campaigns/:id/bundles/:linkId

GET    /api/v1/sales-campaigns/:id/tiers
POST   /api/v1/sales-campaigns/:id/tiers
DELETE /api/v1/sales-campaigns/:id/tiers/:tierId

GET    /api/v1/sales-campaigns/:id/upsells
POST   /api/v1/sales-campaigns/:id/upsells
DELETE /api/v1/sales-campaigns/:id/upsells/:upsellId

GET    /api/v1/sales-campaigns/:id/ambassadors
POST   /api/v1/sales-campaigns/:id/ambassadors
DELETE /api/v1/sales-campaigns/:id/ambassadors/:linkId

POST   /api/v1/sales-campaigns/:id/praxis/draft-copy
POST   /api/v1/sales-campaigns/:id/praxis/suggest-layout
POST   /api/v1/sales-campaigns/:id/praxis/suggest-pricing
POST   /api/v1/sales-campaigns/:id/praxis/dry-run-pricing
POST   /api/v1/sales-campaigns/:id/praxis/analytics-qna
GET    /api/v1/sales-campaigns/:id/praxis/daily-briefing
POST   /api/v1/sales-campaigns/:id/praxis/accept

GET    /api/v1/sales-campaigns/:id/vip-grants
POST   /api/v1/sales-campaigns/:id/vip-grants
PATCH  /api/v1/sales-campaigns/:id/vip-grants/:grantId
```

## Deploy steps

```bash
# 1. Run new migrations (in order)
psql $DATABASE_URL -f migrations/000220_shared_sales_campaigns_v2.sql
psql $DATABASE_URL -f migrations/000221_shared_praxis_campaign_actions.sql
psql $DATABASE_URL -f migrations/000222_shared_help_sales_campaigns.sql

# 2. Apply brand template additions
npm run db:migrate:template -- 000040

# 3. Install new admin deps (framer-motion / lottie / three.js)
cd apps/admin && npm install

# 4. Restart backend + admin
npm start
```

## Verification

- [ ] Settings → Business Setup → Identity surfaces the sales subdomain + Praxis voice + viewer policy
- [ ] Sales Campaigns list renders with hero strip + KPI tiles
- [ ] Create-campaign modal mints a draft and opens the builder
- [ ] Builder wizard's 6 steps render and persist edits
- [ ] Drag-reorder of blocks works (touch + mouse)
- [ ] Praxis drawer drafts copy + layout (or returns the stub when no AI vendor is configured)
- [ ] Pricing engine refuses any goal-seek + charm result below the floor
- [ ] Campaign detail page shows live KPIs (refreshes every 15s)
- [ ] Ask Praxis on detail page answers analytics questions
- [ ] Catalogue Bundles page CRUDs bundles
