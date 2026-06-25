# V2.2 Conformance Gaps

**Last verified:** 2026-06-08 (see `VERIFICATION_REPORT.md`).

> **Status change.** The original Bucket A/B/C gaps in this file were all
> **shipped to migrations** (see `migrations/CHANGELOG.md`). The schema is
> now essentially fully V2.2-conformant. The live gap class is no longer
> _schema_ gaps — it is **application-layer wiring lag**: schema (and often
> routes) are in place, but the service logic that uses them is incomplete.
> This file now tracks that queue.

---

## Part 1 — Original gap buckets: SHIPPED ✅

Per `migrations/CHANGELOG.md`, all of the following landed:

| Bucket               | Items                                                                                                                                                                                                                                                                                                                                                                                                                                             | Where                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A (cheap mismatches) | A-1 loyalty thresholds, A-2 stylist tiers, A-3 KPI sum-to-100 CHECK, A-4 POS idempotency key, A-5 wishlist, A-6 strive→opay, A-7 payment-fee accounts (9-way split), A-8 cancellation defaults verified                                                                                                                                                                                                                                           | `template/000020/000034/000035`, `000008/000010/000015` |
| B (missing features) | B-1 Cash Request (6.32), B-2 installment `payment_model`, B-3 Streak Stars, B-4 Hair Quiz, B-5 UGC + self-hosted video, B-6 Public Order Form, B-7 storefront analytics, B-8 Curated Delivery Letter + Install Hub, B-9 per-gateway fees, B-10 full e-signature                                                                                                                                                                                   | `000100/000101`, `template/000016/000019/000036/000037` |
| C (architecture)     | C-1 RLS **policies** (Option A, full) shipped to `000200`; **app-layer GUC wiring was missing → RLS was inert until R-1 (2026-06-11)** — now wired for write/transaction paths, read-side one-shot enforcement is the remaining step (see `HUB_VS_PIXIE_DEEP_VERIFICATION.md` + `ENTITY_ISOLATION.md`). C-2 field-level privacy (restricted views), C-3 soft-FK reconciliation **(schema only — no sweep yet)**, C-4 strive-connect drift removed | `000200/000202`, `template/000038`                      |

**Schema is therefore conformant.** What remains is to _use_ it.

---

## Part 2 — Live queue: application-layer wiring lag

These have schema (and sometimes routes) but incomplete service logic.
Ordered roughly by leverage / dependency.

### P1 — Finance correctness — ✅ SHIPPED 2026-06-08

All six built in one pass (app layer; schema was already in place). New
migration: `000111_shared_cash_request_threshold` (CEO threshold column).

| ID  | Item                                      | State   | What landed                                                                                                                                                                                                                                                   |
| --- | ----------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-1 | **`payment_model` behaviour** (sales 6.2) | ✅ done | Deposit-triggered flips to `in_production` at the deposit threshold + emits `order.deposit_met`; layaway reserves stock on placement and releases on pay/cancel; `layaway-abandonment` + `layaway-reminders` crons implemented (read `installment_settings`). |
| W-2 | **Invoicing dual-currency** (6.5)         | ✅ done | Auto-invoice carries `display_currency` / `display_subtotal` / `display_total` / `fx_rate_used` from the source order.                                                                                                                                        |
| W-3 | **Accounting Cash Flow statement** (6.6)  | ✅ done | `GET /accounting/reports/cash-flow` — direct method by source_type into operating/investing/financing, reconciled to opening/closing cash.                                                                                                                    |
| W-4 | **AR/AP ageing report** (6.6)             | ✅ done | `GET /accounting/reports/ar-ageing` + `/ap-ageing` — 0–30/31–60/61–90/90+ buckets off live `balance_due_ngn`, per customer/supplier.                                                                                                                          |
| W-5 | **Multi-currency gain/loss** (6.6)        | ✅ done | `accounting.postFxGainLoss` posts realised FX (4910/5910) when a non-NGN sales payment settles at a rate differing from the order's booked rate.                                                                                                              |
| W-6 | **Cash Request module** (6.32)            | ✅ done | Full draft→submit→finance→[ceo]→disburse→settle (+cancel) over `shared.cash_requests`; threshold routing; mandatory `bank_transaction_id`; GL posting on disburse; auto-creates an Expense for direct spends; state history.                                  |

### P2 — Customer-facing revenue surfaces — ✅ SHIPPED 2026-06-08

Retention, storefront, studio and the install hub are now functional app
layers over the existing schema.

| ID   | Item                               | State   | What landed                                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-7  | **Retention module** (6.23)        | ✅ done | Loyalty engine (earn on `order.paid`, redeem, manual adjust, tier recompute), Streak Stars (rule-driven award + caps), referral codes + redemption with referrer reward, Hair Quiz (public fetch/submit + recommender + lead capture + star award). `order.paid` subscriber wires earns. |
| W-8  | **Storefront module** (6.4)        | ✅ done | Public catalogue read API (products/detail/categories/collections/content), no-login Public Order Form (contact upsert → `public_form` sales order → pay-link token), analytics ingestion (sessions/page-views/funnel-events). _Self-hosted UGC video pipeline still pending (W-13)._    |
| W-9  | **Storefront Studio** (6.28)       | ✅ done | Theme / navigation / pages draft→publish editor (`/api/v1/storefront-studio`), honouring the one-draft / one-published constraints; publish snapshots to `storefront_revisions` via trigger.                                                                                             |
| W-10 | **Install Hub composition** (6.10) | ✅ done | `GET /api/public/install-hub/:token` composes the order's items + matching wig-care guides + certified stylists near the delivery city + a pre-filled WhatsApp help link.                                                                                                                |

### P3 — Admin / structural — ✅ SHIPPED 2026-06-08

Preceded by a brand-registry refactor: the hardcoded `new Set(["pixiegirl",
"faitlynhair"])` copied into ~47 files is replaced by `src/config/brands.js`
(single live Set loaded from `business_config`, regex-guarded), so a new
brand goes live without code edits. New migrations: `000112` (email-signature
template column).

| ID   | Item                                 | State   | What landed                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W-11 | **"Add a new business" flow** (6.21) | ✅ done | `GET/POST /api/v1/business-setup/businesses` — `business-provision.service` validates the key, creates the schema, seeds `business_config`, applies every template, verifies table count, and `registerBrand()`s it live. Rolls back a half-built brand on failure. |
| W-12 | **Email-signature builder** (6.13)   | ✅ done | One brand template (`business_config.email_signature_template`, migration 000112) + per-staff render into `shared.email_signatures`. Endpoints under business-setup: GET/PUT template, list/get/PUT-generate per user (token merge, HTML-escaped).                  |
| W-13 | **Catalogue UGC video wiring** (6.4) | ✅ done | `GET /catalogue/products/:id/video-library` (ready `media_assets` videos) + `POST /products/:id/videos/from-media` attaches a self-hosted asset as a `direct_upload` product video (external_ref = asset_id, embed_url = storage_path). No schema change.           |

---

## Part 3 — Doc hygiene (cheap, do alongside)

- `SCHEMA.md` + `README.md` still say **35 migrations / 425 tables**.
  Actual is **51 migration files** (28 shared + 23 templates) after the gap
  buckets shipped. Re-run `npm run db:verify` and update the counts.

---

## Suggested order of attack

1. ~~**P1 finance (W-1…W-6)**~~ — ✅ SHIPPED 2026-06-08 (see table above).
2. ~~**P2 customer-facing (W-7…W-10)**~~ — ✅ SHIPPED 2026-06-08 (see table above).
3. ~~**P3 admin (W-11…W-13)**~~ — ✅ SHIPPED 2026-06-08 (see table above),
   preceded by the brand-registry refactor (`src/config/brands.js`).

**The W-1…W-13 wiring-lag queue is now fully cleared.** Brand-registry boot
wiring is also done: `refreshBrands()` runs at server startup (after
`initDatabase`) and at worker start, plus a 5-minute `brand-registry-refresh`
cron so a business provisioned by the API process reaches the worker's crons
without a restart.

**Media pipeline shipped 2026-06-08:** the `media-processing` BullMQ worker
now does real FFmpeg work — probe + transcode (H.264/AAC, ≤720p, faststart)

- poster/thumbnail — moving `media_assets` from `pending` → `ready`
  (`media.ffmpeg.js`, `media.repo.js`, `media-processor.js`). `media.service`
  (producer) registers uploads (`POST /catalogue/media`) and remote buffers and
  enqueues them; a `ugc-ingestion` cron drains `ugc_ingestion_queue` (direct_url
  downloads → asset → enqueue → `ready_for_moderation`; platform sources flagged
  for the social-API connector). The W-13 video-library reads the resulting
  `ready` assets.

Remaining follow-ups are operational only: the social-platform UGC connector
(Instagram/TikTok capture) and the doc-hygiene counts below.

---

## Part 4 — Known pricing inconsistencies (post-launch, deferred)

### G-1 — Sales-campaign discounts intentionally ignore the §6.25 margin floor

**Severity:** low (was: bundle-quote vs charge mismatch) · **Status:** RESOLVED
BY DECISION 2026-06-24.

**Original symptom.** The cart drawer / checkout-form total (the server
`/quote`) and the amount `createOrder` charged could disagree, because the two
paths applied the margin floor differently:

- **Quote** (`campaigns.public.service.js` → `priceQuoteLine`): bundle lines
  carried `floor_ngn: null` (campaign price baked in, unclamped), while styled /
  product lines fed a real `floor_ngn` into `computeDeals`, which clamped.
- **Charge** (`checkout` → `salesService.createOrder`): the campaign deal
  discount was routed through `applyOrderDiscount`, which clamps every
  order-level discount at each base variant's `min_price_ngn`.

So a styled bundle (or any line) with a high base-variant floor could be charged
**more** than the floor-free figure the buyer saw on the "Pay" button.

**Decision (owner, 2026-06-24).** Do **not** consider the margin floor anywhere
in the sales-campaign discount path. The buyer is always charged exactly the
quoted figure; a campaign may sell below the variant `min_price_ngn`. The rest
of the system is untouched — coupons, loyalty points, F-2 bundles and the
per-unit sale-price clamp all remain floor-respecting.

**What changed.**

- `sales.service.js` (§3.8 campaign deal ladder): `campaign_deal_discount_ngn`
  is now allocated against each line's **full remaining value** (down to ₦0),
  not the floor-limited headroom used by coupons/points/bundles.
- `campaigns.public.service.js` `priceQuoteLine`: styled / product lines now
  return `floor_ngn: null` (bundle lines already did), so `computeDeals` no
  longer clamps the quote. `resolveVariantFloor` was removed (no longer used).
- `computeDeals` itself is unchanged — it still clamps when a caller passes a
  `floor_ngn`; the campaign path simply stops passing one.

**Follow-up (optional, low priority).** Add a regression test that drives
`quoteCart` and `createOrder` on the same campaign cart (incl. a fixed-price
bundle) and asserts the final totals are equal — no test currently pins that
agreement (`campaigns.bundle-pricing.test.js` checks the pure math only;
`checkout-styled-bundle.test.js` never compares order total to the quote).

---

---

### G-2 — Position-ladder / bulk-tier discounts not computed on staff/POS/admin orders

**Severity:** medium · **Status:** DEFERRED 2026-06-25 (hotfix sprint).

**Problem.** The three-lane deal engine (`campaigns.deals.service.js`:
`computeDeals`) is only called from the **web checkout** path
(`campaigns.public.service.js → checkout()`). Staff-keyed orders (DM / POS /
admin `createOrder`), quote-to-order conversions, and instalment top-ups all
go directly to `salesService.createOrder`. That path calls `resolveDiscount`
(percentage / fixed / buy-X-get-Y), but never `computeDeals`, so:

- Position ladder (₦16 k 1st wig, ₦41 k 2nd wig, …) → **₦0**
- Bundle stacking bonus → **₦0**
- Bulk / reseller tiers (12+ raw wigs) → **₦0**

Affected orders are silently correct on quantity-tier or flat-percentage
campaigns, but wrong on ladder / bulk campaigns. The live dashboard shows
`discount_amount_ngn = 0` for every non-web order on ladder campaigns.

**Deferred rationale.** A correct fix must thread the campaign entity, cart
lines, and `computeDeals` result through `createOrder` without duplicating the
deal engine's already-tested logic. The `createOrder` interface currently
receives a `discount_amount_ngn` scalar from every caller — wiring the full
campaign context without breaking the seven other callers is a non-trivial
refactor. Shipped as a known gap because the web checkout (the live revenue
path) is correct; staff DM orders are a small fraction of volume and the
operator can see the shortfall in the dashboard.

**Correct long-term fix (for the engineering backlog).**

1. Add `campaign_cart?: CartLine[]` and `campaign_id?: string` to the
   `createOrder` input type.
2. When both are present, run `buildDealLines` + `computeDeals` inside
   `createOrderTx` and add the result to `campaign_deal_discount_ngn` (already
   a column on `sales_orders`).
3. Remove the now-redundant `discount_amount_ngn` parameter from callers that
   pass `campaign_cart` — let the service derive it.
4. Add an integration test covering a POS order on a ladder campaign to pin the
   behaviour.

---

### G-3 — Contact segment membership unimplementable (no junction table)

**Severity:** low · **Status:** DEFERRED 2026-06-25 (hotfix sprint).

**Problem.** `campaigns.validator.js` and the campaign builder accept
`segment_ids` on both the campaign schema and the discount schema, implying
that a campaign can target a specific contact segment (e.g. "VIP" only). But:

- `shared.contacts` has no `customer_segment_id` column.
- `contact_segments` (the segment-definition table) has no membership
  junction — there is nowhere to record which contacts belong to a segment.

Without membership data, the `resolveDiscount` segment-eligibility check
always falls through to "no segment restriction" (effectively targeting
everyone). The UI builder field for segment targeting is therefore cosmetic.

**Deferred rationale.** Correct implementation requires a new migration
(`shared.contact_segment_memberships(contact_id, segment_id, enrolled_at,
enrolled_by)`), a backfill script, and wiring the segment check in
`resolveDiscount`. Scheduled for the next sprint; in the meantime
`segment_ids` is accepted on schemas and stored, but has no runtime effect.

---

### G-4 — Gift "ship to recipient" is billed at the buyer's delivery zone

**Severity:** low · **Status:** DEFERRED 2026-06-25 (logistics hotfix).

**Problem.** `campaigns.public.service.js` §2b computes the delivery fee from
`input.contact.address` (the **buyer's** address) only. When a buyer sends a
gift with `ship_to_recipient: true`, the parcel ships to
`gift.recipient_address` but the freight is still priced against the buyer's
zone. A Lagos buyer gifting to the US is charged Lagos rates; the reverse
overcharges. The order still bills *a* fee (so it's not the ₦0 hole fixed in
the logistics hotfix), but the figure is for the wrong destination.

**Deferred rationale.** Correct fix is to resolve the fee against the
ship-to-recipient address when present (its own country/state/LGA zone), which
means the gift recipient form must capture a resolvable `zone_code` /
`country_code` the same way the buyer's address picker does — today the gift
recipient address is free-text (`line1/city/state/country`) with no zone
picker. Scoped as a follow-up to the logistics hotfix.

---

### G-5 — Delivery-fee-pending follow-ups (queue surfacing + zone free toggle)

**Severity:** medium · **Status:** OPEN 2026-06-25 (logistics hotfix follow-ups).

The logistics hotfix added a third delivery outcome — **pending**: a zone that
resolves to ₦0 with no explicit free-delivery marker (a config gap that "should
not happen"). Per owner decision the order is still taken (never lose the sale)
but flagged so the rate is confirmed and billed **before dispatch**. The flag
is written to the order: `internal_notes.delivery.fee_pending = true` plus a
"⚠ DELIVERY FEE PENDING" customer-note line. Two follow-ups make it actionable:

1. **Sales dashboard surfacing (REQUIRED).** "Bill it later" rots into "bill it
   never" without a visible queue — that is exactly how the ₦0 orders slipped
   through originally. The Sales views must show a badge/filter for orders with
   `delivery.fee_pending = true`, and ideally a one-click "set delivery fee"
   action. Until then the flag lives only in the order JSON.

2. **Admin zone builder toggle.** The API and DB now support
   `is_free_delivery` on `delivery_zones` (migration `template/000059`, repo +
   validator wired), so a brand *can* mark a zone free via the API — but the
   admin logistics UI has no toggle yet. Add the checkbox so free-delivery
   promos read "Free delivery" at checkout instead of falling into the pending
   queue.

---

See `migrations/CHANGELOG.md` for what shipped and `VERIFICATION_REPORT.md`
for the per-module evidence behind this list.
