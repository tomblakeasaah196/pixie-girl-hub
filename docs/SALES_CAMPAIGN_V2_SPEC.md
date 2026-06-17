# Sales Campaign & Landing Page — V2 Build Spec

> **Owner:** Sales Campaigns module
> **Status:** Awaiting CEO sign-off before code
> **Date:** 2026-06-17
> **Prerequisite:** v1 backend (per `SALES_CAMPAIGN_BUILD_PLAN.md`) is live as of 2026-06-05
> **Branch:** `claude/relaxed-volta-3kvhfm`
> **Use:** Pre-build → spec. Post-build → checklist (tick every `[ ]`).

---

## 0. North-star

Build the surface that lets the CEO ship a sales campaign whose landing page is the **best money-conversion experience the brand has ever launched**. The visitor should feel they've walked into a luxury showroom; the campaign should be ungrouped into bundles she pre-curated, the price math should make sense at a glance, and they should not leave without buying. Praxis assists at every step. Audit + notifications fire on every meaningful change. Storefront and sales landing are crisply separated but cross-promote.

---

## 1. What's Already Live (Use, Don't Rebuild)

Already on `main` as of 2026-06-05 (`docs/SALES_CAMPAIGN_BUILD_PLAN.md` Phases 0-6):

### 1.1 Database (per-brand)
- [x] `{brand}.sales_campaigns` — full status state machine, `landing_blocks JSONB`, denormalised counters
- [x] `{brand}.sales_campaign_products` — `campaign_price_ngn`, `is_featured`, `display_order`, stock snapshots
- [x] `{brand}.sales_campaign_signups` — `notify_via`, `source`, `ip_address`, `user_agent`, `converted_order_id`
- [x] `{brand}.sales_campaign_metrics` — hourly + daily rollup
- [x] `{brand}.sales_orders.sales_campaign_id` + `sales_order_discounts.sales_campaign_id`
- [x] `{brand}.storefront_sessions` + `storefront_funnel_events` (with `utm_*`)
- [x] RBAC permissions seeded (migration `000102`)

### 1.2 Backend module
- [x] `src/modules/sales_campaigns/` — 13 files (admin + public routes, controller, service, public.service, discount.service, analytics.service, notifications.service, repo, validator, events)
- [x] 24 admin endpoints under `/api/v1/sales-campaigns`, 3 public endpoints under `/api/public/sale`
- [x] Sales-order creation calls `campaigns.discount.resolveDiscount()`; payment writes `recordUsage()`
- [x] PDF post-campaign report via `pdfkit`

### 1.3 Schedulers
- [x] `campaign-state-transition` cron (scheduled → live → ended)
- [x] `campaign-metrics-rollup` cron (every 5min)

### 1.4 Realtime
- [x] Room `brand:{brand}:campaign:{id}`, events: `metrics_updated, launch, pause, resume, end, approved`

### 1.5 OpenAPI + Tests
- [x] Full path coverage in `docs/openapi.yaml`
- [x] 12/12 unit tests passing

---

## 2. Decisions Locked (Conversation 2026-06-17)

| # | Decision | Source |
|---|---|---|
| D-01 | Public landing built as a **separate Next.js 14 App Router app**, deployed to each brand's sales subdomain. Admin builder stays React + Vite. | R1 |
| D-02 | **Sales subdomain field is dynamic** — column added to `shared.business_config.sales_subdomain`, edited in Business Setup → Public Identity. CEO password gates the change. No DNS TXT verification. | R1+R4 |
| D-03 | **Motion stack** = framer-motion + @react-three/fiber + Lottie. No GSAP. Canon's CSS keyframes stay for hub chrome. | R1 |
| D-04 | **Fixed-composition category bundles** with per-item ₦ discount; display before/after totals. Pre-curated by CEO; customer cannot swap items. | Transcript SSOT + R1 |
| D-05 | **Cart-level quantity-tier discounts** in FIXED ₦ amounts (not %). | Transcript + R1 |
| D-06 | **Temu-style escalating cart upsell popups** — each cart re-open shows the next-best offer. Polite glass-styled. CEO can disable per campaign. | Transcript + R1 |
| D-07 | **Preorder** = per-product toggle inside a bundle, default OFF. When ON, preorder price = `full_retail − (full_retail − campaign_price) × (1 − discount_loss_pct)`. Default `discount_loss_pct = 70%`. After campaign ends, price returns to full retail. | R5 |
| D-08 | **Bundles** live in Catalogue (reusable) AND can be composed inline in a campaign (one-off, with "save to catalogue" escape hatch). | R5 |
| D-09 | **No free shipping** anywhere. DHL is real. | R2 |
| D-10 | **"X people viewing"** uses smart auto-hide. Cron-driven (no AI). CEO can manually toggle on/off mid-campaign. Real socket count when ≥ threshold (default 20), below shows only "🔴 Live" pill. | R2+R4 |
| D-11 | **"Y just bought from City"** uses real purchases only, throttled to 1 every 8s, city-only, anonymised. | R2 |
| D-12 | **Exit-intent modal** with one-time discount code (per-campaign toggle). | R2 |
| D-13 | **Sticky mobile bottom checkout bar** + cart drawer + haptic on key actions. No "free-shipping progress meter". | R2+R8 |
| D-14 | **Checkout fields:** first name, last name, email, phone (+country code), Instagram handle (optional), Google-Maps address, order notes, gift order toggle (+ recipient + message), WhatsApp opt-in checkbox, marketing consent checkbox, T&Cs (required), invisible honeypot, save-my-details cookie. | R3+R4 |
| D-15 | **Pricing Engine (campaign-scoped):** goal-seek margin calculator + charm rounding + quantity-tier ladder + cart upsell math generator. All respect `pricing_floors.min_price_ngn` hard floor. Storefront keeps regular prices; advertises sale. | R3+R7 |
| D-16 | **Praxis AI scope:** drafts hero copy, product blurbs, FAQ entries, blast text, block layout, discount math. **No image generation.** "✦ Drafted by Praxis" chip on every AI suggestion + top banner in builder + audit log every accepted suggestion. | R2+R4 |
| D-17 | **CEO conversation with Praxis** during Pricing Engine setup ("price like this per bundle, does it break floor?"). Plain-English, hallucination guardrails enforced. | R7 |
| D-18 | **Brand voice profile** stored in `business_config.praxis_voice_profile` JSONB. CEO-editable. Auto-ingested from existing storefronts + reference site copy. Hard guardrails (no superlatives, no fake reviews). Few-shot from past high-performing campaigns. CEO picks profile per campaign. | R5+R6 |
| D-19 | **Three core states + 5 extra** = (1) Before launch, (2) Live, (3) Ended, (4) VIP early-access (1h head-start), (5) Last-call surge (final 30min), (6) Sold-out hold (stock < 5%), (7) Waitlist for next drop (when next campaign scheduled), (8) Preorder (per-bundle, configurable). | R2+R5 |
| D-20 | **Checkout** = inline guest on the landing. Storefront keeps full price + "Sale is live → go to sales.*" banner. Campaign orders separated in views/reports/accounting from storefront orders. | R3 |
| D-21 | **VIP / Best Customer auto-upgrade:** top 10 (configurable) by campaign revenue → auto-tag `campaign_vip`; lifetime spend threshold promotes to Platinum VIP. Faith gets a "Send VIP gift" task with Praxis-suggested gift category. Personalised thank-you sent (email + IG if handle); WhatsApp only for top 3. | R5 |
| D-22 | **Storefront pre-sale promotion:** banner auto-appears N days before sale (configurable lead days), "on sale soon" chip on campaign-included products, Praxis-suggested cross-promo blasts mid-campaign. | R7 |
| D-23 | **Launch approval:** any role with `sales_campaigns.approve` permission can publish. CEO is misuse-protected via Help Center + Praxis chat. | R7 |
| D-24 | **Help Center articles** for all major flows + Praxis chat grounded on them + module openapi + voice profile + first-run coachmark tour in builder + inline "explain this" tooltips powered by Praxis. | R8 |
| D-25 | **Lookbook media:** product images (auto-pulled) + CEO-uploaded vertical reels (9:16 max 60s, max 30MB) + CEO-approved customer UGC submitted via token link from order confirmation. | R8 |
| D-26 | **Cart abandonment recovery:** single email at 30min after add-to-cart (no purchase). Praxis-drafted copy CEO can edit per campaign. **Email only — no WhatsApp/SMS.** | R2+R8 |
| D-27 | **Share kit:** per-channel UTM auto-gen (WhatsApp / IG / Email / X / FB) with one-click copy + QR code for print + Praxis-drafted share copy per channel + auto-generated OG image (1200×630) + IG-story image (1080×1920) regenerated on save. | R7 |
| D-28 | **Ambassadors** = CRM contacts tagged `ambassador` + custom fields (`commission_pct`, `instagram_handle`, `default_utm_source`). Share-kit pulls filtered list → per-ambassador trackable links. No new module. | R8 |
| D-29 | **PWA** = one PWA per brand sales subdomain. Shell-only caching. **Orders always online (no offline order risk).** Home-screen icon stays useful between campaigns; PWA shell adapts to current campaign state. | R8 |
| D-30 | **Multi-currency + GeoIP:** MaxMind GeoLite2-Country.mmdb on backend (in flight by another engineer per CEO's technical brief). NGN truth via canon. Display USD/GBP/EUR/CAD/GHS via `fx.service.js`. Auto-detect from IP + Accept-Language. User-toggleable in landing header. | R8 |
| D-31 | **DHL shipping calculator** by zone (Africa / Europe / North America / RoW). Live DHL API + manual rate-table fallback CEO maintains. Shown at checkout. New `shared.shipping_zones` + `shared.shipping_rates` tables. | R8 |
| D-32 | **Timezone-aware countdown** — clock shows visitor's local time, state-change cron uses campaign's stored timezone (default Africa/Lagos). | R8 |
| D-33 | **Per-campaign "collect international" toggle** — if off, landing blocks non-NG addresses with explanatory copy. | R8 |
| D-34 | **3D placement:** Hero (Live state) + Countdown ring (Before state). Desktop only with mobile framer-motion CSS fallback. WebGL feature-detected. | R6 |
| D-35 | **Signup channels at go-live:** email blast (already built) + web push (existing `push_subscriptions`). No WhatsApp/SMS at signup; WhatsApp reserved for VIP top-3 thank-you. | R6 |
| D-36 | **Daily AI briefing** at 8am brand-timezone during a Live campaign: yesterday's numbers + top 3 movers + 1 action recommendation. **Email only.** | R6 |
| D-37 | **Block library v1:** CinematicHero + Countdown + FeaturedProducts + LookbookCarousel + BundleShowcase + QuantityTierVisualizer + StockCounter + BrandStory + FounderQuote + WhyBuy + CustomerTestimonials + UGCCarousel + FAQ (schema.org markup) + WigCareSnippet + StylistSpotlight + ShippingReturnsBanner + NewsletterCapture (auto-on in Before/Waitlist states only). | R2 |
| D-38 | **Block reordering** via `@dnd-kit/sortable`. Bounded library (no free canvas). Each block has character-limited text slots per canon §6.28. Brand-lock toggle prevents off-brand styling. | Per canon |

---

## 3. Architecture

```
 ┌─────────────────────────────┐    ┌─────────────────────────────────────┐
 │ pixiegirlglobal.com (Next)  │    │ sales.pixiegirlglobal.com (Next 14) │
 │     main storefront         │    │     campaign landing app            │
 │     - pre-sale banner       │    │     - states: Before/Live/Ended/... │
 │     - sale-soon chips       │    │     - inline checkout               │
 │     - go-to-sales link      │    │     - PWA installable (single)      │
 └────────────┬────────────────┘    └────────────────┬────────────────────┘
              │                                       │
              └───────────────┬───────────────────────┘
                              │ (Public APIs)
                   ┌──────────▼──────────────┐
                   │  /api/public/*           │
                   │  host-resolve brand      │
                   │  /sale/:slug landing     │
                   │  /sale/:slug/signup      │
                   │  /sale/:slug/checkout    │ ← NEW
                   │  /storefront/pre-sale    │ ← NEW
                   └──────────┬──────────────┘
                              │
       ┌──────────────────────┼───────────────────────┐
       │                      │                       │
┌──────▼──────┐    ┌─────────▼──────────┐    ┌───────▼──────────────┐
│ campaigns   │    │  pricing_engine    │    │ catalogue/bundles    │
│ (v1, live)  │    │  (NEW, scoped)     │    │ (NEW bundles tab)    │
└──────┬──────┘    └────┬───────────────┘    └───────┬──────────────┘
       │                │                            │
       └──────────────┬─┴────────────────────────────┘
                      ▼
               ┌──────────────────┐
               │ Praxis AI        │
               │ + action catalog │
               │ + voice profile  │
               │ + guardrails     │
               └────────┬─────────┘
                        │
               ┌────────▼──────────────────────────┐
               │ Audit / Workflow / Notifications  │
               └───────────────────────────────────┘
```

---

## 4. Database Changes Required

### 4.1 `shared` schema migrations
- [ ] `000220_shared_business_config_sales_subdomain.sql`
  - `ALTER TABLE shared.business_config ADD COLUMN sales_subdomain TEXT UNIQUE;`
  - `ALTER TABLE shared.business_config ADD COLUMN praxis_voice_profile JSONB DEFAULT '{}'::jsonb;`
  - `ALTER TABLE shared.business_config ADD COLUMN sales_subdomain_updated_at TIMESTAMPTZ;`
  - `ALTER TABLE shared.business_config ADD COLUMN sales_subdomain_updated_by UUID;`
- [ ] `000221_shared_fx_country_currency_map.sql`
  - `CREATE TABLE shared.fx_country_currency_map (iso_code CHAR(2) PRIMARY KEY, display_currency CHAR(3));`
  - Seed: NG→NGN, US→USD, GB→GBP, CA→CAD, EU member states→EUR, GH→GHS; default lookup falls back to USD
- [ ] `000222_shared_shipping_zones_rates.sql`
  - `shared.shipping_zones (zone_id, name, iso_codes TEXT[])` — seed `africa / europe / north_america / row`
  - `shared.shipping_rates (rate_id, business_key, zone_id, mode 'manual'|'dhl_api', flat_rate_ngn, per_kg_ngn, dhl_account_number)`
- [ ] `000223_shared_praxis_campaign_actions.sql` — seed 10 rows in `ai_action_catalogue`:
  - `sales_campaigns.draft_hero_copy`, `.draft_blast_text`, `.draft_faq`, `.suggest_block_layout`, `.suggest_discount_math`, `.suggest_share_copy`, `.answer_analytics_q`, `.generate_briefing`, `.suggest_recovery_message`, `.suggest_gift_category`
- [ ] `000224_shared_campaign_help_articles_section.sql`
  - `INSERT INTO shared.help_sections (key, name, module) VALUES ('sales_campaigns', 'Sales Campaigns', 'sales_campaigns');`
  - Author 16 articles (see §9)
- [ ] `000225_shared_ambassador_field_definitions.sql`
  - Seed `contact_custom_field_definitions` for `commission_pct NUMERIC(5,2)`, `instagram_handle TEXT`, `default_utm_source TEXT`
- [ ] `000226_shared_campaign_abandoned_carts.sql`
  - `shared.campaign_abandoned_carts (cart_id, brand_key, campaign_id, email, phone NULL, cart_items_json JSONB, abandoned_at, recovery_sent_at NULL, recovered_order_id NULL)`

### 4.2 `template` (brand schemas) migrations
- [ ] `000040_business_catalogue_bundles.sql.template`
  - `__SCHEMA__.product_bundles` — bundle_id, name, slug, cover_image_url, story_blurb, category_id, base_price_ngn, total_saving_ngn (generated), preorder_enabled BOOL DEFAULT FALSE, preorder_discount_loss_pct DEFAULT 70.00, status, created_by, audit fields
  - `__SCHEMA__.product_bundle_items` — item_id, bundle_id FK, product_variant_id FK, fixed_discount_ngn, included_qty INT DEFAULT 1, display_order
- [ ] `000041_business_campaign_extensions.sql.template`
  - ADD columns on `__SCHEMA__.sales_campaigns`: `voice_profile_key TEXT`, `ai_attribution_pct NUMERIC(5,2)`, `collect_international BOOL DEFAULT TRUE`, `viewer_count_policy TEXT DEFAULT 'smart'`, `viewer_count_floor INT DEFAULT 20`, `exit_intent_enabled BOOL DEFAULT FALSE`, `exit_intent_code TEXT`, `storefront_banner_lead_days INT DEFAULT 5`, `timezone TEXT DEFAULT 'Africa/Lagos'`, `next_campaign_id UUID`
- [ ] `000042_business_campaign_bundles.sql.template`
  - `__SCHEMA__.sales_campaign_bundles` (link_id, campaign_id FK, bundle_id FK, campaign_price_ngn, display_order, is_featured, starting_stock, current_stock_snapshot)
- [ ] `000043_business_quantity_tiers.sql.template`
  - `__SCHEMA__.sales_campaign_qty_tiers` (tier_id, campaign_id FK, min_qty INT, fixed_discount_ngn, applies_to_bundle_id NULL, applies_to_product_id NULL, applies_globally BOOL DEFAULT TRUE)
- [ ] `000044_business_cart_upsells.sql.template`
  - `__SCHEMA__.sales_campaign_cart_upsells` (upsell_id, campaign_id, threshold_subtotal_ngn, message TEXT, suggested_bundle_id FK NULL, additional_discount_ngn, display_order, max_show_count INT DEFAULT 1)
- [ ] `000045_business_campaign_lookbook.sql.template`
  - `__SCHEMA__.sales_campaign_lookbook_items` (item_id, campaign_id, media_asset_id, media_type ('product_image'|'reel'|'ugc_clip'|'editorial'), title, alt_text, author_credit, source ('catalogue'|'ceo_upload'|'customer'), display_order, approved_at, approved_by)
- [ ] `000046_business_vip_rewards.sql.template`
  - `__SCHEMA__.sales_campaign_vip_rewards` (reward_id, campaign_id, contact_id, rank INT, total_spent_ngn, total_orders, gift_task_id NULL, gift_category_suggested TEXT, thank_you_sent_email BOOL, thank_you_sent_whatsapp BOOL, thank_you_sent_instagram BOOL, created_at)
- [ ] `000047_business_campaign_ai_briefings.sql.template`
  - `__SCHEMA__.sales_campaign_ai_briefings` (briefing_id, campaign_id, briefing_date DATE, summary_md TEXT, top_movers JSONB, recommended_action TEXT, delivered_at)
- [ ] `000048_business_campaign_pricing_drafts.sql.template`
  - `__SCHEMA__.sales_campaign_pricing_drafts` (draft_id, campaign_id, target_net_margin_pct NUMERIC, charm_rounding_strategy TEXT, calculation_input JSONB, calculation_output JSONB, floor_violations JSONB, accepted_by NULL, accepted_at NULL)

### 4.3 Indexes & constraints
- [ ] Composite `(brand_key, campaign_id, status)` on rollups
- [ ] Verify v1 index on `sales_orders.sales_campaign_id`
- [ ] UNIQUE on `business_config.sales_subdomain`
- [ ] Audit trigger on `business_config.sales_subdomain` change

---

## 5. Backend Module Work

### 5.1 `src/modules/sales_campaigns/` — extensions to v1
- [ ] `campaigns.service.js`: add `setVoiceProfile`, `setViewerPolicy`, `setExitIntent`, `setNextCampaign`, `setBundleAssociation`, `setQuantityTiers`, `setCartUpsells`, `setLookbookItems`
- [ ] `campaigns.discount.service.js`: graduate `bundle` and `buy_x_get_y` enum cases from V1-limited to full implementation; add tier-ladder resolver; add cart-upsell selector
- [ ] `campaigns.public.service.js`: extend `getLanding()` to return new blocks (lookbook, qty_tiers, cart_upsells, vip_preview)
- [ ] `campaigns.notifications.service.js`: add `sendCartAbandonmentEmail`, `sendVipThankYou` (email + IG DM via Meta API + WhatsApp for top 3), `sendDailyAiBriefing`, `sendStorefrontPreSaleNotice`
- [ ] `campaigns.validator.js`: Zod for bundle assoc, qty tiers, cart upsells, viewer policy, exit intent, voice profile, lookbook items
- [ ] `campaigns.events.js`: emit `cart_abandoned`, `cart_recovered`, `vip_rewarded`, `viewer_threshold_crossed`, `state_changed`, `pricing_draft_accepted`, `voice_profile_changed`
- [ ] `campaigns.routes.js`: new endpoints (~12) for the above

### 5.2 NEW module: `src/modules/pricing_engine/`
- [ ] Files: `pricing.routes.js`, `pricing.controller.js`, `pricing.service.js`, `pricing.repo.js`, `pricing.validator.js`, `pricing.events.js`
- [ ] `goalSeekMargin({ target_margin_pct, cost_ngn, fees_ngn, freight_ngn, floor_ngn })` → returns calculated price
- [ ] `charmRound(price, strategy)` — strategies: `psychological_999`, `clean_thousands`, `none`
- [ ] `validateAgainstFloor(price, floor)` — throws `AppError` if below
- [ ] `computeQuantityTierLadder({ campaign_id, products, tiers })` → returns ladder + per-tier floor warnings
- [ ] `computeCartUpsells({ campaign_id, bundles, max_steps })` → returns escalating offer ladder
- [ ] `simulateCart({ campaign_id, items, qty_tier_applied, upsell_applied })` → returns full price breakdown
- [ ] Praxis-conversational API: `/api/v1/pricing-engine/conversation` accepts a natural-language prompt + campaign context, returns explanation + suggested actions; never auto-applies

### 5.3 NEW module: `src/modules/catalogue/bundles/`
- [ ] CRUD for `product_bundles` + `product_bundle_items`
- [ ] Image management (uses existing storage.service)
- [ ] Status: `draft / active / archived`
- [ ] Stock derivation from underlying variant stocks (min stock across items × included_qty)
- [ ] Bundle preview rendering helper
- [ ] "Save as bundle" endpoint called from campaign-builder inline composer
- [ ] Audit on every change

### 5.4 NEW middleware: `src/middleware/host-brand-resolver.js`
- [ ] Resolves brand from `req.hostname` via `business_config.sales_subdomain`
- [ ] Sets `req.brand` for public landing routes
- [ ] Wraps `/api/public/sale/*` only
- [ ] In-memory cache keyed by hostname, 5min TTL, hot-invalidates on subdomain change event
- [ ] Falls through to next middleware on no match (allows other public routes to run)

### 5.5 NEW module: `src/modules/vip_rewards/`
- [ ] `vip.service.js` with `computeAndAwardForCampaign(campaignId)`
- [ ] Top-N + lifetime-spend tier logic
- [ ] CRM contact tagging via existing contacts service
- [ ] Task creation via `tasks` or `service_jobs` module (Faith as assignee)
- [ ] Praxis call: `suggest_gift_category` action with the customer's order history as context
- [ ] Thank-you dispatch via `notifications.service` (email + IG + WhatsApp top-3 only)
- [ ] Listens to `campaign.ended` event; cron sweep for safety

### 5.6 Praxis AI plumbing
- [ ] Seed `shared.ai_action_catalogue` rows per §4.1 D-23
- [ ] All 10 actions have `is_write = false` (suggestions only)
- [ ] `required_permission` mapped correctly per action
- [ ] `src/ai/voice-profile.service.js` — loads + few-shots brand voice profile
- [ ] `src/ai/guardrails.js` — banned-words filter, claim-detector, "needs evidence" pre-flight, no-superlative-without-source
- [ ] Praxis chat in builder + analytics page (RAG over help_articles + module openapi + voice profile + campaign data)
- [ ] Praxis-accepted suggestions audit-logged with `prompt`, `model`, `original`, `accepted`, `user_id`

### 5.7 Sales / orders integration
- [ ] Sales-order creation accepts `bundle_id` lines (de-references to underlying variants + carries a bundle line for accounting clarity)
- [ ] Quantity-tier resolution at cart calc, stored as `sales_order_discounts` row with `source = 'campaign_qty_tier'`
- [ ] Cart-upsell acceptance stored as `sales_order_discounts` row with `source = 'campaign_cart_upsell'`
- [ ] New `sales_channel` value: `campaign_landing` (separate from `public_form` storefront)

### 5.8 Accounting integration
- [ ] `accounting.subscribers.js` `REVENUE_BY_CHANNEL` map: add `campaign_landing: '4001'`
- [ ] Seed account `4001 - Campaign Sales Revenue NGN`
- [ ] Posting: DR Cash 1100 / CR Campaign Revenue 4001 / CR VAT 2100 / DR COGS 5000 / CR Inventory 1300

### 5.9 Workflow integration
- [ ] Existing `campaign_approval` workflow stays
- [ ] Seed `vip_gift_dispatch` workflow def (CEO approves the gift task before logistics ships)
- [ ] No threshold workflow on launch (D-23: any approve-permissioned role can publish)

### 5.10 Audit (every event)
- [ ] State transitions → `action_key = 'sales_campaigns.<action>'`
- [ ] Praxis suggestions accepted → `action_key = 'sales_campaigns.ai_accepted'` with diff in `meta`
- [ ] Viewer-policy toggles → `action_key = 'sales_campaigns.viewer_policy_changed'`
- [ ] Subdomain change → `action_key = 'business_config.sales_subdomain_changed'` with `old → new`
- [ ] Pricing draft accepted → `action_key = 'sales_campaigns.pricing_accepted'`
- [ ] Bundle CRUD → `action_key = 'catalogue.bundle.<action>'`
- [ ] VIP gift task created + thank-you sent → audit rows

### 5.11 Notifications (every event)
- [ ] State transitions → notification per `notification_preferences`
- [ ] Cart abandonment → email 30min after add-to-cart (single)
- [ ] Daily AI briefing → email 8am brand-tz during live campaign
- [ ] VIP thank-you → email + IG (+ WhatsApp top-3)
- [ ] Subdomain change → CEO + owner role notified
- [ ] Praxis suggestion accepted (CEO opt-in only — defaults off; chatty)

---

## 6. Public Landing Page App (Next.js 14)

### 6.1 Location & stack
- [ ] `/apps/sales-landing/` — separate workspace inside repo
- [ ] Next.js 14 App Router, TypeScript, Tailwind 3.4
- [ ] framer-motion, @react-three/fiber + drei, lottie-react, next/image, next/font
- [ ] Deployed to both `sales.pixiegirlglobal.com` and the configured Faitlyn sales subdomain (single app, hostname-aware)
- [ ] Reads from `/api/public/sale/:slug` (proxied via same origin or absolute base URL per env)

### 6.2 Routing
- [ ] `/` — host-aware redirect (active campaign → `/c/[slug]`; else → `/next-up`)
- [ ] `/c/[slug]` — the landing
- [ ] `/c/[slug]/checkout` — inline checkout state machine
- [ ] `/c/[slug]/success` — post-purchase celebration
- [ ] `/next-up` — between-campaigns "stay tuned" page
- [ ] `/vip/[token]` — VIP early-access deep link (token from signup row)

### 6.3 State machine
- [ ] `resolveState(now, campaign, viewerVipToken?)`:
  - `now < campaign.starts_at − 24h` → **teaser** (date-only countdown)
  - `now < campaign.starts_at` → **before** (countdown + signup + premium content)
  - `vipToken matches signup AND now >= starts_at − 1h AND now < starts_at` → **vip_early**
  - `now >= starts_at AND now < ends_at − 30min AND remaining_stock_pct >= 5%` → **live**
  - `now < ends_at AND remaining_stock_pct < 5%` → **sold_out_hold**
  - `now >= ends_at − 30min AND now < ends_at` → **last_call**
  - `now >= ends_at AND next_campaign_id IS NOT NULL` → **waitlist_for_next_drop**
  - `now >= ends_at` → **ended**
  - `campaign.status = 'paused'` → **paused**
  - Per-product `preorder_enabled = true` opens preorder UX within live state

### 6.4 Block components (drag-reorderable in admin)
- [ ] CinematicHero (with optional 3D)
- [ ] Countdown (mono tabular)
- [ ] BundleShowcase
- [ ] QuantityTierVisualizer
- [ ] FeaturedProductsGrid
- [ ] LookbookCarousel (image / reel / UGC)
- [ ] BrandStory
- [ ] FounderQuote
- [ ] WhyBuy
- [ ] CustomerTestimonials
- [ ] UGCCarousel
- [ ] FAQ (schema.org markup)
- [ ] WigCareSnippet
- [ ] StylistSpotlight
- [ ] ShippingReturnsBanner (international heads-up)
- [ ] NewsletterCapture (auto-on in Before/Waitlist states only)
- [ ] StockCounter (socket-driven)

### 6.5 Conversion UX
- [ ] CartUpsellPopup (escalating, dismissable, polite glass)
- [ ] ExitIntentModal (one-time code; per-campaign toggle)
- [ ] LiveViewerPill (smart auto-hide; cron-driven flag from server)
- [ ] RecentPurchaseTicker (real purchases, throttled, city-only)
- [ ] StickyBottomBar (mobile)
- [ ] CartDrawer (slide-from-right glass)
- [ ] PWA install prompt (single per brand)
- [ ] Apple Wallet + Google Pay pass (campaign reminder)
- [ ] Add-to-calendar `.ics` (the user's specific ask)

### 6.6 Multi-currency UI
- [ ] SSR: read `req.ip` → MaxMind ISO → `display_currency` (cookie override wins)
- [ ] Header dropdown (NGN / USD / GBP / EUR / CAD / GHS)
- [ ] All money via `<MoneyText ngn={…} displayCurrency={…} />` (canon: NGN is truth)
- [ ] Checkout always settles in NGN; gateway converts at processor rate
- [ ] Conversion rate footnote: "Approximate, processor will charge at their rate"

### 6.7 Motion
- [ ] framer-motion: scroll-reveal of each block (stagger by section_order), page transitions, popup spring physics
- [ ] @react-three/fiber: Hero in Live (floating product parallax), Countdown ring in Before (shimmer rim)
- [ ] Lottie: heart fill on favourite, sparkle on add-to-cart, checkout success, ticker icon
- [ ] CSS keyframes (canon): glass tile lift, accent edge ignite on hover
- [ ] All motion respects `prefers-reduced-motion`

### 6.8 Mobile / PWA
- [ ] Mobile-first responsive
- [ ] Sticky bottom checkout bar with "N items • ₦X • Checkout →"
- [ ] Cart drawer (slide-from-right) with light haptic
- [ ] Swipe between blocks (touch carousel)
- [ ] PWA manifest per brand
- [ ] Service worker caches shell + branding only (NEVER the order form — orders must round-trip live to backend)
- [ ] Add to home screen prompt during Live state only

### 6.9 SEO / Share
- [ ] Per-state metadata
- [ ] schema.org `FAQPage` + `Product` markup
- [ ] OG image (1200×630) auto-regenerated on save
- [ ] IG-story image (1080×1920) auto-regenerated on save
- [ ] Twitter Card `large_image`
- [ ] WhatsApp link preview via OG
- [ ] Auto-UTM stripping on bookmark

### 6.10 Inline checkout
- [ ] Steps: Cart review → Personal details → Delivery address (Google Maps autocomplete) → Payment method → Confirmation
- [ ] All 12 fields per D-14
- [ ] DHL shipping rate computed and shown
- [ ] Show subtotal + shipping + total in display currency (NGN equivalent in subtext)
- [ ] Payment gateways: Paystack (NG primary), Stripe (USD/GBP), Opay (NG), Nomba (NG backup)
- [ ] Idempotency via `client_idempotency_key`
- [ ] Success page with social share + receipt download + add-to-calendar
- [ ] Email confirmation (always) + WhatsApp confirmation (if opted in)

### 6.11 4-state coverage (per canon)
- [ ] Loading: skeleton glass tiles
- [ ] Empty (checkout-empty): "Add something" CTA
- [ ] Error: friendly maroon error glass + retry
- [ ] Permission-denied: N/A (public)

---

## 7. Admin Frontend (React + Vite — existing `apps/admin/`)

### 7.1 Routes added to `apps/admin/src/router.tsx`
- [ ] `/campaigns` → CampaignsListPage
- [ ] `/campaigns/new` → CampaignBuilderPage (create mode)
- [ ] `/campaigns/:id` → CampaignDetailPage (live dashboard)
- [ ] `/campaigns/:id/builder` → CampaignBuilderPage (edit mode)
- [ ] `/campaigns/:id/landing` → LandingEditorPage
- [ ] `/campaigns/:id/pricing` → PricingEnginePage
- [ ] `/campaigns/:id/products` → ProductsAndBundlesPage
- [ ] `/campaigns/:id/analytics` → CampaignAnalyticsPage
- [ ] `/campaigns/:id/signups` → SignupsListPage
- [ ] `/campaigns/:id/report` → CampaignReportPage
- [ ] `/catalogue/bundles` → BundlesListPage
- [ ] `/catalogue/bundles/new` + `/catalogue/bundles/:id` → BundleDetailPage
- [ ] Add Recharts to `apps/admin` package.json

### 7.2 Pages
- [ ] **CampaignsListPage** — KPI strip + status kanban + perf cards (Active) + DataTable (full)
- [ ] **CampaignBuilderPage** — 6-step wizard with Praxis chat sidebar:
  1. Brief (name, dates, audience, voice profile)
  2. Products & Bundles
  3. Pricing (goal-seek + tiers + cart upsells)
  4. Landing Page (block library + drag reorder + content editing)
  5. Share & SEO (kit + ambassadors + metadata)
  6. Review & Submit
- [ ] **CampaignDetailPage** — live KPI strip (viewer count animated) + state badge + timeline + actions bar (pause/resume/end) + activity feed + Praxis chat
- [ ] **CampaignAnalyticsPage** — Recharts dashboards + UTM funnel + per-product perf + heatmap + best-customers preview + Praxis Q&A
- [ ] **LandingEditorPage** — left: block library + reorder; right: live preview iframe with draft-mode token + state toggle
- [ ] **PricingEnginePage** — tabs (Goal-Seek | Quantity Tiers | Cart Upsells | Floor Check) + Praxis chat
- [ ] **BundlesListPage / BundleDetailPage** — catalogue-style; reuse `BaseProductPage` patterns
- [ ] **CampaignReportPage** — post-campaign card + PDF + share kit + share-as-IG-story

### 7.3 Components (new)
- [ ] CampaignStateBadge, CountdownConfig, CountdownPreview
- [ ] ProductSelectionPanel (MultiSelect + include/exclude)
- [ ] BundleComposer (drag styled-products into bundle)
- [ ] QuantityTierLadder (visual editor)
- [ ] CartUpsellLadder (visual escalation editor)
- [ ] PricingGoalSeek (margin slider + result + floor warning)
- [ ] PraxisChatSidebar (collapsible, attribution chips)
- [ ] BlockLibraryPanel (block cards + drag handle)
- [ ] BlockEditor (per block: image picker + character-limited text + Praxis draft button)
- [ ] LandingStatePreview (iframe + state switcher)
- [ ] LiveViewerCount, BestCustomersWidget
- [ ] CampaignAnalyticsDashboard (Recharts wrappers)
- [ ] ShareKitDrawer (per-channel one-click copy + QR + OG preview)
- [ ] AmbassadorPicker (CRM tag filter + per-ambassador link generator)
- [ ] VoiceProfileEditor (settings page)
- [ ] AIAttributionChip, AIDraftBanner

### 7.4 Stores + Query
- [ ] `useCampaignDraft` (zustand persisted, multi-step wizard state, dirty tracking)
- [ ] `useCampaignBuilderUI` (zustand, sidebar state, current step, preview state)
- [ ] Query keys (brand-aware): `["campaigns",…]`, `["bundles",…]`, `["praxis","voice",brand]`

### 7.5 Realtime
- [ ] Subscribe `brand:{brand}:campaign:{id}` on detail page mount
- [ ] Handlers: `metrics_updated → update KpiTiles`, `launch/pause/end → toast + state badge`, `viewer_threshold_crossed → update pill`, `ai_briefing_ready → notify`

### 7.6 Motion (admin)
- [ ] Stick to CSS keyframes + `ease-brand` curve from canon
- [ ] Exception: framer-motion for builder's preview-iframe state-switch animation
- [ ] No three.js in admin

### 7.7 4-state coverage
- [ ] Every page: Skeleton, ErrorState, EmptyState, DeniedState

### 7.8 Permission gating
- [ ] All actions via `useAuthStore().can("sales_campaigns", action)`
- [ ] CEO bypass via `"*"`

---

## 8. Settings Surfaces

### 8.1 Business Setup → Public Identity (extend existing tab)
- [ ] New field: `Sales subdomain` (text, validator `^[a-z0-9-]+\.[a-z0-9-.]+$`, max 100, uniqueness)
- [ ] Adjacent to existing `storefront_domain` field
- [ ] Tooltip: "The address where your sales campaigns are hosted. Type the domain you own; we route incoming traffic. To change this, you must re-enter your password."
- [ ] On save: require CEO password re-entry; audit row written; host-resolver cache invalidated
- [ ] Visible green check / red warning if DNS resolves correctly

### 8.2 Settings → Sales Campaigns
- [ ] Voice profile picker (default for new campaigns)
- [ ] Default viewer count policy (smart | on | off) + default threshold
- [ ] Default exit-intent policy (on/off + default discount-code template)
- [ ] Default storefront banner lead days
- [ ] Default VIP top-N count + lifetime spend threshold
- [ ] DHL API key + account number (encrypted via `encryption.service`)

### 8.3 Settings → AI → Voice Profiles
- [ ] Per-brand voice profile editor (up to 5 profiles per brand):
  - Voice name + descriptor
  - Tone keywords (chip list)
  - 3 sample paragraphs
  - Banned words list
  - Max sentence length
  - Allowed punctuation (e.g. "no exclamation marks" for Pixie Global)
- [ ] "Test this voice" — Praxis generates a sample paragraph

### 8.4 Settings → AI → Guardrails
- [ ] Master toggles: no-fake-reviews, no-unsupported-superlatives
- [ ] Banned-words global list (overrides per-voice)
- [ ] Required AI disclosure copy

### 8.5 Settings → Shipping
- [ ] Manage zones (CRUD)
- [ ] Manage rates per zone (flat / per kg / DHL API)
- [ ] "Compute shipping for ZIP X" tester

### 8.6 Settings → Help Center → Praxis Chat
- [ ] Enable "Ask Praxis" widget on every page
- [ ] Customise welcome message
- [ ] Article ingestion status

---

## 9. Help Center

### 9.1 Articles to author (16)
- [ ] "Launching a Sales Campaign — Walkthrough"
- [ ] "Setting up Bundles in Catalogue"
- [ ] "Goal-Seek Pricing — How to set the right margin"
- [ ] "Quantity Tiers — Charging less for more"
- [ ] "Cart Upsell Popups — Building the Temu-style ladder"
- [ ] "Building the Landing Page — Block library tour"
- [ ] "Using Praxis to Draft Copy (and the ✦ chip)"
- [ ] "Sharing Your Campaign — UTM kit + Ambassadors"
- [ ] "Pre-launch Signups & VIP Early Access"
- [ ] "Pre-orders during a Campaign"
- [ ] "Reading Campaign Analytics"
- [ ] "Best Customers & Gift Tasks"
- [ ] "When the Campaign Ends — The Waitlist Mechanic"
- [ ] "Multi-currency & DHL for International Buyers"
- [ ] "Changing the Sales Subdomain — Why we ask for your password"
- [ ] "What Faith Approved — Decision Log (D-01…D-38)"

### 9.2 Inline tooltips (Praxis-powered)
- [ ] "Why this number?" on goal-seek output
- [ ] "Floor check" on pricing rows
- [ ] "Voice match" on Praxis-drafted blocks
- [ ] "Why this state?" on state-machine viewer

### 9.3 Coachmark tours (first-run only, skippable)
- [ ] Campaign builder tour (6 steps)
- [ ] Landing editor tour (5 steps)
- [ ] Pricing engine tour (4 steps)

### 9.4 Praxis chat (across the module)
- [ ] Grounded on help_articles + module openapi + voice profile + campaign data
- [ ] Cites article links in answers
- [ ] Q&A logged in `shared.ai_chat_log` (CEO can review)

---

## 10. GeoIP / MaxMind Integration (parallel engineer in flight)

Per CEO's technical brief 2026-06-16:

- [ ] `npm install @maxmind/geoip2-node`
- [ ] DB path: `/home/user/pixie-girl-hub/data/GeoLite2-Country.mmdb`
  - (Note: CEO brief shows `apps/api/data/` — we don't have that directory; backend is at root. Will confirm with engineer; spec uses root path.)
- [ ] `.env`: `MAXMIND_LICENSE_KEY`, `MAXMIND_DB_PATH`
- [ ] `src/services/geoip.service.js` — `lookupCountry(ip)` returns ISO code
- [ ] Cron updater: `src/jobs/schedulers/geoip-update.js` runs **Sunday 02:00 WAT** — downloads via permalink + license key, extracts, atomic-swaps mmdb file, logs
- [ ] Express middleware `src/middleware/geo-currency.js` reads `req.ip` → `iso_code` → `display_currency` → `res.locals.display_currency`
- [ ] On read fail, fall back to USD (and log)
- [ ] Used by both the public landing app (via `/api/public/geo` lookup endpoint) and storefront

---

## 11. Build Phases / Sequencing

### Phase A — Foundations (no UI) — 1 sprint
- [ ] Migrations 000220-000226 (shared) + 000040-000048 (template)
- [ ] `host-brand-resolver` middleware + cache-invalidation event
- [ ] `business_config.sales_subdomain` exposed in Settings API + password-gated mutation
- [ ] Bundle CRUD module in catalogue
- [ ] Pricing Engine module
- [ ] Campaign discount engine — graduate `bundle` + `buy_x_get_y`
- [ ] VIP rewards module + cron
- [ ] Praxis action catalogue seed
- [ ] Voice profile + guardrails services
- [ ] AI briefing cron + cart abandonment cron + lookbook media handling
- [ ] Shipping zones + rates
- [ ] GeoIP service + middleware (integrate against parallel engineer's mmdb)

### Phase B — Admin UI — 2 sprints
- [ ] CampaignsListPage
- [ ] CampaignBuilderPage (6-step wizard)
- [ ] CampaignDetailPage (live dashboard)
- [ ] LandingEditorPage (block library + reorder)
- [ ] PricingEnginePage
- [ ] CampaignAnalyticsPage
- [ ] SignupsListPage
- [ ] CampaignReportPage
- [ ] BundlesListPage + BundleDetailPage
- [ ] Settings extensions (Public Identity, Voice profiles, Guardrails, Shipping)
- [ ] Help Center 16 articles + coachmark tours
- [ ] PraxisChatSidebar + AI attribution UX

### Phase C — Public Landing App (Next.js) — 2 sprints
- [ ] Bootstrap `apps/sales-landing/`
- [ ] Brand resolution from host
- [ ] State machine (8 states)
- [ ] 17 block components
- [ ] Inline checkout (5-step state machine)
- [ ] Cart upsell popups + exit intent
- [ ] Viewer count + recent-purchase tickers
- [ ] PWA + service worker (shell-only)
- [ ] Multi-currency UI
- [ ] DHL shipping calc UI
- [ ] 2.5D Hero + Countdown ring (3D, desktop-only)
- [ ] Mobile sticky bar + haptic
- [ ] Apple Wallet + Google Pay pass + .ics calendar
- [ ] OG / IG-story image generation
- [ ] SEO + schema.org markup

### Phase D — Polish + Tests + Docs — 1 sprint
- [ ] Unit tests: pricing engine, VIP rewards, voice profile, guardrails
- [ ] Integration tests: host resolution, checkout E2E
- [ ] Playwright tests: landing-state coverage, currency switch, cart upsell
- [ ] OpenAPI for new endpoints
- [ ] Performance budget: LCP < 2.5s on 4G, CLS < 0.05, TBT < 200ms
- [ ] Accessibility pass (WCAG AA)
- [ ] Storefront pre-sale banner + on-sale-soon chip
- [ ] Production deployment checklist + smoke

---

## 12. Post-Build Verification Checklist (CEO-runnable)

### 12.1 Admin builder
- [ ] I can create a campaign from scratch and walk all 6 steps
- [ ] Praxis drafts hero copy in the brand voice with a ✦ chip
- [ ] "Drafted by Praxis" banner appears in builder during AI assist
- [ ] I can drag-reorder landing blocks
- [ ] I can toggle blocks on/off
- [ ] I can pick a bundle from catalogue
- [ ] I can compose a one-off bundle inline and save it to catalogue
- [ ] Goal-seek margin calculator shows a result + floor check
- [ ] Tier ladder visualises before save
- [ ] Cart upsells preview correctly
- [ ] Pricing change shows floor warning if I try to go below
- [ ] I can pick a voice profile from a dropdown
- [ ] I can preview the landing in Before / Live / Ended / VIP-early / Last-call / Sold-out / Waitlist states
- [ ] I can submit for approval; approver receives a notification
- [ ] After approval, the campaign moves to Scheduled
- [ ] On the start date/time, the campaign auto-moves to Live
- [ ] Signups receive the go-live email (+ web push if subscribed)

### 12.2 Public landing
- [ ] Visiting `sales.pixiegirlglobal.com/c/SLUG` works for PXG campaigns
- [ ] Visiting `sales.<faitlyn>/c/SLUG` works for FLH campaigns
- [ ] Before-state shows countdown and signup form
- [ ] Live-state shows products with crossed-out prices and live stock
- [ ] Ended-state shows "Shop our full collection" or Waitlist
- [ ] VIP-early-token link opens 1h before start
- [ ] Last-call surge state activates 30min before end
- [ ] Sold-out hold activates when stock < 5%
- [ ] Preorder shows for products with `preorder_enabled = true`
- [ ] Preorder price math = full retail − 70% × discount amount
- [ ] Inline checkout works with all 12 fields
- [ ] WhatsApp opt-in, marketing consent, T&Cs checkboxes all rendered
- [ ] DHL shipping rate shows at checkout
- [ ] Currency auto-detects from country (GeoIP)
- [ ] Currency dropdown changes display
- [ ] Cart upsell popup appears when threshold met
- [ ] Exit-intent modal appears once per session
- [ ] Viewer count shows when ≥ threshold; "Live now" pill otherwise
- [ ] "Y just bought from City" ticker shows real purchases throttled to 8s
- [ ] PWA installs and stays installed
- [ ] PWA shell adapts to current campaign state
- [ ] Add-to-calendar (.ics) works
- [ ] Apple Wallet pass works
- [ ] OG image previews correctly on WhatsApp / IG / FB / X

### 12.3 Storefront integration
- [ ] Storefront shows pre-sale banner N days before campaign
- [ ] Storefront product pages show "On sale soon" chip on campaign products
- [ ] Storefront banner during Live links to sales subdomain
- [ ] After campaign, banner removed automatically

### 12.4 Analytics
- [ ] Live dashboard shows visitors, signups, AOV, revenue, conv rate
- [ ] UTM funnel renders with drop-off percentages
- [ ] Per-product performance + heatmap
- [ ] Best Customers preview (live)
- [ ] I can ask Praxis "Why did revenue drop after 3pm?" and get a cited answer
- [ ] I receive a daily AI briefing email at 8am
- [ ] Post-campaign PDF report downloads
- [ ] Campaign orders separated cleanly from storefront orders in reports + accounting (account 4001)

### 12.5 VIP / Best Customers
- [ ] Top 10 spenders auto-tagged `campaign_vip` after campaign end
- [ ] Lifetime threshold promotes to Platinum VIP
- [ ] Faith receives a "Send VIP gift" task with Praxis-suggested gift category
- [ ] Faith approves → personalised thank-you (email + IG; WhatsApp top 3 only)

### 12.6 Ambassadors
- [ ] I can tag a CRM contact as `ambassador`
- [ ] Custom fields `commission_pct`, `instagram_handle`, `default_utm_source` editable
- [ ] Share kit generates per-ambassador trackable links
- [ ] Analytics show revenue attributed to each ambassador

### 12.7 Settings
- [ ] I can edit the sales subdomain in Business Setup → Public Identity (password gate)
- [ ] Voice profile editable in Settings → AI → Voice Profiles
- [ ] Guardrails editable
- [ ] Shipping zones + rates editable

### 12.8 Help Center
- [ ] 16 articles authored and findable
- [ ] Praxis chat answers "How do I price a bundle below floor?" with citations
- [ ] First-run tour appears for first-time CEO

### 12.9 Audit + Notifications
- [ ] Every state transition writes audit_log row
- [ ] Every AI-accepted suggestion writes audit row
- [ ] Subdomain change writes audit row with old → new
- [ ] State transitions trigger notifications per preferences
- [ ] Cart abandonment fires after 30min (email only)
- [ ] VIP thank-you fires on approval

### 12.10 Performance
- [ ] LCP < 2.5s on 4G
- [ ] CLS < 0.05
- [ ] TBT < 200ms
- [ ] Lighthouse > 90 on landing
- [ ] No layout shift during currency detection (SSR)
- [ ] PWA installable indicator visible in Chrome dev tools

### 12.11 Accessibility
- [ ] WCAG AA on landing
- [ ] Keyboard navigation through entire checkout
- [ ] Screen reader announces state transitions correctly
- [ ] Colour contrast checked
- [ ] Reduced-motion honoured throughout

### 12.12 Security
- [ ] Honeypot anti-bot field present in checkout
- [ ] CSRF tokens on checkout POST
- [ ] Rate limit on signup endpoint (existing 20/15min)
- [ ] Rate limit on checkout submit
- [ ] Praxis output passes through guardrails before render
- [ ] Cost vault hidden from non-grant users
- [ ] Sales subdomain change requires password
- [ ] No brand_key leakage in client JS

---

## 13. Open Decisions / Deferred to v3

- [ ] A/B test infrastructure (hero variant A vs B with significance test)
- [ ] Full Pricing Engine v2 (sensitivity sliders, scenario presets, FX hedging)
- [ ] Loyalty auto-redemption at checkout
- [ ] Crypto payments
- [ ] AR wig try-on (separate spec)
- [ ] Customer accounts (currently guest only)
- [ ] Refunds + exchanges flow for campaign orders (use existing module after v1 launch)
- [ ] Multi-language landing (currently English only)

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| MaxMind engineer's work blocks landing launch | Implement Cloudflare `CF-IPCountry` header as primary fallback, MaxMind as enrichment. Both fall back to USD. |
| Praxis hallucinates / outputs banned content | Hard guardrails layer before render; banned-words list; claim detector; CEO must accept every suggestion (never auto-applied); audit log retains diffs. |
| Cart upsell feels spammy | Per-session show cap; 24h dismiss respected; CEO can disable per campaign. |
| Viewer count drops below threshold | Smart auto-hide already handles; CEO manual toggle. |
| DHL API rate-limits or fails | Manual rate-table fallback maintained by CEO. |
| Subdomain DNS misconfigured | Health-check status badge in Settings + retry. |
| 3D / WebGL load on mobile | Feature-detect, fall back to framer-motion CSS on low-end. |
| Webhook lost during traffic spike | Existing `webhook_log` + `webhook_dedup`. |
| Subdomain leaks brand data | `host-brand-resolver` never exposes raw `brand_key` client-side; cookie-scoped to host. |
| v1 campaigns broken by new shape | All v1 data backward-compatible (new columns nullable with defaults). |

---

## 15. Glossary

- **Bundle** — pre-curated, fixed-composition set of styled product variants with per-item ₦ discount
- **Quantity tier** — cart-level fixed-₦ discount triggered by item count
- **Cart upsell** — escalating ₦ discount triggered by adding more bundles to cart
- **Preorder** — sold-out items still purchasable at a reduced discount (70% loss by default)
- **Smart viewer count** — auto-hide policy showing count only above threshold
- **VIP early-access** — 1h head-start gated by signup token
- **Last-call surge** — final 30min UI tilt for urgency
- **Sold-out hold** — micro-state when stock < 5%
- **Waitlist for next drop** — Ended-state replacement when next campaign scheduled
- **Drafted by Praxis** — AI attribution chip
- **Voice profile** — per-brand Praxis tuning (tone, banned words, samples)
- **Brand resolver** — middleware mapping `req.hostname` → `brand_key`
- **Floor** — `pricing_floors.min_price_ngn` hard lower bound
- **Charm round** — ₦149,000 / ₦147,990 psychological rounding strategy

---

## 16. Sign-off

CEO Faith — _______________________ Date: __________

Engineer (Tom-Blake) — _______________________ Date: __________

PM — _______________________ Date: __________
