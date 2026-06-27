
Big build. Splitting into 6 workstreams, each shippable on its own. I'll ship them in this order so the site stays buildable at every step.

---

### 1. Hero overlay (quick win)
- Add a darker layered overlay on `Hero.tsx` background (deepen the existing `from-ink/70 via-ink/30 to-ink` to `from-ink/90 via-ink/55 to-ink` + a flat `bg-ink/35` wash on the image). Text untouched.

---

### 2. Deep SEO pass

**Per-route head metadata** (canonical + og:url + og:image + JSON-LD):
- `__root.tsx` — sitewide defaults (Organization JSON-LD, og:site_name, twitter:card, theme-color). Remove leaf-level things from root.
- `/` — WebSite + Organization JSON-LD with `searchAction`. Hero image as og:image.
- `/shop` — title/desc/og + ItemList JSON-LD of products.
- `/shop?shade=<slug>` — **dynamic head() reads search params**: `Title — Faitlyn Hair Catalogue`, custom description, canonical to `/shop?shade=<slug>`, og:image swatch tile (CSS swatch is dynamic so we use a category hero), CollectionPage JSON-LD with shade-filtered ItemList. Title: "Blacky by Nature Wigs — Pixie Hair in Black | Faitlyn".
- `/shop/$category` — CollectionPage JSON-LD + filtered ItemList.
- `/product/$slug` — Product JSON-LD (offers, brand, image, sku, aggregateRating placeholder), BreadcrumbList, FAQPage JSON-LD from product FAQ.
- `/about`, `/contact`, `/journal`, `/policies/cancellation` — distinct title/desc/canonical/og.

**Sitemap + robots:**
- Convert `public/sitemap.xml` (if static) to dynamic `src/routes/sitemap[.]xml.ts` server route generating entries from PRODUCTS + CATEGORIES + SHADES + services + static routes. Cache 1h.
- `public/robots.txt`: `User-agent: * / Allow: /` + (deferred) Sitemap directive until domain is set.

**OG image strategy:**
- Use existing hero/product/category hero images as og:image. No generic placeholders.
- All canonical + og:url are **relative paths** (no project URL yet).

**Run scan:** trigger `seo_chat--trigger_scan` after edits land.

---

### 3. Content override layer (hybrid)

New table `site_content_overrides`:
```
key         text primary key      -- e.g. "why_choose", "artistry:pixie-curly-bob", "faq:bundles.pixie-trio"
scope       text                  -- "global" | "collection" | "product"
scope_id    text                  -- null for global, slug otherwise
value       jsonb                 -- arbitrary shape, validated client-side against the matching TS type
updated_by  uuid references auth.users
updated_at  timestamptz
```
- RLS: anon SELECT (public reads), only admins (via `has_role`) can write. Adds `app_role` enum + `user_roles` + `has_role()` (per platform rules).
- Server fn `getSiteContent({ keys: string[] })` returns merged overrides → component falls back to `site-content.ts` defaults when no override exists.
- New helper `resolveContent<T>(defaults, override)` deep-merges.
- Wire into: `WhyChooseFaitlyn`, `ProductArtistry`, `ProductFAQ`, `ShopByShade`, `Hero` copy block, `EditorialSplit`, `FounderNote`.
- This *prepares* for Studio without building it — defaults still render today.

---

### 4. Bundles (separate from collections)

You're right — bundle price is the final price; the saving should be **visible**. I'll model:

```ts
// src/lib/bundles.ts
type Bundle = {
  slug: string;            // "pixie-trio-bundle"
  name: string;            // "Pixie Trio Bundle"
  productSlugs: string[];  // ["pixie-curly-bob","blonde-mary-pixie","icy-grey-pixie"]
  priceUsd: number;        // bundle price
  priceNgn: number;
  // computed at render: compareAt = sum(member.price); savings = compareAt - price; pct = savings/compareAt
};
```
- New `BundleCard` displays: compare-at struck through, bundle price, "Save $X (15% off)" badge, "Includes 3 wigs" list.
- "You may also love" logic on product page:
  1. If product is in any bundle → show that bundle first with **"Included in our [Bundle Name] — save $X together"** CTA.
  2. Then same-collection products.
  3. Then category fallback.
- "Included in bundle" cue on product page (small badge near price): `Part of the Pixie Trio Bundle · Save $120 when bundled`.
- Bundles section on `/shop` and standalone `/bundles` route.

---

### 5. Services + Booking (full)

**Schema (one migration):**
```sql
create type service_location as enum ('studio','home','virtual');

create table public.services (
  id uuid pk, slug text unique not null,
  name text not null,
  short_description text,
  long_description text,
  thumbnail_url text,
  tags text[] default '{}',
  meta_title text, meta_description text,
  price_ngn numeric, compare_at_price_ngn numeric, price_is_from boolean default false,
  duration_minutes int, buffer_minutes int default 0,
  required_stylist_tier text,
  is_bookable boolean default true,
  is_visible_storefront boolean default true,
  is_featured boolean default false,
  deposit_required boolean default false, deposit_pct numeric, deposit_amount_ngn numeric,
  location_type service_location default 'studio',
  cancellation_policy text,
  published_at timestamptz,
  created_at, updated_at
);

create table public.bookings (
  id uuid pk,
  user_id uuid references auth.users,
  service_id uuid references services,
  scheduled_at timestamptz not null,
  duration_minutes int not null,
  location_type service_location not null,
  address jsonb,
  customer_name text, customer_email text, customer_phone text,
  notes text,
  deposit_amount_ngn numeric, deposit_paid boolean default false,
  status text default 'pending_deposit', -- pending_deposit|confirmed|cancelled|completed
  cancellation_reason text,
  created_at, updated_at
);
```
- GRANTs + RLS: services public SELECT where `is_visible_storefront and published_at is not null`; admin all. Bookings: user can see own; admin all; insert requires `auth.uid()`.
- Trigger for `updated_at`.
- Seed 3-4 example services.

**Storefront:**
- `/services` — list cards (thumbnail, name, short_description, "From ₦X" when `price_is_from`, compare-at strikethrough).
- `/services/$slug` — full page (long_description rich text, gallery, pricing, location pill, duration, cancellation policy, "Book now").
- `BookingDrawer` — date/time picker (24h slots respecting `buffer_minutes`), customer details form, location selector (if applicable), deposit summary, "Pay deposit & confirm" (wires to selected payment provider stub from prior turn).
- Add `/services` to header nav.

**SEO:**
- Service JSON-LD per page, `Service` + `Offer` types.
- Sitemap includes published services.

---

### 6. Sequencing

1. Migration (services + bookings + site_content_overrides + user_roles + has_role).
2. After approval: code in this order — types regen → hero overlay → SEO heads + sitemap → bundles → content overrides → services storefront → booking drawer → trigger SEO scan.

---

### Notes
- This is ~14 files created + ~10 edited. I'll batch parallel where possible.
- Studio admin UI is *not* in this plan — only the data foundations so it ships without rework later.
- "Live" payments for booking deposits stay UI-only (selector + status update) until you wire Stripe/Paystack/Nomba keys.
- Currency switcher continues to apply across all product/service prices.
