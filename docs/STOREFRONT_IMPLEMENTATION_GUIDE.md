# Storefront Website & Storefront Studio — Full Implementation Guide

**Status:** Implementation spec (engineer-ready). Grounded in the live codebase as of 2026-06.
**Scope:** Build the customer-facing **Storefront Website** (per brand) from the Faitlyn Aura design, wired entirely to Hub APIs, plus the **Storefront Studio** admin module (frontend + backend extensions) that controls it. Remove Supabase entirely.

---

## 0. Non-negotiable principles

1. **Landing ≠ Website. Never mix the two.**
   - **Sales Campaign Landing** = `/sale/:slug`, served by `apps/landing` (Next.js). Cartless server-side, campaign-scoped, powered by `src/modules/sales_campaigns/campaigns.public.*`. **We do not touch, reuse, or import from it.**
   - **Storefront Website** = `faitlynhair.com` / `pixiegirl.ng` (and brand equivalents). A **separate app** (`apps/storefront`) with its own routes, its **own persistent cart** (`shared.carts`), and its own checkout path under a **new** `src/modules/storefront/*` public surface.
   - They share the **Sales order engine** (`salesService.createOrder`) and the **payment rails**, nothing else.

2. **One codebase per brand, deployed per host.** Brand is resolved from the hostname → `X-Brand-Context`, exactly like `apps/landing/middleware.ts`. No brand-switcher in the website.

3. **Studio is the source of truth** for branding, theme tokens, navigation, pages/templates, SEO, socials, logos/favicons/OG, and popups. The website renders from published Studio config at SSR. Studio has **nothing to do with admin (ERP) appearance.**

4. **Browser, not PWA.** SSR website. No service worker, no install prompt, no offline.

5. **NGN is canonical; USD is first-class.** Prices are stored in both. GeoIP picks the **display** currency; checkout charges **NGN or USD via Nomba** (Stripe added as a second rail, see §6). Never recompute historical money with a live FX rate.

6. **No assumptions about pricing math** — the backend composes the final `effective_price_ngn` and `effective_price_usd` per variant; the frontend only displays.

7. **Permission-aware + four states everywhere** (loading skeleton, empty+CTA, error+retry, permission-denied). The API enforces; the UI hides what the user can't do.

---

## 1. Topology & deployment

```
apps/
  admin/        # ERP admin (Vite/React/TS) — Storefront STUDIO lives here as a module
  landing/      # Sales Campaign Landing (Next.js) — /sale/:slug — DO NOT TOUCH
  storefront/   # NEW — the Storefront Website (from Aura), per-brand by host
```

**Why a new `apps/storefront` (not editing Aura in place):** Aura currently lives at `client folder for hub-system/Reference Node.js E-commerce Platform` and is the documented *engineering reference to clone and simplify* (see `CLAUDE.md`). We clone it into `apps/storefront`, strip Supabase, and rewire to Hub. The reference folder stays as reference.

**Stack (kept from Aura):** TanStack Start (React 19 + Nitro SSR), Vite, file-based routing, TanStack Query v5, Zustand, Tailwind + CSS variable tokens, Framer Motion. Three.js optional (preloader only).

**Brand resolution (mirror `apps/landing/lib/brand.ts` + `middleware.ts`):**
- Map host → brand: `faitlynhair.com`/`www.faitlynhair.com` → `faitlynhair`; `pixiegirl.ng` → `pixiegirl`. Table-driven from `shared.business_config.storefront_domain`.
- Inject `X-Brand-Context: <brand>` on every Hub API call (server-side fetch in Nitro; never trust the client to set it).
- Local dev: `?brand=` query override + `VITE_STOREFRONT_BRAND` env.

**Kill-switch:** `business_config.storefront_enabled = false` → the website serves a branded "coming soon" (still themed from Studio), all catalogue/checkout endpoints return 404/`STOREFRONT_DISABLED`.

---

## 2. The two surfaces, side by side (so no one mixes them)

| Concern | Sales Campaign Landing (`apps/landing`) | Storefront Website (`apps/storefront`) — NEW |
|---|---|---|
| URL | `sale.<brand>` / `/sale/:slug` | `<brand>.com` (root) |
| Backend | `sales_campaigns/campaigns.public.*` | `storefront/*` (new public surface) |
| Cart | client-only `lib/cart-store.ts` | **persistent `shared.carts`/`cart_items`** |
| Catalogue | only products attached to a campaign | full live `styled_products` catalogue |
| Browse axes | the drop's products/bundles | **Shades, Collections, Bundles, individual wigs** |
| Checkout | `campaigns.public.service.checkout()` | **new** `storefront.service.checkout()` (mirrors the flow, own path) |
| Order engine | `salesService.createOrder` | `salesService.createOrder` (same) |
| Pages/theme | campaign builder fields | **Storefront Studio** (themes/pages/nav) |
| Accounts | none | **customer auth + account area** |

The website's checkout **reuses the proven sequence** from `campaigns.public.service.checkout()` (contact upsert → address save+snapshot → resolve cart to variant lines server-side → delivery zone quote → `createOrder` → payment link → outbox), but as its **own** function in `storefront.service.js`. Copy the *shape*, not the *campaign coupling*.

---

## 3. Supabase removal (do this first, in `apps/storefront`)

**Delete:**
- `src/integrations/supabase/**` (client, auth-middleware, types, generated).
- `supabase/**` (migrations, config) at the Aura root.
- Every `src/lib/*.functions.ts` that calls `supabase.rpc(...)`: `orders.functions.ts`, `bookings.functions.ts`, `services.functions.ts`, `site-content.functions.ts`, plus Supabase calls inside `auth.tsx`, `wishlist.ts`, `products.ts`, `currency.tsx`, `site-content.ts`, `use-site-content.ts`, `bundles.ts`, `pricing.ts`.
- `lovable-error-reporting.ts` / Lovable-specific error capture (replace with Hub error reporting or remove).

**Replace** each with a Hub API call via a single typed client (`src/lib/api.ts`, modeled on `apps/landing/lib/api-client.ts`): base URL from env, `X-Brand-Context` injected server-side, credentials `include` for the httpOnly refresh cookie, error envelope mapping to `AppError` shape (`code`, `userMessage`).

**Acceptance:** `grep -ri supabase apps/storefront/src` returns nothing; `package.json` has no `@supabase/*`.

---

## 4. Data model additions (migrations)

All brand tables are templates in `migrations/template/*.sql.template` (`{{BUSINESS}}` substituted at bootstrap + applied to existing brands by `repair-business-schema.js`). Shared tables are numbered `migrations/000xxx_shared_*.sql`.

### 4.1 Shades (browse-by-shade) — **brand template** `000062_business_styled_shades.sql.template`
Per your spec:
```sql
CREATE TABLE IF NOT EXISTS {{BUSINESS}}.styled_shades (
  shade_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shade_code      TEXT NOT NULL,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL,                 -- SEO URL, unique per brand (live rows)
  short_description TEXT,
  long_description  TEXT,                         -- "how to blend it" body
  cover_media_id  UUID REFERENCES {{BUSINESS}}.product_images (image_id) ON DELETE SET NULL,
  cover_image_url TEXT,
  display_order   SMALLINT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ                      -- Trash/Restore parity
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_{{BUSINESS}}_styled_shades_slug_live
  ON {{BUSINESS}}.styled_shades (slug) WHERE deleted_at IS NULL;
ALTER TABLE {{BUSINESS}}.styled_products
  ADD COLUMN IF NOT EXISTS shade_id UUID
    REFERENCES {{BUSINESS}}.styled_shades (shade_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_{{BUSINESS}}_styled_products_shade
  ON {{BUSINESS}}.styled_products (shade_id) WHERE is_deleted = false;
```
One shade per styled product. A shade page lists all live styled products with that `shade_id`. (Catalogue admin gets a Shades tab; out of scope here but the FK + repo are.)

### 4.2 Customer auth — **shared** `000242_shared_customer_auth.sql`
Columns `storefront_password_hash` + `storefront_email_verified` already exist on `shared.contacts` (migration `000003`). Add only the supporting tables:
```sql
CREATE TABLE shared.customer_sessions (         -- refresh-token rotation
  session_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id     UUID NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,             -- sha256 of the cookie value
  user_agent     TEXT, ip INET,
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_sessions_contact ON shared.customer_sessions (contact_id) WHERE revoked_at IS NULL;
CREATE TABLE shared.customer_email_tokens (     -- verify + password reset
  token_hash     TEXT PRIMARY KEY,
  contact_id     UUID NOT NULL REFERENCES shared.contacts (contact_id) ON DELETE CASCADE,
  purpose        TEXT NOT NULL CHECK (purpose IN ('verify_email','reset_password')),
  expires_at     TIMESTAMPTZ NOT NULL,
  consumed_at    TIMESTAMPTZ
);
```

### 4.3 Stripe rail — **no migration needed** (schema already supports it)
- `shared.payment_gateways.provider` already includes `'stripe'` (`000116_shared_payment_gateways`) with per-brand encrypted `credentials_enc` + `supported_currencies`, and `000115_business_stripe_payment_method` already added the `'stripe_card'` sales method. **So there is no Stripe DDL to write.**
- What's outstanding for Stripe is **code only** (Phase 2): a `stripe` provider in `payment-link.service` + a `POST /api/webhooks/stripe` handler (see §6.4).
- The Studio toggle that picks the active provider **per brand, national vs international** persists in the existing gateway config (`payment_gateways.is_active`/`role` + `business_config` payment settings) — no new table.

### 4.4 Studio extensions — **shared** `000243_shared_storefront_studio_ext.sql`
The theme tokens already cover colours/typography/logo/favicon (JSONB in `storefront_themes.tokens`). Add structured surfaces for the features you asked for:
```sql
-- Popups (newsletter + others) with triggers, Studio-managed
CREATE TABLE shared.storefront_popups (
  popup_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business     TEXT NOT NULL REFERENCES shared.business_config (business_key) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('draft','published','archived')),
  popup_key    TEXT NOT NULL,                    -- 'newsletter','exit_intent','promo','age_gate'
  trigger_type TEXT NOT NULL CHECK (trigger_type IN
                 ('time_delay','scroll_depth','exit_intent','page_load','add_to_cart')),
  trigger_value INTEGER,                         -- seconds | % | null
  audience     TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','new','returning','guest','member')),
  content      JSONB NOT NULL DEFAULT '{}',      -- heading, body, image_url, cta, coupon_code, fields
  display_rules JSONB NOT NULL DEFAULT '{}',     -- frequency cap, pages, schedule window
  display_order SMALLINT NOT NULL DEFAULT 0,
  created_by   UUID REFERENCES shared.users (user_id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ, published_by UUID REFERENCES shared.users (user_id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_storefront_popups_pub ON shared.storefront_popups (business, popup_key) WHERE status='published';
CREATE UNIQUE INDEX idx_storefront_popups_draft ON shared.storefront_popups (business, popup_key) WHERE status='draft';

-- Reusable section/template library entries the Studio offers when composing pages
CREATE TABLE shared.storefront_section_templates (
  template_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,             -- 'hero_split_v1','shade_grid_v1','testimonial_carousel_v1'
  category     TEXT NOT NULL,                    -- 'hero','grid','editorial','social_proof','cta','faq'
  display_name TEXT NOT NULL,
  description  TEXT,
  preview_image_url TEXT,
  default_slots JSONB NOT NULL DEFAULT '{}',     -- starter content the editor clones
  is_active    BOOLEAN NOT NULL DEFAULT true,
  display_order SMALLINT NOT NULL DEFAULT 0
);
```
SEO + socials are already in `storefront_pages` (`meta_*`, `og_image_url`) and `storefront_navigation.socials`. Logos/favicons/OG default live in `business_config` (`logo_path`, `favicon_path`) and `storefront_themes.tokens`. The Studio just exposes them (see §9).

---

## 5. Backend — public Storefront API

New/extended files under `src/modules/storefront/` (the module exists; we expand it). All routes mounted under `/api/public/storefront/*` (catalogue/cart/checkout/account) and `/api/public/...` for the already-built analytics/branding/geo. Brand resolved by `brandHint()` (host → header/query), same guard as the sale page.

### 5.1 Catalogue (public, no auth, cache-friendly)
```
GET  /api/public/storefront/products            ?page&page_size&shade&collection&q&sort
GET  /api/public/storefront/products/:slug      → detail (gallery, variants, size_tiers, lace_sizes, size_guide)
GET  /api/public/storefront/shades              → list (browse-by-shade)
GET  /api/public/storefront/shades/:slug        → shade page + its styled products
GET  /api/public/storefront/collections         → list
GET  /api/public/storefront/collections/:slug   → collection + members
GET  /api/public/storefront/bundles             → live bundles (valid window)
GET  /api/public/storefront/bundles/:slug       → bundle detail (components, role core/gift)
GET  /api/public/storefront/content/:type/:slug → care guides / blog
```
- **Product detail** returns the **exact shape** `campaigns.public.service.getProductDetail()` already produces, plus the USD twin: each variant carries `styled_variant_id`, colour (name/hex/premium), size (code/label/premium + circumference), lace (code/label/premium), `effective_price_ngn`, **`effective_price_usd`**, `is_default`; plus `size_tiers`, `lace_sizes`, and `size_guide {title, guide_md, video_url}` from `catalogue_config`. Reuse `styledVariantsRepo.listVariants` (already composes both currencies after your `000061`).
- **Filtering** = live + visible only: `status='live' AND is_visible_storefront=true AND is_deleted=false`. Categories hidden when `catalogue_config.categories_enabled=false`.
- **Gallery is styled-only** (never base/factory shots) — same rule the sale page enforces.

### 5.2 Cart (persistent — this is where the website differs from landing)
Backed by `shared.carts` + `shared.cart_items` (already exist: guest via `session_token`, one active cart per `(contact_id, business)`, holds `display_currency`, `fx_rate_used`, `applied_coupon_id`, `delivery_address_id`, abandonment fields).
```
POST   /api/public/storefront/cart                 → create/get cart (sets guest cookie sf_cart=<session_token>)
GET    /api/public/storefront/cart
POST   /api/public/storefront/cart/items           {styled_variant_id|bundle_id|product_id, quantity, unstyled?}
PATCH  /api/public/storefront/cart/items/:id       {quantity}
DELETE /api/public/storefront/cart/items/:id
POST   /api/public/storefront/cart/merge           (called after login; merges guest cart → contact cart)
POST   /api/public/storefront/cart/coupon          {code}  (validate via couponService, store applied_coupon_id)
```
- Line snapshots (`product_name_snapshot`, `variant_label_snapshot`, `thumbnail_url_snapshot`, `unit_price_ngn`, `unit_display_price`, `display_currency`) at add time; **re-priced server-side at checkout** (never trust snapshots for charging).
- New repo `src/modules/storefront/cart.repo.js`; service `cart.service.js`. Soft FKs to brand schema validated in service.

### 5.3 Checkout (own path; mirrors the proven sale sequence)
`POST /api/public/storefront/checkout` → `storefront.service.checkout()`:
1. Load the cart; require items.
2. **Contact upsert + address save/snapshot** — copy from `campaigns.public.service.checkout()` (find-or-create by phone/email, `contact_type` adds `'customer'`, clear-default-then-add `delivery` address inside a SAVEPOINT, `address_type='delivery'`).
3. **Resolve cart → variant order lines server-side** (styled → base variant for stock, price = `price_override_ngn` else anchor + colour + size + lace; bundles via `resolveBundleForCheckout`-equivalent). **Prices never trusted from client.**
4. **Delivery fee** via `zonesService.quote({ brand, country_code: zoneCode, qty: wigUnits })` where `zoneCode = addr.zone_code || addr.country_code`. **No geocoding.** Pickup = free. Unresolved zone → 0 ("calculated at fulfilment").
5. `salesService.createOrder({ brand, user:{user_id:null}, request_id: idempotency_key, input:{ contact_id, sales_channel:'storefront', order_type:'dispatch', lines, shipping_fee_ngn, coupon_code, redeem_points?, utm_* , client_idempotency_key } })`.
6. **Currency snapshot** on the order: `display_currency`, `display_total` (USD = `total_ngn / usd_fx_rate`, ceil), `fx_rate_used` = brand `catalogue_config.usd_fx_rate` (the storefront analogue of the campaign's `ngn_per_usd_rate`).
7. `paymentLink.createPaymentLink({ brand, order_id, currency, preferred_provider })` — routing in §6.4.
8. Return `{ order_id, order_number, payment_url, public_tracking_token }`. On gateway failure: order persists in `pending_payment`, idempotency-safe retry (same as sale page).
9. **Outbox does the rest** (invoicing, accounting, logistics auto-delivery, retention points/streak, timeline `payment_received`, comms). Already wired in `markPaid` → outbox dispatcher; the storefront order flows through it unchanged because it's a normal `sales_order`.

`POST /api/public/storefront/cart/quote` → server-authoritative quote (subtotal, discounts, delivery, total, in both currencies) for the cart page, mirroring `quoteCart`.

### 5.4 Currency & geo (already built — just consume)
```
GET /api/public/geo/currency      → { country_code, currency, rate_to_ngn?, charge_currency }
```
Driven by `geoip.lookupCountry(ip)` + geo-currency middleware. Website calls this at SSR to pick **display** currency; the toggle in the header overrides and persists in a cookie. For non-NG display in USD, amounts = `price_usd` columns (not FX-converted NGN) when present, else NGN ÷ `usd_fx_rate`.

### 5.5 Delivery quote (preview before checkout)
```
GET /api/public/storefront/delivery/quote   ?zone_code|country_code&qty
```
Thin wrapper over `logistics/zones.service.quote`. Used by the cart/checkout to show the fee live as the buyer fills Country/State/City (City/State → `zone_code` via the brand's seeded zones; no map, no geocoding).

### 5.6 Reviews, services, account, analytics
- **Reviews:** `GET /products/:id/reviews` (approved only), `POST /reviews` (auth or verified-purchase token) → `shared.product_reviews` (moderation queue in ERP). Photos allowed.
- **Services:** `GET /services`, `GET /services/:slug` → `shared.service_offerings` (dual-currency, `whats_included`, `faqs`, deposit). `POST /services/:slug/booking-request` → `shared.service_booking_requests`. **Stylist Programme** = a linked directory section only (badge directory; the stylist site `stylist.<brand>` is future).
- **Analytics:** already exist — `POST /api/public/analytics/sessions|page-views|funnel-events`. Fire from the website (UTM + funnel).
- **Account** (auth-gated): orders, order detail + timeline, addresses CRUD, wishlist, loyalty/points, referrals, preferences (see §7/§8.7).
- **Studio published config (public read):** `GET /api/public/storefront/site` → published theme tokens + navigation + the page's template_key/slots + SEO/OG + active popups for the requested path. One call hydrates the SSR shell.

### 5.7 Install/Care hub (Q-A = A)
Keep the existing `GET /api/public/install-hub/:token` as a **post-purchase wig install & care page** (care guides + WhatsApp), **hide the nearby-stylists block** until the stylist site exists. No code change beyond gating the stylists array to `[]` for now.

---

## 6. Pricing, currency & payments

### 6.1 Variant price composition (display)
- NGN: `effective_price_ngn = COALESCE(price_override_ngn, retail_price_ngn + colour.premium_ngn + size.premium_ngn + COALESCE(lace.premium_ngn,0))`.
- USD: `effective_price_usd` composed identically from the USD columns added in `000046` + `000061` (`retail_price_usd`, `price_override_usd`, `premium_usd` on colour/size/lace). `listVariants` already returns both — the API just forwards them.

### 6.2 Display currency
GeoIP default (NG→NGN, else USD) + header toggle (cookie-persisted). Money rendered via the `MoneyText` equivalent; USD figures use `price_usd`, NGN figures use `price_ngn`. No client-side FX math.

### 6.3 Charge currency
- NG delivery address → **NGN**.
- Non-NG → **USD**, amount = `total_ngn ÷ catalogue_config.usd_fx_rate` (ceil to whole dollars), recorded as `display_total` + `fx_rate_used` on the order (so realised-FX posts correctly in `addPayment`).

### 6.4 Gateway routing + Studio toggle (Q-D = B, build Stripe now)
- **NGN:** buyer picks among the brand's enabled national rails (Nomba default, Paystack fallback).
- **USD/International:** **Nomba** (it settles USD today) **or Stripe** (new rail).
- **Studio toggle** persists per brand, **national and international independently**: e.g. National = {Nomba primary, Paystack fallback}; International = {Nomba | Stripe}. The public checkout only renders allowed rails; the server re-enforces the allow-set (same defensive pattern as `allowed_payment_gateways` on campaigns).
- **Build Stripe** as a provider in `payment-link.service` + a `POST /api/webhooks/stripe` handler that mirrors the Nomba webhook (signature verify → re-verify against Stripe API → `recordGatewayPayment` → `addPayment` → `markPaid`). Reuse the existing webhook-dedup table (`000205_shared_webhook_dedup`).

---

## 7. Customer auth module (`src/modules/customer_auth/`)
Backed by `shared.contacts.storefront_password_hash` + the tables in §4.2.
```
POST /api/public/auth/register     {email, password, first_name?, phone?}  → create/attach contact, send verify email
POST /api/public/auth/login        {email, password} → access JWT (memory) + httpOnly refresh cookie
POST /api/public/auth/refresh      (rotates refresh token)               → new access JWT
POST /api/public/auth/logout       (revokes session)
POST /api/public/auth/verify-email {token}
POST /api/public/auth/forgot       {email}   → reset email
POST /api/public/auth/reset        {token, password}
GET  /api/public/auth/me           → current customer profile
```
- **Token model (Hub canon):** access JWT in memory (short TTL), refresh in **httpOnly, Secure, SameSite=Strict** cookie; rotation on refresh; `customer_sessions` tracks/revokes. **Never localStorage.**
- **Scope:** customer principal = `contact_id`, `record_scope='own'` — can only read their own orders/addresses/loyalty/wishlist.
- **Guest-first:** accounts are optional. Account creation **suggested at checkout**, and if skipped, a **post-purchase one-tap "save your details"** prompt on the thank-you page (Lovable-style). Guest cart **merges** into the account cart on login (§5.2).

---

## 8. Storefront Website frontend (`apps/storefront`, from Aura)

### 8.1 Routes (file-based; Aura's tree, rewired)
```
src/routes/
  __root.tsx              # SSR shell: theme tokens → CSS vars, header/footer from Studio nav, popups host
  index.tsx               # Home — renders storefront_pages('home') template + slots
  shop.tsx / shop.$category.tsx   # full catalogue listing (category only if categories_enabled)
  shades.tsx / shades.$slug.tsx   # NEW — browse by shade; shade page lists its styled products
  collections.tsx / collections.$slug.tsx
  bundles.tsx / bundles.$slug.tsx
  product.$slug.tsx       # product detail: colour swatches + size boxes + lace boxes → styled_variant_id
  services.tsx / services.$slug.tsx + stylist-programme section/link
  cart.tsx                # persistent cart (shared.carts)
  checkout.tsx            # delivery (Country/State/City→zone, no map), currency, gateway, pay
  checkout.thank-you.tsx  # order confirmation + "save your details" prompt + install/care link
  track.$token.tsx        # order tracking from sales order + sanitised timeline
  install.$token.tsx      # post-purchase care hub (guides + WhatsApp; stylists hidden for now)
  auth.tsx (login/register/forgot/reset)
  _authenticated/         # account area (orders, addresses, wishlist, loyalty, referrals, preferences)
  about / contact / journal / policies.* / sitemap.xml
```
**Browse axes (Q-C = A):** Shades, Collections, Bundles, and individual wigs each get **storefront-website** pages (these are *website* pages, not the campaign landing).

### 8.2 Data layer (replaces every Supabase call)
- `src/lib/api.ts` — typed Hub client (host→brand server-side, credentials include, error envelope).
- `src/lib/queries.ts` — TanStack Query hooks, **entity-scoped query keys** include brand + currency: `['products', brand, filters]`, `['product', brand, slug]`, `['cart', brand, cartId]`, etc. Mutations invalidate.
- Replace `products.ts`→catalogue API; `currency.tsx`→`/geo/currency` + toggle; `cart.tsx`→cart API (key on `styled_variant_id`); `wishlist.ts`→wishlist API; `bundles.ts`/`pricing.ts`→server `effective_price_*` (delete client pricing math); `auth.tsx`→customer_auth; `*.functions.ts`→REST.

### 8.3 Theming (from Studio)
- SSR fetches `GET /api/public/storefront/site` → injects `storefront_themes.tokens` as CSS variables in `__root.tsx` (`--color-primary`, `--color-accent`, `--font-heading`, `--radius`, spacing scale…), **two token sets (light/dark)**; header toggle, default follows system. Never inline a hex/font/radius — tokens only.
- Logo/favicon/OG from tokens + `business_config`.

### 8.4 Pages from templates + slots (Q-11 = A+B)
- Each `storefront_pages.template_key` maps to a React template component in `src/components/templates/<key>.tsx` that reads typed `slots`. **A** = fixed templates + slots (current schema). **B-lite** = the Studio offers a **library of section templates** (`storefront_section_templates`) the editor picks and orders into a page's `slots.sections[]` — a simple, guided composer (not a free-form canvas). Keep UX dead-simple.

### 8.5 Product detail UX (Q-3)
- **Boxes, not dropdowns:** colour swatches (hex), size boxes (with circumference tip + the `size_guide` modal from `catalogue_config`), lace boxes (`styled_lace_sizes.description`). Selecting all three resolves to one `styled_variant_id`; price = that variant's `effective_price_<currency>`. "Buy unstyled" toggle uses the anchor price.
- Gallery = styled images; per-colour images swap on swatch select.

### 8.6 Header / preloader (your earlier specs)
- **Header:** mobile = logo centered + slightly larger (never overflows container); left = currency + light/dark toggle; right = account icon + cart icon. Balanced/responsive across breakpoints. All from Studio nav + tokens.
- **Preloader:** 2s logo shimmer + gold iris reveal; per-session gating; respects `prefers-reduced-motion`. (Aura's `CinematicPreloader` already matches — keep it, feed it the Studio logo.)

### 8.7 Retention & account (Q-18 = A, full engine)
Surface progressively in the account + relevant pages: loyalty (points/tier from `customer_loyalty_state`), referrals (`referrals`/`referral_redemptions`), coupons, bundles, wishlist (`customer_wishlists`), hair-quiz (`hair_quizzes`), newsletter (popup → contact + `source`), reviews, streak-stars. Plus everything in the PRD §6.4 customer-account list (orders, tracking, cancellation request, addresses, preferences).

### 8.8 Order tracking (Q-13/Q-15)
- Orders **always** land in `sales_orders` (channel `storefront`) and appear in the **Sales → Orders** tab — guaranteed because checkout calls `createOrder`.
- Customer tracking page `track.$token.tsx` reads the sales order + **sanitised `order_timeline_events`** by `sales_orders.public_tracking_token`. Real-time updates over Socket.io room keyed by the token.

---

## 9. Storefront Studio frontend (in `apps/admin` as a module)

Route: `apps/admin/src/modules/storefront-studio/`. Permission key `storefront_studio` (actions view/edit/approve), per `studio.routes.js`. **Opens as a full-screen overlay** covering the entire app/screen for ample design space on mobile and desktop.

**Tabs:**
1. **Theme** — colour palette (light + dark), typography (heading/body/mono from `shared.font_catalog`), buttons (radius/style), spacing scale. Live preview pane. Writes `storefront_themes` draft.
2. **Pages & Templates** — pick a page (home/about/…); choose a `template_key`; compose sections from the **template library** (`storefront_section_templates`) — pick a section, pick which content/colours from the palette, reorder, edit slot content; preview. Writes `storefront_pages` draft.
3. **Navigation** — header items (hierarchical), footer columns. Writes `storefront_navigation` draft.
4. **SEO & Socials** — per-page `meta_title`/`meta_description`/`og_image_url`; brand socials; **share preview** that renders what a WhatsApp/IG/X link card looks like (OG image + title + description). Upload OG banner.
5. **Branding** — logo, alt logo, favicon, OG default uploads (to S3 via existing storage service → `business_config.logo_path`/`favicon_path` + tokens).
6. **Popups** — create/edit popups (`storefront_popups`): type (newsletter/exit-intent/promo/age-gate), trigger (time/scroll/exit/page-load/add-to-cart), audience, content, frequency cap, schedule.
7. **Publish & Revisions** — draft vs published diff, one-click publish (archives current, promotes draft, snapshots to `storefront_revisions`), rollback.

**Studio UX:** draft autosave; "Preview as live" opens the storefront in a frame with the draft config; publish gated by `approve` permission.

### 9.1 Studio backend extensions (`src/modules/storefront_studio/`)
Add to the existing routes:
```
GET/PUT/POST  /branding            (logo/favicon/og uploads → storage; persist to business_config + tokens)
GET/PUT/POST  /popups + /popups/:key/publish
GET           /section-templates   (library for the page composer)
GET           /seo (per page) — already covered by /pages, add /share-preview helper if needed
```
Plus the **public read** `GET /api/public/storefront/site` (§5.6) that serves the *published* theme/nav/page/popups to the website (60s cache).

---

## 9.5 Retention module — Admin frontend (Phase 2.5)

**Why this exists.** The backend `retention` module is **fully built** (`src/modules/retention/*`: loyalty, streak stars, coupons, bundle offers, wig subscriptions, retention workflows, referrals — plus the public hair-quiz/referral endpoints). The module is even registered in the admin nav (`apps/admin/src/lib/modules.ts` → `key:"retention"`, `route:"/retention"`, group `people`). **But there is no page and no route** — `/retention` currently falls through to `ModulePlaceholder`. Phase 2.5 builds that management surface so staff can run loyalty/coupons/bundles/subscriptions/workflows from the ERP. (This is the **admin** side; the customer-facing retention UI on the website is Phase 3, §8.7.)

**Permission key:** `retention`, actions `view` / `create` / `edit` / `delete` / `approve` (exactly as the routes enforce via `requirePermission("retention", action)`). The UI hides controls the user lacks; the API re-enforces.

**Entity scope:** brand-scoped like every admin module — `X-Brand-Context` from the active business store; every TanStack Query key includes `brand`.

### 9.5.1 File layout (mirror the Marketing module)
```
apps/admin/src/lib/retention-api.ts        # typed client + TanStack hooks (model on marketing-api.ts)
apps/admin/src/pages/retention/
  RetentionPage.tsx                         # tab shell (model on MarketingPage.tsx)
  LoyaltyTab.tsx                            # tiers + per-customer points (redeem/adjust)
  StreakTab.tsx                             # streak tiers + per-customer stars (award)
  CouponsTab.tsx                            # coupon CRUD + activate + validate tester
  BundlesTab.tsx                            # bundle offers CRUD + components + price preview + activate
  SubscriptionsTab.tsx                      # plans CRUD + subscriptions (enrol/pause/resume/cancel)
  WorkflowsTab.tsx                          # retention workflow rules CRUD + manual trigger + activate
  parts.tsx                                 # shared small components (status pills, money cells, drawers)
```

### 9.5.2 Route registration
- `apps/admin/src/router.tsx`: add a `lazyWithRetry` import for `RetentionPage` and a `{ path: "retention", element: <Suspense><RetentionPage/></Suspense> }` route inside the authenticated `AppShell` children (next to `marketing`, group `people`). `modules.ts` already has the nav entry — no change there.
- Gate the whole page behind `retention:view`; render `DeniedState` if absent.

### 9.5.3 API client (`retention-api.ts`)
Mirror `marketing-api.ts`: `const api` from `@/lib/api`, `useBrand()` from `useBusinessStore`, `Paginated<T>` envelope, hooks below. All mounted under `/api/v1/retention`. Mutations `invalidateQueries` on the matching list key.

| Surface | Hooks (query / mutation) | Endpoint |
|---|---|---|
| Loyalty | `useLoyaltyTiers()` · `useCustomerLoyalty(contactId)` · `useRedeemPoints()` · `useAdjustPoints()` | `GET /loyalty/tiers` · `GET /customers/:id/loyalty` · `POST …/redeem` (edit) · `POST …/adjust` (approve) |
| Streak | `useStreakTiers()` · `useCustomerStreak(contactId)` · `useAwardStars()` | `GET /streak/tiers` · `GET /customers/:id/streak` · `POST …/streak/award` (approve) |
| Referral | `useCustomerReferral(contactId)` | `GET /customers/:id/referral` |
| Coupons | `useCoupons(filters)` · `useCoupon(id)` · `useCreateCoupon()` · `useUpdateCoupon()` · `useSetCouponActive()` · `useValidateCoupon()` | `/coupons` (GET/POST/PATCH) · `PATCH /coupons/:id/active` · `POST /coupons/validate` |
| Bundles | `useBundles()` · `useBundle(id)` · `useCreateBundle()` · `useUpdateBundle()` · `useSetBundleActive()` · `usePriceBundle()` · `useAddBundleComponent()` · `useRemoveBundleComponent()` · `useDeleteBundle()` | `/bundles` (GET/POST/PATCH/DELETE) · `…/active` · `…/price` · `…/components` |
| Subscriptions | `usePlans()` · `useCreatePlan()` · `useUpdatePlan()` · `useSetPlanActive()` · `useSubscriptions()` · `useEnrol()` · `usePauseSub()` · `useResumeSub()` · `useCancelSub()` | `/subscriptions/plans*` · `/subscriptions*` · `…/pause` · `…/resume` · `…/cancel` |
| Workflows | `useWorkflows()` · `useCreateWorkflow()` · `useUpdateWorkflow()` · `useSetWorkflowActive()` · `useTriggerWorkflow()` | `/workflows*` · `PATCH …/active` · `POST /workflows/trigger` (approve) |

Query keys: `['retention','coupons',brand,filters]`, `['retention','bundle',brand,id]`, `['retention','loyalty',brand,contactId]`, etc.

### 9.5.4 Tabs (detail)

**Loyalty tab** (`retention:view`)
- **Tiers panel:** read-only cards from `GET /loyalty/tiers` (name, threshold, earn rate, perks). KPI tiles: members, points outstanding (from state where available).
- **Customer lookup:** a contact picker (reuse the existing contact-search used elsewhere in admin) → `GET /customers/:id/loyalty` shows current balance, tier, and the **ledger** (earn/redeem history).
- **Actions:** "Redeem points" drawer (`retention:edit` → `…/redeem`, points + notes) and "Adjust points" drawer (`retention:approve` → `…/adjust`, signed amount + reason) — adjust is hidden unless `approve`. Money/points in **JetBrains Mono** via the `money`/number formatter.

**Streak Stars tab** (`retention:view`)
- Tiers from `GET /streak/tiers`; per-customer state from `GET /customers/:id/streak` (current stars, streak window, next reward).
- "Award stars" drawer (`retention:approve` → `…/streak/award`: action_type, amount/qty, reference, description). Manual award is approve-gated.

**Coupons tab** (`retention:view`)
- **List/table** from `GET /coupons` (code, type %/fixed, value, min spend, usage/limit, valid window, status pill). Pagination via `keepPreviousData`.
- **Create/Edit** drawer (`create`/`edit`) with Zod-validated form matching `coupon.validator` (code, discount type/value, caps, window, applies-to). Money fields via `MoneyText` semantics (NGN, 2dp strings).
- **Activate/deactivate** toggle → `PATCH /coupons/:id/active`.
- **Validate tester:** a small inline form → `POST /coupons/validate` (code + cart subtotal) showing the computed discount; lets staff sanity-check a code without a real order. `view`-level.

**Bundle offers tab** (`retention:view`)
- **List** from `GET /bundles` (name, components count, bundle price NGN + USD if set, savings vs sum-of-parts, active pill).
- **Create/Edit** drawer (`create`/`edit`): name, description, bundle price, validity. Then a **components editor** inside the detail: add component (`POST /bundles/:id/components` — product/styled target + role core/gift + qty), remove (`DELETE …/components/:componentId`). `edit`-gated.
- **Price preview:** `POST /bundles/:id/price` renders the server-computed effective price + discount (never client-side math), shown live as components change.
- **Delete** (`retention:delete`) with confirm.

**Subscriptions tab** (`retention:view`)
- **Plans sub-section:** list `GET /subscriptions/plans`; create/edit drawer (`create`/`edit`); activate toggle (`…/plans/:id/active`). Fields per `subscription.validator` (interval, price, included items).
- **Subscriptions sub-section:** list `GET /subscriptions` (customer, plan, status pill, next renewal). State transitions as buttons: **Pause** / **Resume** / **Cancel** (`edit`; pause/cancel take a reason). Enrol drawer (`create` → `POST /subscriptions`) with contact picker + plan select.

**Workflows tab** (`retention:view`)
- **List** `GET /workflows` (name, trigger, audience, action, active pill, last run from executions if surfaced).
- **Create/Edit** drawer (`create`/`edit`) per `workflow.validator` (trigger type, conditions, action). Activate toggle (`…/active`).
- **Manual trigger** button (`retention:approve` → `POST /workflows/trigger`) with a confirm — run a rule on demand for a segment/customer.

> **Hair Quiz / Referral codes:** the hair-quiz has only **public** endpoints today (`GET/POST /api/public/hair-quiz`) and referral has a per-customer read + public validate — there is **no admin CRUD** for quiz definitions yet, so they are **out of scope for this tab set**. Surface referral data read-only inside the Loyalty/customer view (`GET /customers/:id/referral`). Building quiz authoring is a separate backend task (flag in `docs/CONFORMANCE_GAPS.md`), not part of Phase 2.5.

### 9.5.5 Cross-cutting (mandatory)
- **Four states** on every tab: loading skeleton, empty + CTA, error + retry (`ErrorState`), permission-denied (`DeniedState`).
- **Permission-aware**: create/edit/delete/approve controls hidden without the matching `retention` action; page hidden without `view`.
- **Money** via `MoneyText`/`money` (NGN-based, 2dp strings, JetBrains Mono). Show USD only where the backend returns a USD figure (bundles) — never recompute.
- **Realtime (optional):** `retention.events.js` already emits domain events; subscribe to the `brand:<brand>:retention` Socket.io room to live-refresh lists (same pattern as other modules) — nice-to-have, not blocking.
- **Design canon:** Maroon Noir tokens, glassmorphic drawers/menus, the 10-question gate in `docs/FRONTEND_INSTRUCTION_MUST_READ.md`. Clone/simplify the loyalty UI from `client folder for hub-system/Reference Node.js E-commerce Platform` where it has equivalents (`src/components/loyalty`, `src/pages/loyalty`).

### 9.5.6 Acceptance
- `/retention` renders a real tabbed page (no `ModulePlaceholder`); nav entry resolves.
- Every backend retention endpoint above is reachable from the UI with correct permission gating.
- Create/activate/transition flows invalidate their lists; four states verified on each tab; money in NGN (+USD where present) with no client-side recompute.

---

## 10. Seeding (Q-12 = A)
- **Faitlyn:** seed a **published** `storefront_themes` row from the current Aura design — exact colours, Playfair Display / Montserrat / JetBrains Mono, logo/favicon/OG — plus a published `storefront_navigation` and `storefront_pages` (home + standard pages) and the default `storefront_section_templates`. On build, the website renders pixel-close to today's Lovable design.
- **Pixie Girl:** seed a distinct theme variant (its palette/logo). Both fully editable in Studio afterward.
- Seed scripts live alongside `migrations/000015_shared_seed_data.sql` patterns / a `scripts/seed-storefront.js`.

---

## 11. Phased delivery plan

**Phase 0 — Foundations**
- Migrations §4 (shades `000062` template, customer auth `000242`, studio ext `000243`). **Stripe needs no migration** — schema already supports it. Run `db:migrate:shared` + `db:repair` for existing brands.
- `apps/storefront` scaffold from the Aura reference (`client folder for hub-system/Reference Node.js E-commerce Platform`); **Supabase fully removed** (§3); Hub API client + brand host routing.

**Phase 1 — Catalogue read-only**
- Public catalogue endpoints (§5.1) incl. shades/collections/bundles + `effective_price_usd`.
- Website: home (static slots), shop, product detail (boxes), shade/collection/bundle pages, currency display via GeoIP. Four states everywhere.

**Phase 2 — Cart + checkout + payments**
- Persistent cart (§5.2), delivery quote (no geocoding), checkout (§5.3) → `createOrder` → Nomba (NGN+USD).
- **Stripe rail** + webhook (§6.4). Studio gateway toggle (national/international).
- Thank-you + order tracking (timeline) + install/care hub.

**Phase 2.5 — Retention module Admin frontend** (see §9.5)
- Build the missing `/retention` admin module in `apps/admin` so staff can manage the already-built backend (loyalty, streak stars, coupons, bundles, subscriptions, retention workflows, referrals). Tabbed page + typed API client + four states + permission gating. This is the ERP-side management surface; the customer-facing retention UI is Phase 3.

**Phase 3 — Accounts + retention**
- customer_auth (§7), account area, wishlist, loyalty, referrals, reviews, services + booking requests, hair-quiz, newsletter/popups, analytics.

**Phase 4 — Storefront Studio**
- Studio frontend (all tabs, §9) + backend extensions; share/OG preview; popups; publish/revisions.
- Seed Faitlyn + Pixie Girl themes (§10). Switch the website to render fully from published Studio config.

**Phase 5 — Hardening**
- Perf/caching, SEO/sitemap, accessibility, four-states audit, e2e (Playwright) for browse→cart→checkout→track, load test checkout, security review of customer-auth + webhooks.

---

## 12. Acceptance criteria (per surface)
- **Separation:** zero imports between `apps/landing` and `apps/storefront`; `/sale/:slug` untouched; storefront orders show channel `storefront`.
- **No Supabase** anywhere in `apps/storefront`.
- **Pricing:** product page shows correct NGN and USD per variant from the API; no client FX math; history immutable.
- **Checkout:** NG→NGN, non-NG→USD, both via Nomba; Stripe selectable when toggled; order lands in Sales → Orders; outbox fires invoicing/accounting/logistics/retention/timeline/comms.
- **Delivery:** fee resolved by zone_code/country_code + qty, no geocoding; pickup free.
- **Studio:** edits in draft, publish snapshots a revision, website reflects published config within cache TTL; full-screen overlay; SEO/OG share preview accurate.
- **Auth:** httpOnly refresh + in-memory access; guest checkout works; guest cart merges on login.
- **Four states** on every screen; permission-aware controls in Studio.

---

## 13. Open items / future (not in this build)
- Stylist site `stylist.<brand>` (install hub currently hides the nearby-stylists block).
- `product_bundles` (Sales Campaigns) USD columns — flagged, out of scope.
- WooCommerce/Jumia channel sync (schema has `channel_external_ids`; service not built).
