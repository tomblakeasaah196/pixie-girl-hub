# Pixie Girl Hub — Frontend Engineering Guide (Final, Internal)

**Version:** 2.2 (final, v2.1 - v2.2 product-description additions integrated) · **Audience:** Frontend engineering team (and any AI coding agent they pair with) · **Status:** Build-ready
**Schema baseline:** the audited, verified-complete schema — **425 tables (107 shared + 2 × 159 per-brand)**, PostgreSQL 16 + pgvector 0.6.
**Companion source-of-truth documents:** the V2 Product Description (31 modules), the per-migration SQL files, and the two audit reports (`PixieGirl_Hub_Audit_Report.md`, `PixieGirl_Hub_Frontend_Coverage_Audit.md`). Where this guide and an older document disagree, **this guide wins** unless a migration file says otherwise — in which case the migration wins and you should flag the drift. This guide was made before the last meeting with client.

---

## 0. How to use this guide

### 0.1 The intended workflow

This document is written so that a frontend engineer — alone or pairing with an AI agent — can build **any single module flawlessly** by combining:

1. **This guide** (the global contract: architecture, design system, components, conventions, cross-cutting rules), plus
2. **The relevant module section** below (screens, tables, components, states, rules), plus
3. **The actual backend migration file(s)** for that module (the column-level truth — attach the specific `0000NN_*.sql` / `template/0000NN_*.sql.template`), plus
4. **The backend OpenAPI spec** for that module's endpoints (the request/response truth).

The guide deliberately does **not** restate every column of every table — that is what attaching the migration file is for, and columns change. Instead, for each module the guide names the **real tables** (verified against the schema), the **screens**, the **components**, the **states**, the **permission rules**, the **entity-scoping rules**, and the **business/validation rules** (including everything our audits surfaced). When you attach the migration file, the field-level detail is authoritative; this guide tells you what to _do_ with those fields.

### 0.2 Source-of-truth hierarchy (resolve conflicts in this order)

1. The **migration SQL** (table/column/constraint truth).
2. The **OpenAPI spec** (endpoint truth).
3. **This guide** (UI/UX/behaviour truth).
4. The **Product Description** (intent/scope truth).
5. The backend **Admin-UI Requirements** doc — **treat as advisory only**: it was written against the older 420-table schema and contains known errors (see §0.4). Do not wire to it blindly.

### 0.3 Non-negotiable global rules (these apply to every screen)

- **Entity scope on every call.** A single `activeEntity` value (`PXG` | `FLH` | `ALL`) lives in the global store and is attached to **every** API request. `ALL` is **CEO-only** and only powers the global dashboard and cross-entity reconciliation. Staff never see the other entity's data.
- **Server-side isolation is the only isolation.** The database does **not** use row-level security (audit finding H-1). Entity and field isolation are enforced **server-side** by the API. The frontend must therefore (a) always send entity context, (b) never attempt to fetch the other entity's data, and (c) never assume a hidden field is safe to request just because the UI hides it. Hide-in-UI is a courtesy, not a security boundary; the boundary is the API.
- **Permission-aware rendering on every screen.** Before rendering any create/edit/delete/approve control, check the user's grants from the `permissions` matrix (module × action × scope). If a user lacks `view`, the route guard blocks the screen; if they lack `edit`, render read-only; if they lack `delete`, hide the control. Never rely on the absence of a button as enforcement — the API re-checks.
- **Render config from the database; never hard-code business values.** Tier thresholds, KPI weights, tax rates, document prefixes, pipeline stages, service types, loyalty multipliers, currencies — all come from their config tables. Hard-coding any of these is a bug (see the canonical-decisions register, §0.5, for why this matters).
- **Workflow-gated writes go to `workflow_instances`, not the target table.** If an action is gated by a `workflow_definition` (e.g. a price change above a threshold, an expense above a manager's `approval_threshold_ngn`), the UI submits an approval request; it does not mutate the target record directly.
- **Audit every write.** Every create/edit/delete the UI performs results in a `shared.audit_log` row (written server-side). Surface "last edited by / at" wherever the table carries `updated_by`/`updated_at`.
- **Money is NGN-based with a display currency.** Every monetary record stores `*_ngn` as the source of truth plus a `display_currency` + `fx_rate_used` snapshot. The UI displays in the user's/customer's currency but the books are always NGN. Never compute a settlement figure client-side from a live rate — use the stored snapshot.

### 0.4 Known errors in the backend Admin-UI Requirements doc (do NOT inherit them)

The Admin-UI doc is useful for the Tier-1/2/3 "who edits this" classification, but it predates the schema audit and contains these concrete errors — wire to the **migration**, not the doc:

- It names a table **`fx_rates`**. The real table is **`shared.currency_rates`**.
- It says **`stylist_certifications`** tiers are "Bronze/Silver/Gold." They are not — see §0.5; render tier labels from config, not hard-coded.
- It says **`tax_rates`** holds "VAT, WHT, PAYE, pension, NHF." In reality VAT/WHT live on **`shared.business_config`** (`vat_rate`, `wht_rate`) and PAYE/pension/NHF live in **`{brand}.payroll_deductions`**; `shared.tax_rates` is a separate, narrower table. Read each value from its real home.
- It states "Total tables: 420 (104 shared + 158 × 2)." The audited schema is **425 (107 + 2 × 159)**. The five added tables (`storefront_content_posts`, `ai_insight_service_match`, `timeline_event_codes`, `permission_module_keys`, and the `channel_external_ids`/`channel_sync_state` columns on `product_variants`) each need UI and are specified in this guide.

### 0.5 Canonical-decisions register (resolve BEFORE building the affected screen)

These are real inconsistencies our audits found across the spec, seed, and docs. The frontend stance is always **"render from the DB."** But the underlying data must be made canonical or the UI will display contradictory numbers. Flag each to the product owner; until resolved, build the screen to read config and do not hard-code.

| #   | Conflict                                                                                                                                                                                                                                                                                                                                                                                                                                               | Canonical stance for the frontend                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | **Loyalty tier thresholds.** Product Description: Bronze 0–499 / Silver 500–1,999 / Gold 2,000–4,999 / Platinum 5,000+. Seed: 0 / 5,000 / 25,000 / 100,000.                                                                                                                                                                                                                                                                                            | Read thresholds, names, multipliers, and benefits **from `shared.loyalty_tiers`** and render them. Never hard-code. Surface the seeded values in the Retention admin so the owner can correct them. The owner must pick one canonical set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D-2 | **Stylist tier names.** Spec: Certified / Pro / Elite. Schema comment: certified / senior / master. Admin doc: Bronze/Silver/Gold.                                                                                                                                                                                                                                                                                                                     | Render the label for `stylist_partners.current_tier_key` from a tier config/lookup, not a hard-coded map. Use the spec's **Certified / Pro / Elite** as the seed labels and flag for confirmation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D-3 | **KPI weights must sum to 100.** The database does **not** enforce this (audit L-1, proven live: a 5th KPI pushed the sum to 110 silently).                                                                                                                                                                                                                                                                                                            | The **KPI-definition editor UI is the only guard.** It must block save unless the sum of active `weight_pct` for the brand equals exactly 100, with a live running total. Non-negotiable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D-4 | **E-signature.** The guide's Documents screen promises an e-sign flow + signature builder, but **no signature tables exist** in the schema (audit M-1).                                                                                                                                                                                                                                                                                                | Build the e-sign UI behind a feature flag and mark it **BLOCKED ON BACKEND**; it cannot ship until signature tables + endpoints exist. See §Documents and §Appendix C (backend dependencies).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D-5 | **Hair Quiz.** Spec'd as lead-gen + stars capture; **no quiz tables exist** (audit M-2).                                                                                                                                                                                                                                                                                                                                                               | Build the quiz UI; mark **BLOCKED ON BACKEND** until quiz tables/endpoints exist. See §Storefront native engines and §Appendix C.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D-6 | **Streak Stars as a distinct ★/lifetime-discount layer.** Spec sells stars + lifetime-discount tiers (Rising Star→Galaxy) and earn-actions (IG follow, UGC-upload boost, etc.). Schema has the conventional points+multiplier model only (audit M-3).                                                                                                                                                                                                  | Render the loyalty programme from `loyalty_tiers` + `loyalty_ledger`. Where the spec's star-specific earn-actions or lifetime-discount semantics exceed what the ledger's `transaction_type` enum and tiers support, mark those specific behaviours **BLOCKED ON BACKEND** and flag. Do not fake a discount the Pricing floor can't honour.                                                                                                                                                                                                                                                                                                                                                                          |
| D-7 | **Payment-fee pass-through (v2.1+).** Gateway fees (Paystack/Opay 1.5% capped ₦2,000; Nomba ~0.5% capped ₦500; Stripe 3.4% + $0.30 **uncapped**) are **absorbed into the published price** by the Pricing engine (gross-up formula: `gross = (net + fixed_fee) ÷ (1 − pct_fee)`, then charm-rounded up, cap-aware). Customer sees one clean total. Books still record the real fee.                                                                    | The Pricing UI owns the math and displays per-channel/per-currency net+gross; the checkout never shows a separate "processing fee" line. **Three context-specific rules the UI must reflect:** (i) **IC bypass** — inter-company wholesale (PXG→FLH) is direct-bank settlement, no gateway fee, no gross-up; (ii) **Opay-fallback delta absorbed** — if Paystack fails mid-checkout and the system falls over to Opay, the small fee delta is absorbed silently, never re-quoted to the customer; (iii) **International prices look visibly higher** than naive FX conversion because Stripe's fee is uncapped — surface this clearly in the channel-price grid as the honest cost of accepting international cards. |
| D-8 | **Manual payment recording — separation of duties (v2.2+).** Capability is **built** but **OFF at launch**. The CEO currently doubles as Finance; allowing staff-recorded manual payments without an independent Finance lead would collapse separation of duties (the same person taking the cash could mark the order paid). Every customer payment goes through Paystack/Opay/Nomba/Stripe at launch — the gateway is the independent confirmation. | The Sales order detail screen must include the **Record Manual Payment** action button, but it is **hidden** unless `business_config.allow_staff_manual_payments` (or equivalent server flag) is true. When toggled ON (the day Finance is hired), the button reveals itself with no code change. Same audit-anchor pattern as Cash Request: mandatory bank transaction ID, optional receipt upload, feeds Bank Reconciliation.                                                                                                                                                                                                                                                                                      |

---

## 1. Foundations

### 1.1 Framework & stack

- **Admin (the Hub):** React PWA. Browser-based, installable on phone/tablet. Offline-capable where specified (POS especially).
- **Storefront:** React with **server-side rendering (Next.js)** for SEO. Code-split, lazy-loaded, CDN-fronted, tuned for Nigerian 3G/4G.
- **Stylist portal:** lightweight React app (can share the storefront's Next.js project or be a separate SPA), scoped to the `hub_stylist` API role.
- **Client state:** Zustand (global, synchronous app state — entity context, auth, UI).
- **Server state:** TanStack Query (all API data — caching, invalidation, optimistic updates).
- **Styling:** design tokens (CSS variables) + utility classes. No component library lock-in; build the primitives once (§1.6) and reuse.
- **Real-time:** Socket.io (WebSocket) for live messaging, notifications, stock updates, and dashboard tiles.
- **Forms:** a single form system (§1.6.4) with schema-driven validation that mirrors the API's payload schema.
- **Charts:** one charting lib (recharts or chart.js) wrapped in a `<Chart>` primitive so dashboards/analytics stay consistent.
- **Maps:** for geofences, clock-in pins, courier tracking — a single `<MapView>` wrapper (MapLibre/Leaflet) so the map provider is swappable.

### 1.2 App architecture & full route map (corrected & complete)

This is the authoritative Hub route tree. **Bold** routes are new or expanded relative to the original guide (closing audit gaps G-1, G-2, G-3).

```
/login → /verify-2fa → /select-entity
/app (authenticated shell: top bar + collapsible sidebar)
├─ /home                 Command Center (App Grid + Alerts) — default landing
├─ /dashboard            Metrics: global (CEO, entity=ALL) OR entity (staff)
│
│  SELLING
├─ /sales                Sales & Quotations (6.2) — incl. **installment-payment workbench** per order
├─ /crm                  CRM & Pipeline (6.1)
├─ /pos                  Point of Sale (6.3)
├─ /ecommerce            E-Commerce admin (6.4)  ├─ /products /orders /collections /discounts /reviews /ugc-curation /content-posts /channel-sync **/public-form-config**
│
│  FINANCE
├─ /invoicing            Invoicing & Billing (6.5) — partial-payment-aware
├─ /accounting           Accounting & Finance (6.6)        [CEO/Finance]
├─ /expenses             Expense Management (6.7)
├─ **/cash-requests**    **Cash Request & Disbursement (6.32) — NEW** ├─ /cash-requests/my ├─ /cash-requests/queue (Finance) ├─ /cash-requests/approval (CEO)
│
│  INVENTORY & MOVEMENT
├─ /purchasing           Purchasing & Imports (6.8)
├─ /stock                Stock SSOT (6.9)
├─ /logistics            Logistics & Delivery (6.10)       ├─ /logistics/couriers (config) ├─ **/logistics/letters (curated delivery letter queue)**
├─ /production           Production & Landed Cost (6.24)   ├─ /production/service-jobs (Faitlyn)
├─ /pricing              Pricing Engine (6.25)             — fee gross-up per channel/currency
│
│  PEOPLE
├─ /hr                   HR & Payroll (6.11)                ├─ /hr/attendance (6.11.1) ├─ /hr/commission ├─ /hr/appraisal ├─ /hr/payroll
├─ /contacts             Contacts & Directory (6.12)
├─ /org-builder          Org & Workflow Builder (6.27)      [CEO]
│
│  MARKETING & RETENTION
├─ /marketing            Marketing & Email Campaigns (6.15/6.16)
├─ /social               Social Media Management (6.14)
├─ **/campaigns**        **Sales Campaigns & Landing Pages (6.22)** — flash-sale builder, 3-state
├─ **/retention**        **Customer Retention & Loyalty (6.23)** — full admin (NEW; closes G-1)
│      ├─ /retention/loyalty        (tiers, points economy)
│      ├─ /retention/coupons        (coupon engine)
│      ├─ /retention/subscriptions  (subscription plans)
│      ├─ /retention/bundles        (bundle offers)
│      ├─ /retention/maintenance    (maintenance plans — Faitlyn)
│      ├─ /retention/workflows      (post-purchase / reorder / win-back / birthday automations)
│      ├─ /retention/referrals      (referral programme rules + dashboard)
│      └─ /retention/analytics      (CLV, repeat rate, churn, MRR, coupon ROI — 6.23.7)
│
│  COMMUNICATION & CONTENT
├─ /smartcomm            Messaging (6.17)
├─ /documents            Documents & Signatures (6.13)      [e-sign flow = D-4, behind flag]
├─ /calendar             Calendar & Scheduling (6.18)
├─ /tasks                Tasks & To-Do (6.19)
│
│  PARTNERS
├─ /stylists             Stylist Partner Programme (6.26)    [PXG; mgmt = Marketing, quality = Ops]
├─ **/retail-partners**  **Retail/Consignment Partners** (NEW; closes G-3) ├─ /retail-partners/settlements
│
│  STOREFRONT & AI
├─ /storefront-studio    Storefront Studio (6.28)            [CEO]
│      ├─ /timeline-vocabulary   (order timeline codes editor)
│      └─ **/letter-templates**  **(curated delivery letter template editor — NEW v2.2)**
├─ /ai-control           AI Control & Governance (6.31)      [CEO]
│
└─ /settings             Business Setup + profile/security (6.21)
       ├─ /settings/profile /settings/security /settings/notifications
       ├─ /settings/business           (business_config, currencies, FX, gateways incl. **Opay** + primary/fallback, **gateway fee schedules**, tax, geofences, funding rates, **installment defaults**, **manual-payment toggle D-8**)
       ├─ /settings/custom-fields      (custom_field_defs)
       ├─ /settings/document-numbering (document_numbering)
       ├─ /settings/bank-accounts      (bank_accounts)
       ├─ /settings/reports            (report_templates — scheduled weekly reports)
       └─ /settings/roles → deep-link to /org-builder

+ Praxis floating button (global, all /app screens) → chat drawer · 6.29
+ Notification feed (top-bar bell, all screens) · 6.30 — includes Service-Match insights inbox
/logout
```

**Public routes (no login, no /app prefix):**

```
/order                                  Public Order Form (no-login checkout for IG/FB/WhatsApp orders) — v2.1+
/pay/{order_token}                      Public pay-link landing — installment payment against an order (v2.2+)
/install/{order_token}                  Curated install hub (QR target on the printed letter) — v2.2+
/track/{order_token}                    Public order timeline (existing)
/verify/badge/{badge_token}             Stylist badge verification (existing)
/sale/{campaign_slug}                   Flash-sale landing page (Campaigns 6.22, existing)
```

All public routes use the existing `public_tracking_token` (or campaign/badge tokens) — no new token tables.

**Sidebar grouping** (per the spec's "Look and Feel"): Sales · Operations · Finance · People · Marketing · Communication. The top bar shows the **entity switcher** (PXG/FLH/ALL), **global search** (cross-record, permission-scoped), **notification bell**, and the **Praxis** launcher.

### 1.3 Auth & guard model

- **`/login`** → email + password. On success and if 2FA enabled → **`/verify-2fa`** (TOTP/OTP). Tables: `shared.users`, `shared.user_sessions`, `shared.refresh_tokens`.
- **`/select-entity`** → for users with access to more than one entity (the CEO). Single-entity users skip this; their entity is set automatically. Sets `activeEntity` in the store.
- **Route guards:** a guard HOC/wrapper checks (1) authenticated session, (2) module `view` permission for the route, (3) entity access for the active entity. Failing (1) → `/login`; failing (2)/(3) → a permission-denied state (§1.13), not a crash.
- **Token handling:** access token in memory; refresh token via httpOnly cookie. Silent refresh on 401; on refresh failure → `/login`. Never store tokens in localStorage (XSS exposure) — and note artifacts/PWA storage rules: use in-memory + httpOnly cookie only.
- **2FA management** lives in `/settings/security` (manage 2FA, active sessions via `user_sessions`, "sign out everywhere" revokes `refresh_tokens`).

### 1.4 Entity-context model (critical)

- One global `activeEntity` (`PXG` | `FLH` | `ALL`) in Zustand. Changing it via the top-bar switcher **does not change the route** — it reloads the data for the current screen under the new scope (invalidate all TanStack Query caches keyed by entity).
- Every query key includes `activeEntity`. Every mutation sends it (header `X-Entity` or path/param per the OpenAPI contract — follow the spec).
- `ALL` is **CEO-only**, enforced server-side; the switcher only offers `ALL` if the user has cross-entity access. `ALL` is read-only aggregation (global dashboard, inter-company reconciliation) — you cannot create records in `ALL` scope; the UI forces an entity choice for any write.
- **Per-brand schema reality:** the two brands live in separate Postgres schemas (`pixiegirl`, `faitlynhair`); shared tables carry a `business` discriminator. The frontend doesn't see schemas — it sees the entity scope. The API maps entity → schema. Because there's no DB RLS, **the API is the only thing stopping a cross-entity leak**; the frontend's job is to always pass scope correctly and never request `ALL` for a non-CEO.

### 1.5 Design system & tokens

Two token sets share one system: **Hub (ERP)** = clean, dense, professional, fast to scan; **Storefront** = expressive, branded, conversion-focused (defined in §Storefront). Both are driven by CSS variables so brand identity (`business_config.accent_colour`, `brand_fonts`, `logo_path`) can theme per entity.

**Core token groups** (define as CSS variables; never inline hex):

- **Colour:** `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--text-muted`, `--primary` (from `accent_colour`), `--primary-contrast`, plus semantic `--success`, `--warning`, `--danger`, `--info`. Each with hover/active/disabled variants.
- **Typography:** `--font-sans` (UI), `--font-display` (headings; from `brand_fonts`), a type scale (`--text-xs … --text-2xl`), line-heights, weights.
- **Spacing:** a 4px-based scale (`--space-1 … --space-12`).
- **Radius/shadow/elevation:** `--radius-sm/md/lg`, `--shadow-1/2/3`.
- **Motion:** `--ease`, `--dur-fast/normal/slow`; respect `prefers-reduced-motion`.
- **Z-index scale:** `--z-base/drawer/modal/popover/toast` to prevent stacking bugs.

**Per-entity theming:** wrap the app in a theme provider that injects the active brand's tokens. PXG and FLH differ in accent/logo/fonts; switching entity re-themes the shell.

### 1.6 Component library — primitives (build once, reuse everywhere)

The whole Hub is ~70% these primitives + the DataTable + the Drawer/Form pattern. Build and harden these first.

#### 1.6.1 Layout

- **`AppShell`** — top bar (entity switcher, global search, bell, Praxis, profile menu) + collapsible grouped sidebar + content area. Responsive: sidebar collapses to icons, then to a drawer on mobile.
- **`PageHeader`** — title, breadcrumb, primary action button(s), filter affordances.
- **`Card` / `Section` / `Tabs` / `SplitPane`** (two-pane list+detail for Smartcomm, Documents, etc.).

#### 1.6.2 Display

- **`DataTable`** — the workhorse (full spec §1.7).
- **`Drawer`** (right-side detail/edit panel — the dominant edit pattern), **`Modal`** (confirmations, small forms), **`Popover`**, **`Tooltip`**.
- **`StatusPill`** / **`Badge`** (state machines render as colour-coded pills), **`Avatar`**, **`EmptyState`**, **`Skeleton`** loaders.
- **`Chart`** wrapper, **`KpiTile`** (number + delta + sparkline), **`Timeline`** (vertical step timeline for order/state history), **`MapView`**.
- **`MoneyText`** — formats a `*_ngn` value into the active display currency using the stored rate; always shows NGN on hover/secondary line for financial screens (see §1.11).
- **`MaskedField`** — for gateway keys, account numbers, PINs (never render the raw value).

#### 1.6.3 Inputs

Text, number, currency, select, multi-select, combobox (typeahead, for product/contact pickers), date/time, date-range, toggle, checkbox, radio, file upload (with progress; used for documents, product images, UGC, receipts), rich-text (for product descriptions, blog body, email templates), tag input, color picker (Storefront Studio), slider (Pricing sensitivity).

#### 1.6.4 Form system

- Schema-driven: a form is configured from a schema that mirrors the endpoint's `payload_schema` (types, required, enums). Render fields, validate client-side, submit, map server validation errors back to fields.
- **`FormSection`**, **`FieldRow`**, **`SaveBar`** (sticky; dirty-state aware; disabled until valid; shows "saving…/saved/error").
- **Custom-field rendering:** every entity editor (product, contact, deal, order, stylist) must read `shared.custom_field_defs` for `entity_type` and render the admin-defined fields (correct input by `field_type`, honour `is_required`, `options`, `visible_to_roles`). This is foundational — see §Settings/Custom Fields.
- **Permission-aware fields:** a field hidden from the user's role (e.g. `cost_price_ngn`, salary) is not rendered and not requested.

### 1.7 The `DataTable` (workhorse spec)

Nearly every list screen is a `DataTable`. Build it to do all of this so module screens are configuration, not new code:

- **Columns:** configurable, with per-column type renderers (text, money via `MoneyText`, date, status pill, badge, avatar, boolean, actions).
- **Server-driven:** pagination (cursor or offset per API), sorting, multi-filter, and full-text search are sent to the API (never filter a partial page client-side). Query keyed by `{entity, module, filters, sort, page}`.
- **Selection:** row checkboxes + bulk actions (where permitted).
- **Row actions:** kebab menu / inline buttons, permission-gated.
- **Row click:** opens the `Drawer` detail/edit, or navigates to a detail route for heavy records.
- **States:** loading (skeleton rows), empty (contextual `EmptyState` with a create CTA if permitted), error (retry), permission-denied.
- **Density toggle**, **column show/hide**, **saved views** (optional), **export** (CSV/Excel/PDF — respecting permissions; never export hidden fields).
- **Responsive:** collapses to stacked cards on mobile.

### 1.8 State, data & API conventions

- **Client (Zustand) store:** `auth` (user, roles, permissions), `activeEntity`, UI prefs (sidebar, density, theme), notification unread count, Praxis drawer open-state. Keep it small; everything server-derived goes in TanStack Query.
- **Server (TanStack Query):** one query hook per resource list/detail; mutations invalidate the relevant keys. Optimistic updates for fast interactions (e.g. task drag, kanban move) with rollback on error.
- **API contract conventions:** REST, JSON. Standard envelope per the OpenAPI spec. Always send entity scope. Handle the standard error shape and map field errors into forms. Respect idempotency keys where the API provides them (POS offline sync, payment posting).
- **Real-time:** subscribe to Socket.io channels per entity for: stock-level changes (update stock & product views live), new notifications (bell + toast), new Smartcomm messages, dashboard tile refreshes, and Praxis run-step streaming. Reconcile socket events with TanStack Query cache (don't double-fetch).
- **Offline & resiliency:** the PWA caches the shell and read-only reference data. **POS** is the one screen that must fully function offline (§POS): queue transactions locally with a client-generated idempotency key, show an "offline — N unsynced" indicator, and replay on reconnect. Every screen degrades gracefully: if AI is throttled, tier-1 insight cards still render (only the AI prose briefing pauses).

### 1.9 Inter-company data integrity (the hard part — read before building Sales/Invoicing/Production/Accounting)

The two companies trade with each other and it must always be booked as a real two-sided transaction (`shared.intercompany_transactions`, matched pair). The frontend's responsibilities:

- **Flow 1 — Faitlyn styles Pixie's hair:** FLH raises a styling invoice to PXG (per service job, Faitlyn-priced). FLH books revenue; PXG books the styling cost into the wig's landed cost carrying the `FLH-INV-…` reference. UI must make the IC link explicit on both sides and never let a styling job that crosses entities exist without its matched invoice (the books-integrity watchdog, surfaced via AI Insights).
- **Flow 2 — Faitlyn buys a Pixie wig (wholesale):** PXG raises a wholesale sale to FLH at the inter-company price with a `min_margin_floor_pct` floor (investor protection); the unit moves PXG inventory → FLH inventory. The Pricing UI must block a wholesale price below the floor.
- **Reconciliation view** (in `/accounting`, CEO/entity=ALL): lists `intercompany_transactions` with their matched/unmatched status (`intercompany_reconciliations`), seller_doc ↔ buyer_doc, and flags anything unmatched. This is what an investor's auditor effectively reads — make it clean and obvious.
- Tables: `shared.intercompany_transactions` (`ic_number, flow_type, seller_brand, buyer_brand, min_margin_floor_pct, effective_margin_pct, seller_doc_*, buyer_doc_*, status, matched_at, settled_at`), `shared.intercompany_reconciliations`, plus the `is_intercompany`/`intercompany_transaction_id` columns on `sales_orders`, `invoices`, `journal_entries`, `service_jobs`.

### 1.10 Accessibility & touch targets

WCAG 2.1 AA target. Minimum 44×44px touch targets (POS and the staff punch widget are used on phones). Full keyboard navigation, visible focus rings, ARIA roles on the DataTable/Drawer/Modal/Tabs, colour-contrast that holds under both brand themes, and `prefers-reduced-motion` honoured. State must never be communicated by colour alone — pills carry text/icons too.

### 1.11 Internationalisation & money

- Display currencies: **NGN (base), USD, GBP, EUR, CAD, GHS** (read the active set from `shared.currencies`; never hard-code the list). Symbols, decimal/thousands formatting, and per-currency rounding come from `currencies`/`currency_rates`.
- **`MoneyText` rule:** the stored `*_ngn` is the truth. For customer-facing/storefront values, display the customer's currency using the **stored `fx_rate_used`** on that record (not a live rate). On financial/admin screens, show the display amount with the NGN settlement value adjacent. Never recompute a historical figure with today's rate.
- IP-based currency detection is a storefront concern (MaxMind), with a manual switch persisted to the session (§Storefront).

### 1.12 Performance & script governance

SSR for the storefront; code-splitting per route in the Hub; lazy-load heavy bespoke builds (Org canvas, Pricing engine, Storefront Studio) and charts. Defer non-critical third-party scripts (we own loyalty/reviews/chat natively, so there are very few). Image pipeline: WebP, responsive sizes, lazy loading. Budget Core Web Vitals on the storefront (LCP/CLS/INP) — it's a ranking factor and a conversion factor on Nigerian networks.

### 1.13 Error, empty & permission states (every screen, no exceptions)

Every screen specifies four non-happy states:

- **Loading:** skeletons that match the final layout (no spinner-only screens).
- **Empty:** contextual message + a create CTA _if the user may create_; otherwise an explanatory empty state.
- **Error:** human message + retry; never a raw stack trace; log to the error tracker.
- **Permission-denied:** a clear "you don't have access to this" panel (not a blank screen, not a crash). Distinguish "no module access" (route guard) from "read-only" (render but disable writes).

### 1.14 Suggested build order (hardened)

1. **Foundation kit:** tokens, `AppShell`, `DataTable`, `Drawer`, form system, `MoneyText`, `StatusPill`, the four non-happy states. (~70% of all screens fall out of this.)
2. **Auth + entity context + permission-aware rendering** (the spine everything hangs on).
3. **Core operations modules:** CRM, Sales, POS, Stock, Invoicing, Logistics.
4. **Finance:** Accounting, Expenses, Purchasing; then Inter-Company UI + reconciliation.
5. **Production + Pricing** (cost→price spine), then **HR + Payroll**.
6. **The three bespoke builds:** Pricing engine interactions, Org & Workflow canvas, Storefront Studio.
7. **Marketing/Email, Social, Campaigns (flash-sale), Retention admin** (the previously-missing cluster).
8. **Stylist programme + Retail partners.**
9. **AI layer:** Praxis chat, Insights, AI Control.
10. **Storefront** (its own track, can parallelise from step 6) + **Stylist portal.**
11. **Settings/Business Setup config screens**, **in-app guide/onboarding**, polish, a11y pass.

---

# PART 2 — THE HUB (ERP) MODULES

Each module below follows the same template: **Route/Roles/Scope → Purpose → Screens → Tables → Components → State machine → Rules (incl. audit findings) → Interconnections → Edge cases.** Attach the named migration file for column-level truth.

---

## 2.1 CRM & Pipeline (6.1) — `/crm`

**Roles:** all roles have at least partial access (it's the relationship hub). **Scope:** per-entity.
**Purpose:** Build and maintain customer relationships across every channel; a visual pipeline plus rich profiles.

**Screens**

- **Pipeline board** (Kanban): columns = `crm_pipeline_stages` for the active pipeline; cards = `crm_deals`. Drag a card to change stage (writes `crm_deal_stage_history`, optimistic update). Cards show expected revenue, last-contact age, channel, owner; stale cards (no contact in N days) are visually flagged. Support multiple pipelines per brand (`crm_pipelines`).
- **Customer profile drawer/page:** identity (from `shared.contacts`), purchase history across channels, `customer_preferences` (texture/length/colour — feeds subscription "surprise me"), `customer_measurements`, conversation history (Smartcomm), loyalty balance + tier (from `shared.customer_loyalty_state`), referral history, `crm_milestones`, churn risk (`churn_risk_scores`), and any `custom_field_defs` for `entity_type='contact'/'deal'`.
- **Deal detail:** line items (`crm_deal_products`), activities (`crm_activities`), notes (`crm_notes`), stage history, linked quotation/order.
- **Activity/follow-up list** with overdue highlighting; VIP auto-assignment to a senior rep.

**Tables:** `{brand}.crm_pipelines, crm_pipeline_stages, crm_deals, crm_deal_stage_history, crm_deal_products, crm_activities, crm_notes, customer_preferences, customer_measurements, churn_risk_scores, crm_milestones`; `shared.contacts` (+ `contact_addresses, contact_tags, contact_segments`); `shared.customer_loyalty_state`.

**Components:** `KanbanBoard`, `DealCard`, `ContactProfileDrawer`, `ActivityTimeline`, `ChurnBadge`, `MeasurementForm`, `DataTable` (list view).

**Rules:** churn scores are **computed by cron** (`churn_risk_scores`) — read-only, don't edit. Stage changes always append history. Pipeline stages are config (`crm_pipeline_stages`) — render from DB, support per-brand differences (PXG: New Lead→…→Delivered; FLH: Enquiry→Consultation→Booked→In-Progress→Completed).

**Interconnections:** Sales (customer→quotation), Smartcomm (DMs synced to profile), E-Commerce (storefront orders linked), Marketing (segments), Retention (loyalty/referral/churn on profile).

**Edge cases:** a storefront customer may already exist as a contact — show the match/merge affordance. Measurements and preferences are sensitive-ish but not cost/pay — visible to sales roles.

---

## 2.2 Sales & Quotations (6.2) — `/sales`

**Roles:** sales + above. **Scope:** per-entity.
**Purpose:** Create quotations, convert to confirmed sales orders, route dispatch vs walk-in, **track installment / partial payments end-to-end**.

**Screens**

- **Quotation builder:** pick customer (combobox from contacts), add products/variants with qty + price (price is **read-only**, pulled from the published price set in Pricing 6.25), apply discounts/coupon codes (validated against `shared.coupons`), set payment terms; auto-calc subtotal/tax/total; loyalty/referral computed automatically. Send via WhatsApp/email with branded layout. Tables: `quotations, quotation_lines`.
- **Sales orders list + detail:** `sales_orders` with `sales_channel` (storefront/pos/woocommerce/instagram/whatsapp/walk_in/**public_form**), `order_type`, `is_custom_order`, money block (`*_ngn` + `display_currency` + `fx_rate_used`), `status` state machine, payments (`sales_order_payments`), discounts (`sales_order_discounts`), state history (`sales_order_state_history`), IC fields (`is_intercompany`, `intercompany_transaction_id`).
- **Walk-in vs Dispatch selector:** Walk-in closes normally; **Dispatch** auto-creates a Logistics delivery request with the address pre-filled.
- **Cancellation handling:** `cancellation_requests` (submitted→reviewed→executed); enforce the cancellation policy in the UI copy and fee preview: free within 3 hours (`free_cancel_until`), restocking fee after (`restocking_fee_pct`), custom orders 50% non-refundable (`custom_non_refundable_pct`).

### Installment payments & the order Payment Workbench (v2.1+)

Every order natively supports partial payments. The order-detail screen surfaces a dedicated **Payment Workbench** section showing the live balance and full history:

- **Balance ribbon (top of order detail):** four numbers in a single horizontal strip — **Total** (`total_ngn`) · **Paid** (sum of `sales_order_payments.amount_ngn`) · **Balance Due** (`balance_due_ngn`, server-computed) · **Payment Model badge** (Layaway / Deposit-triggered + threshold). The ribbon's colour reflects state: amber (partial), green (paid in full), red (overdue per the Retention/reminder cadence). Use `<MoneyText>` (NGN truth + display-currency snapshot on hover).
- **Payments ledger (table):** every row a `sales_order_payments` row — date · amount (multi-currency aware) · gateway used · reference (Paystack/Opay/Nomba/Stripe reference, or manual bank transaction ID once D-8 unlocks) · status (`succeeded`/`failed`/`refunded`) · recorded by (system on webhook, or user on manual). Append-only — reversal-only, never edit.
- **Payment-model awareness (badge + behaviour):**
  - **Layaway:** badge "Layaway — ships when paid in full." Stock is reserved; the order **cannot** flip to `in_production` / `dispatch_ready` until `balance_due_ngn = 0`. Show an idle "Awaiting payment" pill on the workflow timeline.
  - **Deposit-triggered:** badge "Deposit-triggered (50%)" (read the actual % from product/`payment_model_config`). The moment cumulative payments cross the deposit threshold, the order auto-flips to `in_production` and a Production/Service Job is created (Faitlyn) or fulfilment unblocks (Pixie). UI must show a "Deposit cleared — production started [timestamp]" event and prevent dispatch until full balance is paid.
- **Three payment-action buttons:** rendered in the Payment Workbench, permission- and config-gated.
  1. **"Send Pay-Link"** (always available) → opens a Smartcomm composer pre-filled with the running balance and a tokenised pay-link `/{order_token}` (reusing `public_tracking_token`). The user picks channel (WhatsApp / email / both), edits the friendly copy, sends. Track sent/opened/clicked in `sales_order_payment_link_events` if present, else fire a Smartcomm activity log.
  2. **"View Customer Self-Serve View"** (always available) → preview of what the customer sees on `/pay/{order_token}` (handy for support calls).
  3. **"Record Manual Payment"** (D-8: **hidden** unless `allow_staff_manual_payments=true` on `business_config`) → drawer form: amount, currency (from active `currencies`), date, **bank transaction ID (mandatory)**, optional receipt upload (to Documents, `document_type='payment_receipt'`), optional note. On save: create `sales_order_payments` row with `gateway='manual'`, feed Bank Reconciliation (6.6), audit-log the recording user. **The Record-Manual-Payment button must literally not be in the DOM unless the toggle is true** — defence in depth on separation of duties.
- **Auto-reminders panel:** read-only summary of upcoming reminders the system will send (cadence from `business_config` + Retention 6.23 rules) — "Next reminder: WhatsApp, in 3 days, if balance > 0." Reminders pause automatically the moment a payment arrives (server-side; the panel reflects).
- **Abandonment indicator:** for Layaway orders past the abandonment window (default 60 days no payment, configurable), a banner appears: "No payment in 67 days — auto-cancellation will run in 14 days. Override?" with an extend-window action. Backed by a scheduled job server-side.
- **Webhook reconciliation visibility:** when a payment arrives via gateway webhook (Paystack/Opay/Nomba/Stripe), the ledger row appears in real-time (Socket.io); the balance ribbon updates without refresh.

**Tables:** `{brand}.quotations, quotation_lines, sales_orders, sales_order_lines, sales_order_discounts, sales_order_payments, sales_order_state_history, cancellation_requests`. `payment_model` is a per-product/variant field on `products`/`product_variants` (confirm exact column name with backend; the audit's Appendix C lists this as a structural addition if not yet present — flag if absent).

**Components:** `QuotationBuilder`, `ProductLinePicker` (combobox + variant matrix), `OrderDetail`, `PaymentWorkbench` (balance ribbon + ledger + 3 action buttons), `PaymentModelBadge`, `SendPayLinkComposer`, `RecordManualPaymentDrawer` (D-8 gated), `CustomerSelfServePreview`, `CancellationDrawer`, `StatusPill`, `Timeline`.

**Rules:** **prices are never edited here** — they come from Pricing. Money figures lock after first payment is recorded. `sales_orders` is a state machine — change status through allowed transitions only; the API enforces, the UI only offers valid next states. Confirmation reserves stock; the order doesn't enter production unless its payment-model condition is met. Every partial payment posts to Accounting immediately (real cash receipt, not a "promised" amount).

**Interconnections:** CRM (customer in, outcomes back), Invoicing (confirmed order → invoice; partial payments update invoice status), Stock (reserve; release on confirmed payment threshold), Logistics (dispatch only when fully paid), Retention (points/coupons/referrals; loyalty points earned proportionally per partial), Campaigns (`sales_campaign_id`, UTM fields), Accounting (every partial = real receipt; AR ageing on live balance).

**Edge cases:**

- **Currency drift between partials.** A customer pays the first installment in USD, the second in NGN. Each payment row stores the gateway currency and the FX rate used at that payment; the order's NGN truth is the sum. UI must show each partial in its own currency and the NGN-equivalent.
- **Refund of a partial.** A reversed payment doesn't edit the original row — it adds a new `sales_order_payments` row with negative amount and `reverses_payment_id`. Balance ribbon recalculates.
- **Webhook arrives for an unknown reference.** Surface as an "unmatched payment" in Accounting; never silently apply.
- **IC sales (Flow 2)** originate here for PXG→FLH wholesale — see §1.9; the wholesale price path must respect the min-margin floor. **D-7: inter-company payments bypass the gateway gross-up entirely** (direct-bank settlement).

---

## 2.3 Point of Sale (6.3) — `/pos`

**Roles:** sales/cashier + above. **Scope:** per-entity. **Special: must work offline.**
**Purpose:** Fast walk-in/in-store checkout tuned for Nigerian payment realities.

**Screens**

- **Terminal login (PIN):** staff log in with a personal PIN (`pos_pin_credentials`) for accountability; the terminal is a named device (`pos_terminals`, with Nomba terminal id + opening float). Never display a PIN; set/reset only.
- **Session lifecycle:** open session (float) → transact → cash drops (`pos_cash_drops`) → close & reconcile (`pos_session_summary`). `pos_sessions` is open/close lifecycle.
- **Checkout screen:** product search (fast, works offline against cached catalogue), cart, **Walk-In vs Dispatch** toggle (Dispatch pre-fills a Logistics delivery), split payments (`pos_payment_splits`) — Paystack/Nomba (transfer + POS card default), redeem loyalty points / apply coupon, void with reason (`pos_void_log`).
- **Offline mode:** when offline, queue `pos_transactions` locally with a **client-generated idempotency key**, show "offline — N unsynced," and replay on reconnect; dedupe server-side by the idempotency key. (`pos_transactions` carries `was_offline`/`offline_synced_at`.)

**Tables:** `{brand}.pos_terminals, pos_pin_credentials, pos_sessions, pos_transactions, pos_payment_splits, pos_cash_drops, pos_void_log, pos_session_summary`.

**Components:** `PinPad`, `PosCart`, `PaymentSplitPanel`, `OfflineBanner`, `VoidDialog`, `SessionCloseWizard`, `ReceiptPreview`.

**Rules:** **idempotency is mandatory** for offline replay (audit L-6 flagged the schema lacked a key — confirm the API exposes one; if not, escalate as a backend dependency, see Appendix C). `pos_transactions` are created on checkout and voided via workflow, never free-edited. PIN-based login links each sale to a staff member for commission.

**Interconnections:** Stock (deduct real-time), Accounting (revenue/tax/splits post), Logistics (dispatch), HR (PIN → commission), Retention (points/coupons/subscription checks).

**Edge cases:** weak connectivity mid-checkout (queue, never block the sale); a customer who is a subscriber (check subscription status); cash de-emphasised but supported.

---

## 2.4 E-Commerce Admin (6.4) — `/ecommerce`

**Roles:** marketing/ops + CEO; product editing per permissions. **Scope:** per-entity (PXG primary; FLH if it lists online).
**Purpose:** Back-office that manages the public storefront's data (products, orders, content, sync). Visual theming is **not** here — it's in Storefront Studio (6.28).

**Sub-screens**

- **`/products`** — product list (`products`) + edit drawer: gallery (`product_images`), variant matrix (`product_variants` — SKU, lace/colour/length/density/cap, channel prices, `cost_price_ngn` [hidden from non-cost roles], `reorder_point`), description (rich text), SEO (`product_seo`), category/collection tags, related products (`product_related`), custom attributes (`product_attribute_values` rendered from `custom_field_defs`). **Prices are read-only here** — set/approved in Pricing (6.25); show published price + link.
- **`/orders`** — online orders with fulfilment status, tracking link, payment state; connects to Logistics.
- **`/collections`** — manual (drag products → `product_collection_members`) and rule-based (`product_collection_rules`) collections; `product_collections`. Categories (`product_categories`) as a drag-and-drop tree.
- **`/discounts`** — the PXG quantity-discount rule (2=$10, 3+=$22; `cost_pass_through_rules`), coupon codes (links to Retention's `shared.coupons`), custom-order exclusion flag.
- **`/reviews`** — moderation queue (`shared.product_reviews`); only verified-purchase reviews surface; approve/reject before publish; star aggregation feeds product cards + Google rich snippets.
- **`/ugc-curation`** — Instagram-tagged posts queue → "Import to Store" → backend async job downloads media (IG URLs expire 24–48h → copy the file), FFmpeg compress + poster, own-server storage, link to SKU, "Verified UGC" tag → appears in Storefront Studio media library. (See §Storefront UGC.)
- **`/content-posts`** _(NEW — closes audit gap; table `storefront_content_posts`)_ — blog / FAQ / Wig Care Guide / lookbook / press editor: `post_type`, slug, title, excerpt, rich `body`, hero image+alt, FAQ fields, linked products/collections, tags, SEO (`meta_*`, `canonical_url`, `og_image_url`, `schema_extras`), `status` (draft/scheduled/published/archived) + `scheduled_publish_at`, featured flag. FAQ posts must emit FAQ schema; blog posts support inline product embeds.
- **`/channel-sync`** _(NEW — closes audit gap; columns `product_variants.channel_external_ids`/`channel_sync_state`)_ — WooCommerce/marketplace sync status: per-variant external IDs and sync state, last-sync time, conflicts, manual re-sync. Surface a small sync-status indicator on each variant in the product editor.
- **`/public-form-config`** _(NEW — v2.1+; configures the public order form at `/order`)_ — defines for each brand: the form's URL slug, the set of fields collected (first name, last name, **day & month of birth** for birthday-discount enrolment in Retention 6.23, billing address, delivery address with "same as billing" default toggle, phone, email), the gateways offered at checkout (pulled from Business Setup 6.21, render the active set with Paystack/Opay primary+fallback), and the contact-merge rules (match on email+phone). Also enables staff-mode link generation visibility for sales/CRM roles.

**The Public Order Form itself (public, no-login) is documented in Part 3 §3.2.** This admin screen is where the CEO configures it; the customer-facing form lives on the storefront's public domain at `/order`.

**Tables:** `{brand}.products, product_variants, product_images, product_videos, product_seo, product_categories, product_collections, product_collection_rules, product_collection_members, product_attribute_values, product_related, storefront_content_posts`; `shared.product_reviews`.

**Components:** `ProductEditor` (gallery uploader + variant matrix builder + SEO panel + custom-field renderer + Woo sync indicator), `CollectionBuilder` (manual/rule modes), `CategoryTree`, `OrderDetail`, `ReviewModerationCard`, `UgcCurationQueue`, `ContentPostEditor`, `ChannelSyncPanel`, `DiscountRuleForm`.

**Rules:** SSOT — products read from Stock; stock counts sync live. Never edit the live theme here. Hidden-field discipline on `cost_price_ngn`.

**Interconnections:** Stock (master), Sales (orders tagged by channel), CRM (match/ create customers), Logistics, Invoicing, Retention, Marketing, Campaigns.

**Edge cases:** a variant out of sync with WooCommerce (show conflict + resolve); UGC media that fails moderation (never publish).

---

## 2.5 Invoicing & Billing (6.5) — `/invoicing`

**Roles:** finance/sales + CEO. **Scope:** per-entity.
**Purpose:** Generate, send, track invoices through their lifecycle; multi-currency; credit notes; IC invoices; **partial-payment-aware AR**.

**Screens**

- **Invoice list + detail:** `invoices` with `status` lifecycle **Draft → Sent → Partially Paid → Paid → Overdue** (+ Void). Money block: `subtotal_ngn, discount_amount_ngn, tax_amount_ngn, wht_rate, wht_amount_ngn, total_ngn, net_due_ngn` (generated), plus `display_currency`/`fx_rate_used`. Lines (`invoice_lines`), payments (`invoice_payments` — every partial is its own row, mirroring `sales_order_payments`), reminders (`invoice_reminders`), credit notes (`credit_notes` + `credit_note_lines`), receipts (`receipts`). PDF via `pdf_document_id`. Paystack pay link (`paystack_payment_url`) — also Opay/Nomba/Stripe per Business Setup gateway config.
- **Live-balance AR ageing (the key v2.1 detail):** AR ageing buckets are computed off `balance_due_ngn`, **not** the original invoice total. An invoice 70% paid ages on its remaining 30%. The list view shows: `total_ngn` · `amount_paid_ngn` · `balance_due_ngn` · ageing-bucket pill (current / 30 / 60 / 90+ days from the _oldest unpaid portion_). This is what keeps receivables honest — never overstate AR by counting an invoice that's mostly paid as fully outstanding.
- **Reminders:** overdue reminders via WhatsApp/email (Smartcomm); track `reminders_sent`, `last_reminder_sent_at`. **Pause-on-payment** is automatic server-side; the UI just reflects.
- **Credit notes / returns:** generate a credit note linked to the original invoice. A partial refund creates a credit note + a reversing `invoice_payments` row.
- **IC invoices:** `is_intercompany` + `intercompany_transaction_id` — show the matched counterparty doc (Flow 1: FLH styling invoice → PXG).

**Tables:** `{brand}.invoices, invoice_lines, invoice_payments, invoice_reminders, credit_notes, credit_note_lines, receipts`.

**Components:** `InvoiceDetail`, `InvoiceLineEditor`, `PaymentApplyDialog`, `ReminderScheduler`, `CreditNoteDrawer`, `LiveBalanceAgingBadge` (the ageing-on-remaining-balance pill), `MoneyText` (dual currency), `StatusPill`.

**Rules:** invoices are **auto-generated** from confirmed sales/POS/e-com — the UI mostly manages lifecycle, not free creation. Once issued, **only void is allowed** (Tier-3); payments are application records (reverse, don't edit). Multi-currency: show customer's payment currency + NGN settlement. **Every partial payment posts to Accounting instantly** as a real cash receipt — the books reflect the live state, not the eventual full payment.

**Interconnections:** Sales/POS/E-Com (auto-generate), Accounting (every partial posts immediately; AR ageing flows on live balance), Smartcomm (reminders/PDF), Documents (PDF stored), Retention (subscription invoices), Logistics (delivery fees referenced).

---

## 2.6 Accounting & Finance (6.6) — `/accounting` **[CEO / Finance only]**

**Roles:** CEO + (future) Finance seat. Hard-gated. **Scope:** per-entity, plus `ALL` for the IC reconciliation view.
**Purpose:** Real-time, investor-grade books per entity. **This is the module the external investor's auditor effectively reads — correctness and clarity are paramount.**

**Screens**

- **Chart of Accounts:** `account_groups` (5 top-level, read-mostly) + `chart_of_accounts` (hierarchical CRUD; cannot delete an account with journal lines). Seeded 87 Nigerian-retail accounts.
- **Journals:** `journal_entries` + `journal_lines`. **Posted entries are immutable** (DB-trigger enforced — proven in audit: unbalanced posts are rejected, posted entries are field-locked, posted lines can't change). The UI must (a) only allow editing **draft** entries, (b) enforce debits = credits before allowing "post," showing a live balance indicator, (c) for posted entries offer **reverse** (creates a reversing entry) — never edit.
- **Bank reconciliation:** import `bank_statements` + `bank_statement_lines`, match against payments via `bank_reconciliations` + `bank_reconciliation_matches`. Supports Paystack/**Opay**/Nomba/Stripe settlements. Also reconciles **Cash Request disbursements** (6.32) via the captured bank transaction ID — unmatched disbursement appears here waiting for the bank-statement line; a one-click match closes the loop. Once D-8 unlocks staff-recorded manual customer payments, those reconcile here too via the same pattern.
- **Payment Processing Fees account:** a dedicated, read-only ledger view of the `payment_processing_fees` GL account — per gateway (Paystack/Opay/Nomba/Stripe), per currency, per period. Reconciles against gateway settlement reports (Paystack/Opay/Nomba export their settlement files; Stripe via API). Variance alerts when booked fees vs settlement-report fees diverge beyond a threshold. **The fees themselves are gross-up'd into published price at Pricing (6.25); this screen is where the real cost shows up honestly in the books.**
- **Fiscal periods:** `fiscal_periods` (12 + period 13); admin closes periods manually; block posting into closed periods.
- **FX revaluation:** `fx_revaluation_runs` + `fx_revaluation_entries` for foreign-currency balances.
- **Tax filings:** `tax_filings` — VAT (7.5%), WHT; FIRS-ready report exports.
- **Financial reports:** P&L, Balance Sheet, Cash Flow — per entity, exportable. **IC reconciliation view** (`ALL` scope): `intercompany_transactions` matched/unmatched, seller_doc ↔ buyer_doc, flag unmatched (§1.9).

**Tables:** `{brand}.account_groups, chart_of_accounts, fiscal_periods, journal_entries, journal_lines, account_balances, bank_statements, bank_statement_lines, bank_reconciliations, bank_reconciliation_matches, fx_revaluation_runs, fx_revaluation_entries, tax_filings`; `shared.intercompany_transactions, intercompany_reconciliations`, `shared.bank_accounts`.

**Components:** `CoaTree`, `JournalEntryEditor` (with live debit/credit balance + post/reverse), `BankReconWorkbench` (two-pane match UI), `PeriodClosePanel`, `FxRevalRunner`, `FinancialReportViewer`, `IcReconciliationTable`.

**Rules (critical):** never expose direct UPDATE/DELETE to posted journals, `account_balances` (trigger-maintained), or any `*_state_history`. The "post" button must client-side verify balance (defence in depth — the DB also enforces). Reversal is the only correction path. Show "posted by/at," "reversed by," reversal reason.

**Interconnections:** everything that moves money posts here automatically (Sales, POS, Invoicing, Purchasing, Payroll, Expenses, Production cost layers, Retention liabilities, Stylist payouts).

---

## 2.7 Expense Management (6.7) — `/expenses`

**Roles:** all staff submit; Operations/HR approve. **Scope:** per-entity.
**Purpose:** Mobile-friendly expense capture + approval; reimbursement and cash-advance flows.

**Screens**

- **My expenses:** three statuses **Pending / Approved / Paid**; submit with receipt photo (`expense_receipts`), category (`expense_categories`), lines (`expense_lines`).
- **Reimbursement** (staff pays first, snaps receipt, submits) and **cash advance** (`cash_advances` → spend → settle with receipts + change via `cash_advance_settlements`).
- **Approval queue** (managers): approve/reject (`expense_approvals`); routing follows the workflow (manager up to `approval_threshold_ngn`, escalate above — see Org Builder).

**Tables:** `{brand}.expense_categories, cash_advances, cash_advance_settlements, expenses, expense_lines, expense_receipts, expense_approvals`.

**Components:** `ExpenseSubmitForm` (mobile-first, camera capture), `ApprovalQueue`, `AdvanceSettlementWizard`, `StatusPill`.

**Rules:** approved expenses post to Accounting automatically. Approval may be workflow-gated (submit to `workflow_instances`, not a direct status flip) when above threshold. Outstanding advances are deducted in Payroll. **Cash Request linkage:** Cash Requests (6.32) that complete the Finance-disburse step **auto-post here as Expenses** under the cost-centre/account the requester chose — surface those rows with a small "via Cash Request" badge so the audit trail is obvious; click-through opens the originating Cash Request.

**Interconnections:** Accounting, HR/Payroll (advance deductions/reimbursements), Smartcomm (approval notifications), **Cash Request (6.32) — auto-posts here on disbursement**.

---

## 2.8 Purchasing & Imports (6.8) — `/purchasing`

**Roles:** ops/China-production + CEO. **Scope:** per-entity. **China factory cost is hidden from non-cost roles.**
**Purpose:** Manage buying from the China factory through customs to Lagos; three-way match.

**Screens**

- **Suppliers:** three-tab editor — `suppliers` + `supplier_contacts` + `supplier_products` (variant mapping).
- **RFQs:** `rfqs` + `rfq_lines` + `rfq_quotes`.
- **Purchase Orders:** `purchase_orders` + `po_lines` + `po_state_history`. **Factory tracking states:** In Production → Quality Check → Ready to Ship → In Transit → Arrived Lagos → Cleared Customs. PO **immutable after `approved`**.
- **Goods Received:** `goods_received_notes` + `grn_lines` — check against PO, confirm to stock, flag discrepancies. GRN immutable after `posted`.
- **Supplier invoices + three-way match:** `supplier_invoices` + `supplier_invoice_lines` + `supplier_invoice_matches` (PO ↔ GRN ↔ invoice). Immutable after match.
- **Dashboard:** total purchase value, open orders, in-transit shipments, customs status, factory payable.

**Tables:** `{brand}.suppliers, supplier_contacts, supplier_products, rfqs, rfq_lines, rfq_quotes, purchase_orders, po_lines, po_state_history, goods_received_notes, grn_lines, supplier_invoices, supplier_invoice_lines, supplier_invoice_matches`.

**Components:** `SupplierEditor` (3-tab), `PoBuilder`, `PoTrackingTimeline`, `GrnCheckSheet`, `ThreeWayMatchPanel`, `PurchasingDashboard`.

**Rules:** hide factory cost / origin from non-cost roles. State machines: only offer valid transitions. PO approvals route via workflow (e.g. "PO → China Manager → CEO," amount-thresholded).

**Interconnections:** Stock (GRN adds stock; low-stock triggers reorder), Accounting (payables), Production (PO hands off at "order placed" → per-wig cost), Contacts, Dashboards.

---

## 2.9 Stock Management — SSOT (6.9) — `/stock`

**Roles:** ops + above; cost hidden from non-cost roles. **Scope:** per-entity.
**Purpose:** The single source of truth for inventory; every channel deducts from one count.

**Screens**

- **Stock levels** (`stock_levels`, materialised from movements — read-only/computed): per variant per location, with reserved vs available.
- **Movements ledger** (`stock_movements`, **append-only** — corrections via `stock_adjustments`, never edit the ledger).
- **Locations** (`stock_locations` — CRUD with map pin), **reservations** (`stock_reservations`), **adjustments** (`stock_adjustments` + `stock_adjustment_lines`), **transfers** (`stock_transfers` + `stock_transfer_lines`), **alerts** (`stock_alerts` — low-stock), **inbound** (`inbound_shipments` + `inbound_shipment_lines` — "Incoming" view from China with ETAs).
- **Real-time:** stock changes push over Socket.io; update product/stock views live (no oversell).

**Tables:** `{brand}.stock_locations, stock_levels, stock_movements, stock_reservations, stock_adjustments, stock_adjustment_lines, stock_transfers, stock_transfer_lines, stock_alerts, inbound_shipments, inbound_shipment_lines`.

**Components:** `StockLevelTable`, `MovementsLedger` (read-only), `AdjustmentForm`, `TransferWizard`, `InboundShipmentsBoard`, `LowStockAlertList`, `LocationMap`.

**Rules:** `stock_levels` is computed — never edit directly; adjust via `stock_adjustments` (audited). Movements are append-only. Reservations hold stock until delivery confirmed.

**Interconnections:** E-Commerce/WooCommerce (sync), Purchasing (receipts add), Sales/POS (deduct, channel recorded), Logistics (reserve), Accounting (valuation), Production (final landed cost → `cost_price`).

---

## 2.10 Logistics & Delivery (6.10) — `/logistics`

**Roles:** ops + above. **Scope:** per-entity.
**Purpose:** Everything after a sale when the customer isn't walking out — courier booking, delivery notes, tracking, cost.

**Screens**

- **Deliveries list + detail:** `deliveries` (state machine + webhook-driven), `delivery_items`, `delivery_attempts` (append-only), `delivery_state_history`, `delivery_proofs` (POD, append-only), `courier_webhook_events`, `pay_on_delivery_collections`.
- **Courier config** _(`/logistics/couriers` — closes audit gap G-3; table `couriers`)_: CRUD for Chowdeck / GIGL / DHL / Manual + `rate_card` JSONB, `integration_type`, `serves_local/nationwide/international`, `supports_pod`/`pod_fee_pct`. This is the admin screen the original guide omitted.
- **Customer-facing tracking** is rendered storefront-side (see §Order Timeline) but the **status vocabulary** is driven by `shared.timeline_event_codes` (editable in Storefront Studio → Timeline Vocabulary).

**Tables:** `{brand}.couriers, deliveries, delivery_items, delivery_attempts, delivery_state_history, delivery_proofs, courier_webhook_events, pay_on_delivery_collections`; `shared.order_timeline_events, timeline_event_codes, tracking_links`.

**Components:** `DeliveryBoard`, `DeliveryDetail`, `CourierBookingDialog`, `PodViewer`, `CourierConfigEditor` (rate-card builder), `TrackingTimeline`, **`DeliveryLetterPanel`** (v2.2+; see below), **`LetterQueueBoard`** (v2.2+; the packing-team's print queue).

**Rules:** deliveries are state-machine + webhook driven — don't free-edit; courier webhooks append events. Dispatch orders flow in automatically from any sales channel. **Dispatch is gated on the order being fully paid** (regardless of payment-model) — Layaway and post-deposit-balance orders can't dispatch until balance = 0 (Sales 6.2).

### Curated Delivery Letter & Install Hub — Hub side (v2.2+)

Every outgoing dispatch gets an auto-generated, brand-styled letter PDF that goes in the box with a QR linking to a personalised install hub. The Hub side has two screens:

#### `/logistics/letters` — Letter print queue (for the packing team)

- **List view (DataTable):** every order in status `dispatch_ready` or `packing` with columns: order number · customer first name · the wig (variant name + length + colour + texture, from `product_variants`) · delivery city (from `delivery_address_snapshot`) · letter status pill (`Not Generated` / `Generated` / `Printed`) · "Generate & Preview" action · "Mark Printed" action.
- **Drawer (per order):** PDF preview (uses `<DocumentPreview>` against the stored `documents.document_id`), brand letterhead, the personalised welcome note with all merge tokens resolved (customer first name, wig details, delivery city, order number), the QR rendered with the order's `public_tracking_token` encoded as `https://install.{brand-domain}/{token}`, Faith's signature image. "Print" action triggers the browser print dialog; "Regenerate" re-runs the template (e.g. after correcting a typo in the template). "Mark Printed" sets the letter status; the packing team uses this to track what's inserted.
- **Auto-generation timing:** the backend generates the PDF the moment the order enters `packing` (the wig is now known). Frontend doesn't generate — it presents/prints what the backend wrote to `documents` with `document_type='delivery_letter'`. If `Generate & Preview` is clicked and no PDF exists yet, fire the generation endpoint and poll.
- **Re-print:** allowed any number of times before status flips to `delivered`; tracked in the audit log.

#### Letter template editor (lives in Storefront Studio, deep-linked from here)

The template itself is configured in Storefront Studio at `/storefront-studio/letter-templates` (see §2.28). From the letter queue, a "Edit template" link deep-links there for CEO users.

**Tables (letter side):** the letter PDF is just a `shared.documents` row with `document_type='delivery_letter'` and `reference_type='order'` + `reference_id={order_id}`. **No new tables.** The template is a row on `shared.storefront_letter_templates` (or equivalent — confirm with backend; if absent, flag in Appendix C as a small structural addition).

### Public Install Hub — public-facing page (v2.2+)

This is a **public, no-login page** rendered on the storefront SSR app (Next.js), not the Hub. Documented in detail in **Part 3 §3.2 (Storefront pages)** to keep the Hub guide focused on admin. Hub-side mention: the QR target is `https://install.{brand-domain}/{order_token}` where `order_token` reuses `public_tracking_token` from `sales_orders`.

**Interconnections (letter & install hub additions):** Sales/POS/E-Com (orders feed the letter queue at packing), Documents (PDF stored), Storefront Studio (template editor + content for install hub), E-Commerce UGC pipeline (install videos), Stylist Programme (city-filtered directory on install hub), Retention (post-install review request, Streak Stars), Smartcomm (the "Need help installing?" CTA pre-populates a WhatsApp thread).

---

## 2.11 Production & Landed Cost (6.24) — `/production` **[Both entities; cost tightly layered]**

**Roles:** China Production Manager + CEO see full chain (RMB/USD/NGN); Nigeria Ops sees from arrival onward (3PL/styling/wastage), **never factory cost**. **Scope:** per-entity (ring-fenced books).
**Purpose:** Capture the exact cost of every wig — factory → freight → customs → styling → finished — feeding Stock `cost_price` and Pricing.

**Screens**

- **Production runs:** `production_runs` (state machine + roll-up from `cost_components`), units (`production_run_units`), funding sources (`funding_sources` — RMB→NGN at the actual funding rate).
- **Cost build-up drawer (per unit):** layered view — Factory Cost (RMB, converted at funding rate), Forwarding & Freight (pro-rated by weight/volume/unit), 3PL-to-showroom, Styling, Wastage Buffer (configurable % per process), Miscellaneous incl. **port storage** (`cost_components.cost_type` includes `port_storage`). `landed_cost_breakdown` is a snapshot history. `rework_events` log extra work per unit. Returns/cancellations reverse out of the batch per the cancellation policy.
- **Faitlyn Service Job Tracker** _(`/production/service-jobs`)_ — digitises the Hair Assignment Register: which hair unit is with which stylist, for what service, at what status. `service_jobs` (state machine **pending → in_progress → completed**), `service_types` (5-item taxonomy: Installation, Revamping, Colour Creation, Customization, Packing — each with `standard_cost_ngn`, `standard_turnaround_days`, `default_recipe_id`), `chemical_recipes` (Colour Creation mixes), `service_job_chemicals`, `monthly_chemical_reconciliations`. Assigning a job raises a Task for the stylist (`task_id`). **Anti-pocketing:** completed jobs with no linked sale/payment are flagged (surfaced via AI Insights `ai_insight_service_match`).

**Tables:** `{brand}.funding_sources, production_runs, production_run_units, cost_components, landed_cost_breakdown, rework_events, service_types, chemical_recipes, service_jobs, service_job_chemicals, monthly_chemical_reconciliations`.

**Components:** `ProductionRunBoard`, `CostBuildUpDrawer` (layered, multi-currency, role-filtered), `ServiceJobTracker` (assignment board), `RecipeBuilder`, `ChemicalReconciliationPanel`, `ReworkLogger`.

**Rules:** `cost_components`/`landed_cost_breakdown` are append-only/snapshot — don't edit. **RLS caveat:** factory cost hiding is server-enforced; the UI must not request factory-cost fields for Ops roles. Styling is logged in batches; the system applies standard recipe cost, reconciling monthly. For PXG, styling is **not in-house** — it enters as an IC styling invoice from FLH (Flow 1); show the `FLH-INV` reference.

**Interconnections:** Purchasing (hands off at order-placed), Stock (final `cost_price` per SKU), Pricing (reads cost as base), Accounting (cost layers), Logistics (arrival), Dashboards (margin-at-cost).

---

## 2.12 Pricing Engine (6.25) — `/pricing` **[Bespoke interactive build]**

**Roles:** CEO approves (Finance inherits when split). **Scope:** per-entity + a wholesale (IC) channel.
**Purpose:** Set the profit you keep; the engine computes the exact retail price per channel/currency and stress-tests it before publishing. Sits on real cost from Production.

**Screens / interactions**

- **Product selector + live currency:** pick a product/variant + target currency (NGN/USD/GBP/EUR/CAD/GHS). Cost converts at the **actual funding rate** from Production; published prices use a **buffered rate** refreshed on a schedule (so a sliding Naira can't erode margin and prices don't flicker).
- **Goal-seek margin calculator:** enter target **net** margin → engine returns the exact retail price. Net = after payment fees, delivery, partner commission, expected returns, marketing, contingency. **Charm rounding** (e.g. $74.99, ₦119,000), always up. Warn if `cost% + target ≥ 100%`.
- **Sensitivity sliders + scenarios:** single-variable sliders (FX, freight, styling, wastage, processor fee, customs/duty, competitor ceiling) re-run live; pre-built scenarios (Stable Market, Naira Devaluation, Freight Shock, Festive Peak, Promo Season) shift many at once (`pricing_scenarios`, `pricing_scenario_sliders`, `pricing_scenario_results`); save custom.
- **Channel-aware pricing:** separate prices for storefront, POS, partner-stylist, and the **inter-company wholesale** channel (PXG→FLH). `channel_price_overrides` for time-bounded manual overrides. `cost_pass_through_rules` model the PXG quantity discount as a selling-cost layer so net margin stays honest.
- **Floors & approval:** `pricing_floors` (min price/margin, incl. **IC min-margin** — investor protection). Publishing below floor is **blocked even in a promotion** — enforce client-side AND rely on server. The recommended price lands in a **Proposed Price** field (`price_proposals`); an **Approve** button (CEO-only) pushes it to the selling-price column with a full audit log (who/when/old→new). Nothing goes live without that click. `price_history` snapshots every change.

### Payment-fee pass-through (D-7, v2.1+)

The Pricing engine owns the math that absorbs gateway fees into the published price. Show this clearly in the workbench:

- **Fee schedule (read-only, sourced from Business Setup 6.21):** Paystack 1.5% capped ₦2,000 · Opay (same structure; confirm exact figures) · Nomba ~0.5% capped ₦500 · Stripe **3.4% + $0.30 with no cap**. The Pricing workbench renders these per gateway/currency so the CEO sees what's being absorbed.
- **Gross-up formula visualisation:** for the active row, show `target net` → `+ gateway fee gross-up` → `+ charm rounding` → **published price**. Formula displayed: `gross = (net + fixed_fee) ÷ (1 − pct_fee)`, then rounded up by the charm rule, cap-aware (if `gross × pct_fee > cap`, swap to fixed cap and recompute). Use a `<FeeGrossUpBreakdown>` component so the math is visible, not hidden — Faith and the auditor both need to see how the published number was built.
- **Channel-price grid (key UI):** rows = currencies (NGN/USD/GBP/EUR/CAD/GHS), columns = channels (Storefront / POS / IC Wholesale). Each cell shows the published price plus a small `+₦X fee absorbed` annotation. **Critical UX point for D-7(iii):** USD/GBP/EUR/CAD/GHS rows visibly run higher than naive `NGN_price ÷ FX` would suggest because Stripe is uncapped — surface this with a small "Stripe uncapped fee" footnote on those cells, so Faith doesn't think it's a bug.
- **IC bypass (D-7(i)):** the IC Wholesale column shows the published price **without** any gateway gross-up — internal direct-bank settlement, no gateway. Label the column "IC (direct settlement)" to make the difference obvious.
- **Opay-as-fallback (D-7(ii)):** the Pricing UI treats Paystack and Opay as a single "local-card" tier with one gross-up; the slight Opay-vs-Paystack delta is absorbed silently. Show a small "primary: Paystack · fallback: Opay" indicator. Re-quoting on gateway switch is **never** triggered.
- **POD / cash:** since Public Order Form has no Pay-on-Delivery (v2.1 decision), the only no-fee channel is in-person cash at POS. POS rows show the published price minus the gross-up if and only if the order is marked cash-only at checkout — typically this is rare; the default is to keep one consistent published price.

**Tables (additions):** `{brand}.payment_gateway_config` (or equivalent — fee schedule per gateway/currency, primary/fallback assignment; confirm exact table name with backend, the audit's Appendix C lists this as a structural addition if not yet present).

**Components (additions):** `FeeGrossUpBreakdown` (formula viz), `ChannelPriceGrid` (channels × currencies, fee-aware), `GatewayFeeScheduleViewer` (read-only from Business Setup config).

**Tables:** `{brand}.pricing_rules, pricing_floors, pricing_scenarios, pricing_scenario_sliders, pricing_scenario_results, price_proposals, price_history, channel_price_overrides, cost_pass_through_rules`.

**Components:** `PricingWorkbench`, `GoalSeekPanel`, `SensitivitySlider`, `ScenarioSelector`, `ChannelPriceGrid`, `FloorGuard` (blocks sub-floor publish), `ProposeApproveBar` (CEO approve), `PriceHistoryDrawer`.

**Rules:** publish blocked below min-margin floor (incl. loyalty/streak discounts — see D-6: a lifetime discount can never push below floor). CEO-only approve. Prices feed Stock/E-Com/POS as read-only published values.

**Interconnections:** Production (cost in, PXG), Purchasing (cost in, FLH), Stylist (referral commission %), Business Setup (buffered FX + processor fees), Stock/E-Com/POS (publish), Accounting (margin), Dashboards.

---

## 2.13 HR & Payroll (6.11) — `/hr` **[HR/Admin + CEO; salaries strictly scoped]**

**Roles:** HR/Admin + CEO. **HR sees pay; cost stays with China Mgr/CEO.** **Scope:** per-entity.
**Purpose:** Staff records, attendance, commission, weighted appraisal, monthly payroll.

**Sub-screens**

- **Staff list + profile** (`shared.staff_profiles`, `staff_contracts`, `staff_assets`): personal details, role/department, bank (salary), signed docs, assigned entity; plus the Faitlyn employment terms — probation (start/end/outcome), leave balances (annual/public-holiday/special-event-in-lieu), non-solicitation window, summary-dismissal trigger notes. Salary visible to HR/Admin + CEO only.
- **`/hr/attendance` — Geo Clock-In (6.11.1):** see §2.14 (it's substantial enough to specify separately).
- **`/hr/commission`:** `commission_rules` (flat / tiered / product-specific, with `sale_channel`) → `commission_earned` (per sale, with `sale_channel` Instagram/Website/WhatsApp/Walk-in; reversal-only, not edit). Auto-calculated, added to payroll.
- **`/hr/appraisal`:** **weighted performance appraisal.** `performance_cycles` (quarterly + bonus pool), `performance_kpi_definitions` (weighted KPIs — default Customer Feedback 40 / Sales Conversion 25 / Work Quality 20 / Cleanliness 15), `performance_scores` (auto-populated from Sales/CRM/Service-Job/Attendance where `score_source` allows; `weighted_score` is generated), `performance_reviews`. **D-3 (critical): the KPI-definition editor UI must enforce that active weights sum to exactly 100 — the database does not.** Show a live running total; block save otherwise. `bonus_rules` (incl. the V2.2 4.8+ customer-rating auto-trigger), `bonuses_awarded` (approval-only).
- **`/hr/payroll`:** `payroll_runs` → `payslips` + `payslip_lines`. Pulls base + commission + attendance + bonuses/deductions − outstanding advances; computes PAYE, pension, NHF (and NSITF employer obligation) from `payroll_deductions` (effective-dated). Payslips immutable after `paid`. One-click generation.

**Tables:** `shared.staff_profiles, staff_contracts, staff_assets, leave_requests, geofences, staff_clock_events`; `{brand}.commission_rules, commission_earned, performance_cycles, performance_kpi_definitions, performance_scores, performance_reviews, bonus_rules, bonuses_awarded, payroll_runs, payslips, payslip_lines, payroll_deductions`.

**Components:** `StaffTable`, `StaffProfileDrawer`, `CommissionRuleBuilder`, `KpiDefinitionEditor` (**weight-sum-100 guard**), `AppraisalForm`, `PayrollRunWizard`, `PayslipPreview`, `DeductionConfigEditor`.

**Rules:** salary/PII strictly HR+CEO (server-enforced; UI must not request salary fields for other roles). Commission/bonus are reversal/approval-only. Payroll deductions effective-dated. `performance_scores` auto-score staleness fields exist — surface "last auto-scored / status / error."

**Interconnections:** Accounting (salary/commission/tax post), Sales/POS (commission), Calendar (leave/attendance), Expenses (advance deductions/reimbursements), Service Job Tracker + Attendance (feed appraisal).

---

## 2.14 Geolocation Clock-In (6.11.1) — `/hr/attendance` + staff punch widget **[HR/CEO see data only]**

**Roles:** all staff punch; **only HR/Admin + CEO see location data** — not Operations/line managers. **Scope:** per-entity.
**Purpose:** Presence verification at clock-in/out only — not live tracking.

**Screens / flow**

- **Punch widget (mobile-first, all staff):** big Clock In / Clock Out button. **First use → consent sheet** ("we capture your location at clock-in/out only") → browser Geolocation prompt → capture `lat/lng` + `accuracy_m` + server-side IP **at punch only**. Result pill: **On-site / Off-site (with distance) / Location not shared**. Denied/weak GPS → punch **still records**, flagged "location not shared" (never block a punch on GPS). Off-site → flagged for review, not blocked (a hard-geofence block is an **optional config** toggle). Cooldown to prevent double-punch.
- **Attendance register (HR/CEO):** who · in/out · hours · on-site/off-site pill · optional map pin · location-denied flag. Late arrivals/early departures/absences.

**Tables:** `shared.staff_clock_events` (append-only — never editable), `shared.geofences` (named work-sites + radius; map-based admin CRUD).

**Components:** `PunchButton`, `ConsentSheet`, `GeoStatusPill`, `AttendanceTable`, `AttendanceMap`, `HoursSummary`, `GeofenceEditor` (map draw/centre+radius — lives in Settings/Business Setup).

**Rules:** **privacy by design in the UI** — the consent sheet must be explicit; the register must visibly distinguish on-site/off-site/not-shared rather than implying constant tracking. Location data row-access is HR+CEO (server-enforced; the UI must not request location fields for Ops). `staff_clock_events` append-only.

**Interconnections:** HR/Payroll (hours), Calendar (presence), Dashboards (attendance KPIs, HR/CEO scope), Appraisal (attendance feeds scoring).

---

## 2.15 Org & Workflow Builder (6.27) — `/org-builder` **[CEO; flagship bespoke build]**

**Roles:** CEO. **Scope:** both entities (two trees, shared apex).
**Purpose:** A visual, no-code canvas where the CEO shapes structure, access, and approval routing. The org chart, the access matrix, and the approval workflows are **three views of one dataset** — draw the chart, and RBAC + routing are generated from it.

**Screens / interactions**

- **Canvas:** draggable role/person nodes; edges = reporting lines. Tabs: **PXG tree | FLH tree**, with the **CEO node bridging both**. Drag a node under another to set `org_positions.reports_to_position_id` (solid line). Use React Flow (or dnd-kit + SVG edges).
- **Node inspector (right panel):** for the selected role — a **live mini access-matrix** (toggle module × action × scope grants → writes `permissions`), the position's **workflow steps**, deputy flag (`is_deputy` + `deputy_capacities[]`), and `approval_threshold_ngn`.
- **Workflow editor:** approval routes default up the tree; explicit overrides (e.g. "all stylist payouts → CEO," "PO → China Mgr → CEO"); **amount-thresholded** routes (manager approves up to N, escalates above). `workflow_definitions` (JSON: trigger + stages + thresholds + deputy fallback + dotted-line non-routing).
- **Dotted lines:** `org_position_dotted_lines` (info-only, **never** approval routing) — multi-select per position.
- **Roles as templates, people as instances:** create a role template (bundle of grants + workflow positions); hire = create person → assign role + entity + manager → instantly inherits access. `roles`, `shared.users`, `shared.org_units`.

**Tables:** `shared.org_units, org_positions, org_position_dotted_lines, roles, permissions, users, user_roles, workflow_definitions, workflow_instances, workflow_decisions`; `shared.permission_module_keys` _(NEW — the canonical list of 36 module keys; the access-matrix UI must source its module rows from this table, not a hard-coded list)_.

**Components:** `OrgCanvas` (React Flow), `RoleNode`, `PersonNode`, `AccessMatrixMini` (live toggle grid), `WorkflowRouteEditor`, `DottedLineMultiSelect`, `DeputyConfig`, `ThresholdInput`.

**Rules:** this module **generates the Access Matrix (Section 3)** — the matrix is read from whatever the builder holds, so they never drift. Dotted lines never route approvals. Deputy inherits "most of the CEO's operational capacities." System roles can't be deleted; custom roles layer on top. Scope: configures structure/access/routing only — inventing new module behaviour is a build, not a toggle (state this in the UI so expectations are right).

**Interconnections:** generates RBAC consumed by every screen's permission checks; routes approvals into Expenses, Purchasing, Pricing (approve), Stylist (payouts), HR.

---

## 2.16 Marketing & Email Campaigns (6.15 / 6.16) — `/marketing`

**Roles:** Marketing + CEO. **Scope:** per-entity.
**Purpose:** Paid-ad management + analytics (Google/Meta) and owned email campaigns (no Klaviyo — Nodemailer over transactional SMTP).

**Screens**

- **Ad campaigns + analytics:** connect `ad_accounts` (Google Ads / Meta Ads via OAuth); push campaigns (`ad_campaigns`) with audience/budget/creative; monitor spend/impressions/clicks/conversions/CPA (`ad_spend_daily`). Note: programmatic create needs approved API access (Google Ads dev token, Meta Marketing API review) — UI should support a **read-first** mode (render performance) while create/schedule access is finalised.
- **Email campaigns:** `email_templates` (HTML editor + preview with sample variables), `email_campaigns` + `email_campaign_variants` (A/B) + `email_campaign_recipients` + `email_campaign_events` (provider webhooks — append-only). Segment picker (dynamic segments from CRM), send/schedule, opens/clicks/replies. Rolled `total_*` columns are computed — display, don't edit.
- **Milestone emails:** `email_milestone_rules` (birthday / anniversary / tier-upgrade / reorder), linked to `email_templates` + optional coupon issuance. (Configured here or in Retention workflows — keep one builder; cross-link.)
- **Unified analytics:** organic (Social) + paid + email + storefront + conversions in one funnel view (also surfaced in Dashboards).

**Tables:** `shared.ad_accounts, ad_campaigns, ad_spend_daily`; `{brand}.email_templates, email_milestone_rules, email_campaigns, email_campaign_variants, email_campaign_recipients, email_campaign_events`.

**Components:** `AdAccountConnect` (OAuth), `CampaignBuilder` (email), `EmailTemplateEditor`, `SegmentPicker`, `ABVariantPanel`, `SendScheduleDialog`, `EngagementStats`, `MilestoneRuleBuilder`.

**Rules:** all email goes through the backend service — the frontend wires UI actions to Hub endpoints, **never** to Meta/SMTP from the browser (credential leakage). Email/ad campaigns never cross entities.

**Interconnections:** Social, CRM (segments/leads), Sales (attribution), E-Commerce (traffic/conversion), Retention (segments as audiences).

---

## 2.17 Social Media Management (6.14) — `/social`

**Roles:** Marketing + CEO. **Scope:** per-entity.
**Purpose:** Create, schedule, publish to Instagram/Facebook/TikTok/YouTube; pull engagement.

**Screens**

- **Content calendar:** all scheduled posts across platforms/brands; drag to reschedule; colour by platform.
- **Composer:** compose once, select platforms, upload image/video, platform-specific captions, schedule. Publishes via official APIs (Meta Graph, TikTok for Business, YouTube Data).
- **Post performance:** likes/comments/shares/saves/views/reach (`social_post_metrics`); which posts drive sales.
- **Connected accounts:** `social_accounts` (OAuth connect/revoke).

**Tables:** `shared.social_accounts, social_posts, social_post_metrics`.

**Components:** `ContentCalendar`, `PostComposer` (multi-platform), `SocialAccountConnect`, `PostPerformancePanel`.

**Interconnections:** Marketing (organic + paid side by side), CRM (engagers → leads), E-Commerce (shoppable posts link to PDPs), Calendar (schedule overlay).

---

## 2.18 Sales Campaigns & Landing Pages (6.22) — `/campaigns` **[NEW — closes audit gap G-2]**

**Roles:** Marketing + CEO. **Scope:** per-entity.
**Purpose:** Time-limited promotional campaigns — flash sales, seasonal, BOGO — each with a high-conversion landing page, countdown, and real-time analytics. (The storefront _renders_ the landing page; this is where it's _built and run_.)

**Screens**

- **Campaign builder:** name, start/end, discount type (% / fixed / BOGO), conditions (min order value, segment, first-time only), and **product selection** (`sales_campaign_products`): Include All / Specific Products / Category-based / **Exceptions** (exclude high-margin or new arrivals). The include/exclude flag is stored as `include_exclude` (`'include'|'exclude'`) — note this is the schema's naming (the Admin doc expected `is_excluded`; same semantics). Generates a unique campaign URL (e.g. `/sale/black-friday-2026`) with auto-appended UTM params.
- **Three states (the core UX):**
  - **Before Launch ("Coming Soon"):** landing page shows countdown + notification sign-up (`sales_campaign_signups`); schedule the launch email/WhatsApp blast.
  - **Live:** original price struck through + discounted price; **real-time stock counter** per product (from Stock SSOT over Socket.io); countdown to end.
  - **Ended:** "Campaign Ended" + "Shop Our Full Collection" CTA (never a broken page for late link arrivals).
- **Real-time analytics dashboard:** visitors/unique, add-to-cart, checkout completions, revenue, AOV, top products, conversion rate, traffic sources (`sales_campaign_metrics`). Post-campaign report auto-generated.
- **Concurrency:** support 2+ fully independent concurrent campaigns — each its own landing page, analytics, product rules; they must not conflict (a product's effective price resolves deterministically; show conflicts at build time).

**Tables:** `{brand}.sales_campaigns, sales_campaign_products, sales_campaign_signups, sales_campaign_metrics`.

**Components:** `CampaignBuilder`, `CampaignStateBadge` (scheduled/live/ended), `ProductSelectionPanel` (include/exclude modes), `CountdownConfig`, `LiveStockCounter`, `CampaignAnalyticsDashboard`, `ShareKit` (pre-formatted IG/WhatsApp/email posts + UTM).

**Rules:** discounted prices must still respect the Pricing min-margin floor (a campaign cannot publish below floor). Real-time stock counters read the SSOT — never a cached count. Campaign purchases earn loyalty points and may stack with coupons only if the CEO allows (Pricing/Retention setting).

**Interconnections:** E-Commerce (landing pages served, discounts applied at checkout), Stock (live counters, deduct), CRM (visitors/buyers captured), Marketing (attribution), Smartcomm (launch blasts), Email Campaigns (teasers/follow-ups), Invoicing (campaign-ref invoices), Retention (points), Dashboards.

---

## 2.19 Customer Retention & Loyalty (6.23) — `/retention` **[NEW MODULE — closes the biggest audit gap, G-1]**

**Roles:** Marketing/CEO configure; analytics for CEO/Ops. **Scope:** per-entity (brand-scoped via `business`).
**Purpose:** The Hub-side admin for the entire retention programme. (Previously only the customer-facing storefront side existed; the CEO had nowhere to configure the programme the backend built tables for.) Sub-routes below.

### `/retention/loyalty` — Loyalty points & tiers

- **Tier editor:** `shared.loyalty_tiers` — `tier_key`, `tier_name`, `min_lifetime_points`, `max_lifetime_points`, `earning_multiplier`, `benefits` (JSONB), `colour`, `display_order`. **D-1: render thresholds from this table; the seeded values (0/5k/25k/100k) contradict the spec (0/500/2k/5k) — surface both and let the owner set canonical.**
- **Points economy view:** `shared.loyalty_ledger` (append-only — read-only here) + `shared.customer_loyalty_state` (materialised — read-only): issued vs redeemed, outstanding liability, tier distribution, average earn→redeem time. Earn rules (purchase/review/referral/milestone/social-share) are config — **D-6: where the spec's star-specific earn-actions exceed the ledger's `transaction_type` enum, mark BLOCKED ON BACKEND.**

### `/retention/coupons` — Coupon engine

- `shared.coupons` CRUD: `discount_type` (% / fixed / free_shipping / buy-x-get-y), `discount_value`, `min_order_value`, `max_discount_value`, `applies_to_products/categories`, `customer_segment_id`, `first_time_only`, validity, `total_usage_limit`/`per_customer_limit`, `is_single_use`, bulk generation (`generation_batch_id`). Track redemptions (`coupon_redemptions` — read-only) for ROI.

### `/retention/subscriptions` — Subscription plans

- `shared.subscription_plans` CRUD: `billing_cycle`, `units_per_cycle`, `price_ngn`, `discount_pct_vs_retail`, `selection_mode` (`customer_picks`/`curator_picks`/`surprise_me`), `benefits`. View active subscriptions (`shared.subscriptions`) + billing attempts (`subscription_billing_attempts` — append-only; after 3 failures the sub pauses and the team is alerted).

### `/retention/bundles` — Bundle offers

- `{brand}.bundle_offers` + `bundle_offer_products` (header + members): pre-built ("Complete Pixie Package"), mix-&-match (qty-scaled discount), service bundles (Faitlyn: Wig + Install + First Maintenance).

### `/retention/maintenance` — Maintenance plans (Faitlyn-relevant)

- `{brand}.maintenance_plans` + `maintenance_subscriptions`: send-in wig washing/reconditioning/restyling on a schedule ("up to N wigs/month at ₦X", or "unlimited for ₦Y/month").

### `/retention/workflows` — Automated retention workflows

- `{brand}.retention_workflow_rules` (trigger-action builder) + `retention_workflow_executions` (append-only log): `trigger_type` covers post-purchase follow-up, **reorder reminder**, **win-back** (90+ days), birthday/anniversary, tier-upgrade nudge, **abandoned cart**, **subscription renewal reminder** (all 8 V2.2 types present). `trigger_conditions`/`action_config` JSONB, `wait_minutes`, `email_template_id`, `coupon_template`, `segment_id`, `rate_limit_days`. Every message is brand-styled.

### `/retention/referrals` — Referral programme

- `shared.referrals` + `referral_redemptions`: unique codes/links, friend discount + referrer reward (points/credit/discount), tiered rewards (after 5, after 10), **anti-fraud** (`redeemed_device_fp`, `fraud_check_result`: passed/flagged_self_referral/flagged_device_match). Admin dashboard: top referrers, conversion, revenue from referrals.

### `/retention/analytics` — Retention Analytics Dashboard (6.23.7)

- CLV (by acquisition channel), repeat-purchase rate (30/60/90d), churn rate + at-risk drill-down (from `churn_risk_scores`), referral performance, loyalty points economy, subscription MRR/churn/lifetime, coupon ROI. Read-only analytics (computed) with time filtering + export.

**Components:** `LoyaltyTierEditor`, `PointsEconomyPanel`, `CouponBuilder` (+ bulk-gen), `SubscriptionPlanEditor`, `BundleBuilder` (header+members), `MaintenancePlanEditor`, `RetentionWorkflowBuilder` (trigger→wait→action), `ReferralRulesPanel` + `ReferralDashboard`, `RetentionAnalyticsDashboard`.

**Rules:** loyalty/streak discounts must respect the Pricing min-margin floor (D-6). Ledger/state/executions are append-only/computed — read-only. Render all thresholds/values from config (D-1). Brand-scoped via `business`.

**Interconnections:** CRM (profile shows tier/points/referrals/subscription/churn), E-Commerce (points at checkout, referral validation, subscription orders), Sales/POS (points/coupons), Smartcomm (automated messages), Email Campaigns (segments), Logistics (timeline powers tracking), Invoicing (subscription invoices), Accounting (points liability, referral cost), Campaigns, Dashboards.

---

## 2.20 Stylist Partner Programme (6.26) — `/stylists` **[PXG; mgmt = Marketing, quality = Ops, payouts = CEO/Finance]**

**Roles:** Marketing runs vetting/onboarding; Operations handles quality/suspensions; CEO approves terms/tiers and authorises payouts. **Scope:** PXG (`brand_id=PXG`).
**Purpose:** Vet, certify, contract, badge, route customers to, and pay partner stylists — with Pixie owning the customer.

**Screens**

- **Applications & vetting:** applications from the public landing (`style.pixiegirlglobal.com`); ID/business verification, portfolio review, brand-alignment questionnaire scored on a rubric, probation before full certification. **Auto-approval is never used** — the UI must require explicit human decisions. `stylist_partners` (`status` lifecycle: application_received → vetted → active / suspended / terminated), `stylist_credentials`, `stylist_specialities`.
- **Tiered certification + verifiable badge:** `stylist_certifications` — tiers **Certified → Pro → Elite** (D-2: render labels from config; the schema's `current_tier_key` + a tier lookup drive this — do not hard-code "Bronze/Silver/Gold" from the Admin doc). Badge: `badge_token` → public verify URL `/verify/badge/{token}`; revocable (`badge_revoked_at`); a QR is just the encoded URL (frontend concern). Contract auto-generated + **e-signed** (reuses Documents 6.13 — **D-4: e-sign is BLOCKED ON BACKEND until signature tables exist**); badge issues on signature.
- **Verified reviews & storefront presence:** only platform-routed customers can review (ratings can't be gamed); the storefront shows the vetted-partner list + each partner's verify page.
- **Smart routing:** nearest first, then weighted by tier, verified rating, availability, specialty; the customer sees the match and chooses. `stylist_assignments` + `stylist_assignment_offers`.
- **Money model & payouts:** customer pays Pixie; Pixie pays the stylist. **Quality-hold payout** — release only after the customer confirms satisfaction or a window passes. `stylist_payouts` + `stylist_payout_lines` (payout details, `paystack_recipient_code`, multi-currency). Two-way earnings (Pixie referral commission; stylist margin on referred wig sales).
- **Partner external dashboard** (stylist portal — see §Part 4): leads, bookings, earnings, payout statements, badge.

**Tables:** `shared.stylist_partners, stylist_credentials, stylist_specialities, stylist_certifications, stylist_assignments, stylist_assignment_offers, stylist_payouts, stylist_payout_lines`.

**Components:** `ApplicationReviewBoard` (rubric scoring), `CertificationAwardDrawer`, `BadgeManager` (issue/revoke + QR preview), `RoutingConfigPanel`, `PayoutWorkbench` (quality-hold release), `PartnerDirectory`.

**Rules:** never auto-approve. Quality-hold gates payout release. Status changes reflect instantly on the public verify page. Payouts are CEO/Finance-authorised (workflow). Cross-border payouts/holding customer funds may need a licensed provider + legal review (planning flag, not a frontend blocker — but surface the payout provider config).

**Interconnections:** public landing (applications), Documents (e-sign contract — D-4), Pricing (commission %), CRM (buyer location for routing), E-Commerce (partner list + verify page), Smartcomm (route the buyer), Accounting (payouts), Dashboards.

---

## 2.21 Retail / Consignment Partners — `/retail-partners` **[NEW — closes audit gap G-3]**

**Roles:** Ops/CEO. **Scope:** per-entity.
**Purpose:** Wholesale/consignment partner master, consignment stock, and settlements (the schema has these 6 tables; the original guide had no screen).

**Screens**

- **Partner editor:** `retail_partners` (margin share, settlement frequency) + `consignment_locations`.
- **Consignment stock & movements:** `consignment_stock`, `consignment_movements` (what's placed where, sold, returned).
- **Settlements** (`/retail-partners/settlements`): `partner_settlements` + `partner_settlement_lines` — periodic reconciliation of consignment sales → amount owed.

**Tables:** `{brand}.retail_partners, consignment_locations, consignment_stock, consignment_movements, partner_settlements, partner_settlement_lines`.

**Components:** `RetailPartnerEditor`, `ConsignmentStockTable`, `SettlementWorkbench`.

**Interconnections:** Stock (consignment movements), Accounting (settlements), Dashboards.

---

## 2.22 Messaging — Smartcomm (6.17) — `/smartcomm`

**Roles:** all (channel-scoped). **Scope:** per-entity (threads never cross entities).
**Purpose:** Unified inbox (Instagram DM + WhatsApp + website chat + email) + internal team channels. Floating launcher on every screen.

**Screens**

- **Customer inbox (two-pane):** conversation list + thread view; reply inline (posts back via the channel API); link-to-CRM; branded templates for order/delivery/payment messages; WhatsApp 24-hour service window indicator (replies free in-window).
- **Team channels:** `#PixieGirl`, `#Faitlynhair`, `#Logistics`, `#General`, DMs, @mentions, file sharing, **voice notes**, read receipts. `shared.message_channels, channel_members, messages, message_reads, message_attachments`.

**Tables:** `shared.message_channels, channel_members, messages, message_reads, message_attachments, notifications, notification_preferences`.

**Components:** `SmartcommInbox` (SplitPane), `ThreadView`, `ChannelSidebar`, `MessageComposer` (templates + voice notes), `WaWindowBadge`. Real-time over Socket.io.

**Rules:** frontend renders the inbox and wires actions to Hub endpoints — never to Meta/SMTP directly. Threads/contacts never cross entities.

**Interconnections:** CRM, Invoicing, Expenses, Contacts, E-Commerce, Logistics, Retention, Campaigns.

---

## 2.23 Documents & Signatures (6.13) — `/documents`

**Roles:** all (view per permission); staff cannot edit/delete stored docs. **Scope:** per-entity.
**Purpose:** Secure digital filing cabinet + branded email-signature builder. **(E-signature flow: D-4 — BLOCKED ON BACKEND.)**

**Screens**

- **Filing cabinet (grid/list):** `shared.documents` — `document_number`, `document_type` (invoice/PO/quotation/contract/certificate/delivery_note/payslip/receipt/settlement/report/stylist_certificate/intercompany_invoice/…), `title`, preview, `content_hash`, linked record (`reference_type`/`reference_id` — soft FK), read-only lock for staff (cannot edit/delete once stored). Tags (`document_tags`).
- **Email-signature builder:** `shared.email_signatures` — one template, auto-personalised per staff member.
- **E-signature flow (FLAGGED):** the original guide promised a signing flow (reused by Stylist contracts). **The schema has no signature tables** — build the UI behind a feature flag and mark it BLOCKED until `signature_requests`/`signature_events` (or equivalent) + endpoints exist. Do not ship a signing UI that writes nowhere. See Appendix C.

**Tables:** `shared.documents, document_tags, email_signatures`.

**Components:** `DocumentGrid`, `DocumentPreview`, `SignatureBuilder` (email sigs), `ESignFlow` _(flagged/disabled until backend)_.

**Rules:** documents immutable to staff once stored (`is_deleted` soft-delete only, by privileged roles). `reference_id` is a soft FK across schemas — handle missing targets gracefully.

---

## 2.24 Calendar & Scheduling (6.18) — `/calendar`

**Roles:** all (own calendar); CEO sees all staff calendars. **Scope:** per-entity.
**Purpose:** Shared calendar — appointments, meetings, content schedule, leave, deliveries, bookings.

**Screens:** month/week/day/list views; colour by type; drag to reschedule; clash detection; resource booking (`event_resources`); meeting notes → follow-up tasks; social content overlay. **Owner view:** CEO sees every staff calendar; staff see only their own + shared events.

**Tables:** `shared.calendar_events, event_participants, event_resources`.

**Components:** `CalendarView` (multi-mode), `EventDrawer`, `ResourceBookingPanel`, `ClashWarning`.

**Interconnections:** CRM, Contacts, Tasks, HR (leave/attendance), Social (content schedule).

---

## 2.25 Tasks & To-Do (6.19) — `/tasks`

**Roles:** all. **Scope:** per-entity.
**Purpose:** Visual task board; tasks from other modules appear automatically.

**Screens:** board columns by urgency (Inbox / Today / This Week / This Month / Later / Done); priority, due dates, sub-tasks (`task_subtasks`), assignment, linking to customers/orders. "My tasks" + team board. **Assign-from-Contacts:** create/assign a task to a staff member from their contact card. Service-job assignment auto-creates a stylist task (see Production).

**Tables:** `shared.tasks, task_subtasks`.

**Components:** `TaskBoard` (Kanban), `TaskCard`, `SubtaskList`, `AssignFromContact`.

**Interconnections:** Calendar, CRM, Contacts, Purchasing, Production (service-job tasks), Performance (review actions).

---

## 2.26 Contacts & Directory (6.12) — `/contacts`

**Roles:** all (per permission). **Scope:** per-entity (note: `shared.contacts` has no `business` column — scope is applied via the relationships/segments and server logic; always pass entity).
**Purpose:** Single source of truth for every person/business — customers, factory contacts, suppliers, 3PLs, staff.

**Screens:** unified directory DataTable; profile drawer with cross-module history, assign-task, view-calendar; addresses (`contact_addresses`), tags (`contact_tags`), segments (`contact_segments`); custom fields from `custom_field_defs` (`entity_type='contact'`).

**Tables:** `shared.contacts, contact_addresses, contact_tags, contact_segments`.

**Components:** `ContactDirectory`, `ContactProfileDrawer` (shared with CRM), `SegmentBuilder`.

**Interconnections:** all modules (central reference), Smartcomm, Calendar, Tasks.

---

## 2.27 Dashboards & Reports (6.20) — `/dashboard`

**Roles:** all (scoped); CEO gets the global (entity=ALL) view. **Scope:** per-entity + ALL for CEO.
**Purpose:** Real-time control centre with drill-down, respecting access control.

**Screens**

- **Global dashboard (CEO, entity=ALL):** cross-entity rollup.
- **Entity dashboards:** Sales, Customers (pipeline/acquisition/retention/churn), Finance (income vs expenses, receivables, cash flow), Stock, Logistics, Marketing, E-Commerce, Retention, HR — each a set of `dashboard_widgets` on a `dashboard_configs` layout (drag-and-drop). Time filtering; export PDF/Excel; **respect access control** (a role only sees permitted tiles; hidden fields never appear).
- **Saved reports & scheduled report templates:** `saved_reports` (report builder), `report_templates` (the V2.2 weekly Sales + Customer auto-reports, Saturday 8 PM) — managed in Settings/Reports (§2.31). `report_runs` + `report_run_outputs` history.

**Tables:** `{brand}.dashboard_configs, dashboard_widgets, saved_reports, report_templates, report_runs, report_run_outputs`.

**Components:** `DashboardGrid` (drag-and-drop), `KpiTile`, `Chart`, `WidgetLibrary`, `ReportBuilder`, `ExportMenu`.

**Rules:** widgets/reports respect permissions and entity scope. Computed roll-ups are read-only. System widgets seeded (8); custom widgets via a guarded SQL/spec editor (CEO).

---

## 2.28 Storefront Studio (6.28) — `/storefront-studio` **[CEO; flagship bespoke build]**

**Roles:** CEO. **Scope:** edits **only** `pixiegirlglobal.com` (the public storefront) — never the Hub (`hub.…`) or the stylist portal (`style.…`).
**Purpose:** Visual, no-code, **bounded** storefront editor — restyle/rearrange without breaking mobile or going off-brand.

**Screens / interactions**

- **Theme editor (design tokens, not code):** colours, fonts, corner-roundness, spacing density, button styles, logo, hero imagery — seeded from the brand system. **Brand-lock ON by default** (palette/fonts stay on-identity; CEO must deliberately unlock to experiment). Writes `shared.storefront_themes` (draft/publish; one published + optional draft per brand).
- **Block-based layout (bounded, mobile-safe):** add/remove/reorder pre-built responsive sections (hero, product grid, video gallery, testimonials, sisterhood banner, newsletter, FAQ) by drag-and-drop. A **bounded block library**, not a free canvas — broken mobile layouts are impossible by construction. Writes `shared.storefront_pages`.
- **Editable text with structural limits:** per-slot character limits (e.g. 100-char headline) with a live counter; prevent exceeding. Navigation builder (`shared.storefront_navigation`).
- **Media library:** approved UGC + uploads (from the UGC pipeline) to drag into "Styled by you" / product carousels.
- **Draft → Preview → Publish flow** with **one-click revert** to the last published version (`shared.storefront_revisions` — snapshot of every publish; read-only history).
- **Order Timeline Vocabulary editor** _(`/storefront-studio/timeline-vocabulary` — NEW; table `shared.timeline_event_codes`)_: edit the customer-facing timeline labels (`code`, `default_label`, `applies_to_order_types`, `stage_group`, `default_customer_visible`, `display_order`) so the owner can extend the vocabulary (e.g. "Weaving in Progress") without code. System codes (`is_system_code`) are protected from deletion.
- **Delivery Letter Templates editor** _(`/storefront-studio/letter-templates` — NEW v2.2+)_: WYSIWYG editor for the brand-styled letter that auto-prints with every order (see Logistics 6.10). One or more templates per brand, optionally per product type (stock vs custom — different opening line/tone). Edit: letterhead layout, the personalised welcome note body (rich text), Faith's signature image upload (set once, used forever), QR position, footer. **Merge tokens** rendered as a side panel of clickable chips: `{customer.first_name}` · `{wig.name}` · `{wig.length}` · `{wig.colour}` · `{wig.texture}` · `{delivery.city}` · `{order.number}` · `{install.qr}` (auto-rendered as the QR image). Live preview against a sample order. Publish/draft/revert workflow same as the rest of Storefront Studio.

**Tables:** `shared.storefront_themes, storefront_pages, storefront_navigation, storefront_revisions, timeline_event_codes`.

**Components:** `ThemeEditor` (token controls + brand-lock), `BlockCanvas` (bounded drag-and-drop), `CharLimitedText`, `NavBuilder`, `MediaLibrary`, `DraftPreviewPublishBar` (+ revert), `TimelineVocabularyEditor`.

**Rules:** scope is the storefront only; never edits Hub or stylist subdomains. Brand-lock on by default; responsive blocks only; char limits enforced (prompt + block). Genuinely new storefront behaviour is a JBS Praxis build, not a toggle — state this in the UI.

---

## 2.29 Praxis AI Agent — Frontend (6.29) — global floating button + chat drawer

**Roles:** **CEO only in V1** (expandable via AI Control). **Scope:** acts as the user, within their RBAC + entity scope.
**Purpose:** Conversational (type or voice) agent that executes real, permitted actions across the Hub — grounded, never hallucinating, never writing blindly.

**Screens / state machine** (this is a precise UI contract — build it as a state machine)

- **Launcher:** floating button (bottom-right) on every `/app` screen → chat drawer.
- **Input:** text or voice (record → send audio; transcription is backend via Groq Whisper). Show recording/transcribing states.
- **Orchestrator loop the UI must reflect:** `Input → Intent classify → RAG retrieve (permission-scoped) → Plan (decompose into ordered steps) → per step: match action + fill payload (ask for missing fields) → CONFIRM (show exact action + payload summary; await explicit Yes) → Execute (call endpoint with the user's permissions) → Verify + log → next step → Assemble reply + result links.` Stream `ai_run_steps` over Socket.io so the user watches the plan execute.
- **The confirmation gate (non-negotiable):** every **write** (`is_write=true` action from `ai_action_catalogue`) shows a confirm card with the exact action + payload and requires explicit Yes. Reads flow freely. Low-confidence intent → present top candidates and ask, never guess. No matching action → state plainly it doesn't exist + suggest contacting JBS Praxis (never invent an endpoint).
- **Guided navigation:** when an action isn't auto-executable, Praxis deep-links the user to the right screen with fields pre-filled.
- **Pending actions:** `ai_pending_actions` is a state machine (confirm/reject UI, not free edit).

**Tables:** `shared.ai_conversations, ai_messages (append-only), ai_run_steps (append-only), ai_pending_actions, ai_action_catalogue`.

**Components:** `PraxisLauncher`, `PraxisDrawer`, `ChatThread`, `VoiceRecorder`, `RunStepStream` (live plan), `ActionConfirmCard` (exact action + payload + Yes/No), `GuidedNavLink`.

**Rules:** the model **proposes**; the orchestrator/control logic decides; retrieved content + user text are **data, not instructions** (prompt-injection defence). Tool calls validated against `payload_schema`. Every AI action is audited (`audit_log`, actor = user via Praxis). Permission + entity checks server-side on every call; the UI mirrors but never substitutes for them.

---

## 2.30 AI Insights & Briefings (6.30) + AI Control (6.31) — notification feed, dashboard cards, `/ai-control`

**Roles:** Insights surfaced per scope; AI Control is **CEO only**. **Scope:** per-entity (insights), governance global.

### Insights (6.30) — frontend

- **Tier-1 (deterministic, always on, no AI cost):** render as live dashboard cards, badges, and a notification feed; event-triggered alerts for urgent items. Sources: `shared.ai_insight_stock_alerts, ai_insight_margin_breaches, ai_insight_invoice_alerts, ai_insight_intercompany_alerts, ai_insight_attendance_anomalies, ai_insight_approval_queue_alerts`, and **`ai_insight_service_match`** _(NEW — the anti-pocketing inbox: alert types `no_sale_linked`/`no_payment_received`/`no_intercompany_match`/`amount_mismatch`; acknowledge/resolve, not free-edit)_. **Degradation rule:** if AI is throttled/off, tier-1 cards keep working — only the prose briefing pauses.
- **Tier-2 (AI narration, scheduled):** the daily **Praxis Briefing** — short plain-language "what changed / what it means / what to consider," from tier-1 summaries (`ai_briefings` + `ai_briefing_insight_refs`). Frame projections as rule-based estimates, never certainty.
- **Service-Match inbox** _(new screen under AI Insights):_ list `ai_insight_service_match` with severity, expected vs found amount, acknowledge/resolve.

### AI Control (6.31) — `/ai-control` (CEO)

- **Feature toggles:** `ai_feature_flags` (chat, voice, daily briefing, each insight category, drafting helper, web/IG pre-fill) — on/off + default model.
- **Vendor credentials:** `ai_vendor_credentials` (DeepSeek/Groq/OpenAI keys — **encrypted, masked, rotate button**, never shown; per-token costs; per-vendor monthly caps).
- **Access grants:** `ai_access_grants` (per-user × feature matrix — expand beyond CEO as budget allows).
- **Budget:** `ai_budget_periods` (monthly soft warning + hard stop; on hard-stop AI pauses gracefully and tier-1 keeps running).
- **Live spend meter:** current month usage + estimated cost **by feature and by vendor** (`ai_usage_ledger`, `ai_usage_daily` — append-only; include `audio_seconds` for Whisper).
- **Action catalogue governance:** `ai_action_catalogue` list with bulk enable/disable (`ai_enabled`), `entity_scope`, `is_write`, `min_confidence` sliders. New endpoints appear disabled until reviewed.
- **Knowledge corpus:** `ai_knowledge_chunks` (SOPs/policies upload + chunk preview; access-scope tags drive permission-scoped retrieval). Embeddings live in `ai_embeddings` (model+version+source_text retained) — show embedding status/staleness.

**Components:** `InsightCardDeck`, `NotificationFeed`, `BriefingPanel`, `ServiceMatchInbox`, `FeatureToggleGrid`, `VendorKeyManager` (masked + rotate), `AccessGrantMatrix`, `BudgetMeter` (by feature + vendor), `ActionCatalogueGovernance`, `KnowledgeUploader`.

**Rules:** keys masked/encrypted, CEO-only, change-logged. Budget hard-stop pauses AI but never tier-1. All AI usage metered per vendor (Whisper bills per audio-minute → track `audio_seconds`).

---

## 2.31 Settings & Business Setup (6.21) — `/settings`

**Roles:** Profile/Security/Notifications = all; Business Setup & config = CEO. **Scope:** per-entity (config), profile = self.
**Purpose:** Administration: configure each brand and the platform; the home for config CRUDs that don't live inside a module.

**Tabs / sub-screens**

- **Profile** — name, photo, contact, language, preferred display currency.
- **Security** — change password, manage 2FA, active sessions (`user_sessions`), "sign out everywhere" (`refresh_tokens`).
- **Notifications** — per-channel toggles (`notification_preferences`).
- **Business Setup (CEO)** — `shared.business_config` (name, prefix [immutable after first issuance], address, TIN/CAC, mission, logo, accent/fonts, `vat_rate`/`wht_rate`, loyalty defaults, IC settings, cancellation rules, payment-method blobs); **currencies** (`shared.currencies` — toggle active; pre-seeded NGN/USD/GBP/EUR/CAD/GHS); **FX** (`shared.currency_rates` — _NOT_ "fx*rates"; manual override per day or auto-feed); **payment gateways** (Paystack/**Opay**/Nomba/Stripe credentials — masked, CEO-only, change-logged; **primary/fallback assignment** for local-Naira tier: Paystack primary, Opay automatic fallback); **gateway fee schedules** *(NEW v2.1+; table `payment_gateway_config` or equivalent)\_ — per gateway, per currency: pct fee, fixed fee, cap; feeds Pricing engine gross-up (6.25) and Accounting Payment Processing Fees account (6.6); **document templates**; **tax rules** (`shared.tax_rates`); **work-site coordinates** (`shared.geofences` — map editor); **funding-source rates** (production `funding_sources` FX).
- **Installment defaults (CEO)** _(NEW v2.1+, lives within Business Setup)_ — default `payment_model` per product type (Layaway / Deposit-triggered), default deposit % (default 50%), abandonment window for Layaway orders (default 60 days no payment → auto-cancel), and reminder cadence for outstanding balances (feeds Smartcomm + Retention 6.23). Each value is per-brand and overridable per-product on the product editor.
- **Manual-payment toggle (CEO)** _(D-8, NEW v2.2+)_ — a single hard switch `allow_staff_manual_payments` on `business_config`. **Ships OFF.** Show an explainer card next to the toggle: "Until a dedicated Finance lead is hired, every customer payment must go through a gateway for independent confirmation. Turning this ON will reveal the **Record Manual Payment** button across Sales (6.2), which lets staff record direct bank transfers using a mandatory transaction ID." Toggling ON requires a confirmation modal (the change is audit-logged with who/when). Toggling OFF is allowed but rare — confirm before doing so.
- **Public Order Form config (CEO)** _(NEW v2.1+; see E-Commerce §2.4)_ — the brand's `/order` URL slug, the active field set, the gateways offered for payment-now (read-only mirror of the gateway config above), and staff-mode link generator visibility.
- **Custom Fields (CEO)** _(`/settings/custom-fields`; table `shared.custom_field_defs`)_ — define per-entity custom fields (`entity_type` ∈ product/contact/deal/order/stylist).
- **Document Numbering (CEO)** _(`/settings/document-numbering`; table `shared.document_numbering`)_ — per-doc-type prefix/padding.
- **Bank Accounts (CEO)** _(`/settings/bank-accounts`; table `shared.bank_accounts`)_ — company accounts for AR/AP + reconciliation; masked account numbers.
- **Scheduled Reports (CEO)** _(`/settings/reports`; table `{brand}.report_templates`)_ — section editor, cadence picker, recipients, output formats, staff-confirmation toggle.
- **Roles & Access** — deep-link to Org & Workflow Builder (6.27).
- **Storefront** — deep-link to Storefront Studio (6.28).
- **AI** — deep-link to AI Control (6.31).

**Components:** `SettingsTabs`, `FormSection`, `SaveBar`, `MaskedField`, `SessionList`, `CurrencyToggleList`, `FxRateEditor`, `GatewayCredsPanel`, **`GatewayFeeScheduleEditor`** (v2.1+), **`PrimaryFallbackAssigner`** (v2.1+), `GeofenceEditor` (map), `CustomFieldDefEditor`, `DocumentNumberingTable`, `BankAccountEditor`, `ReportTemplateEditor`, `FundingRateEditor`, **`InstallmentDefaultsEditor`** (v2.1+), **`ManualPaymentToggle`** (v2.2+; D-8 with confirmation modal), **`PublicOrderFormConfigEditor`** (v2.1+).

**Rules:** sensitive fields masked, CEO-only, change-logged. `document_prefix` and doc prefixes immutable after first issuance. Render currency list from `currencies`, never hard-code. Wire FX to `currency_rates` (not the Admin doc's `fx_rates`). **Gateway fee schedule changes invalidate all proposed prices in Pricing 6.25 and surface a "fee schedule changed — review pricing" alert** (the gross-up math depends on these values).

---

## 2.32 Cash Request & Disbursement (6.32) — `/cash-requests` **[NEW v2.1+]**

**Roles:** all staff submit; Finance validates; CEO approves; Finance disburses. **Scope:** per-entity.
**Purpose:** Dedicated workflow for staff to request company money before the spend happens (petty cash, fuel float, vendor deposit, travel advance), with audit-grade evidence at every step. Distinct from Expenses (6.7), which handles "I already paid out of pocket."

### Sub-screens

- **`/cash-requests/my`** — the requester's view. List of own requests with status pill (`Draft / Pending Finance / Pending CEO / Approved / Disbursed / Rejected / Sent Back / Settled`), amount, age, last decision-maker. "New Request" CTA opens the submit drawer.
- **`/cash-requests/queue`** — Finance view. List of all requests in `Pending Finance` (validation) + `Approved` (awaiting disbursement). Two tabs to separate the queues. Bulk actions disabled (every decision is per-request, intentional friction).
- **`/cash-requests/approval`** — CEO view. List of all requests in `Pending CEO`. The CEO sees the requester's note, the Finance validator's note, the supporting docs, and a summary card.

### Submit drawer (Stage 1 — any user)

- **Type radio:** `Cash Advance` ("I need money before spending — must settle afterward") vs `Reimbursement` ("I already spent, need it back, with receipts attached"). Each choice changes the helper text and the required-attachments rule.
- **Amount + currency** (from active `currencies`); purpose (textarea, required); cost-centre/account dropdown (from `chart_of_accounts`, filtered to expense accounts).
- **Supporting docs** (file upload to Documents): for Reimbursement — receipts mandatory; for Cash Advance — vendor quote / invoice photo / justification optional but encouraged.
- **Bank details preview (read-only):** auto-filled from the requester's `staff_profiles.bank_account_*`. **If missing, the form blocks submission** with a clear "Update your profile bank details first" link to `/settings/profile`. This is the single most important friction prevention: never let a request stall at disbursement because nobody knows where to send the money.
- **Submit** → status flips to `Pending Finance`, notification fires via Smartcomm to the Finance role.

### Finance validation drawer (Stage 2)

Reviewer sees: full request, requester, attachments, bank details preview. Three actions:

- **Validate** → flips to `Pending CEO`. (If amount is below `approval_threshold_ngn` and the threshold-skip is enabled in Org & Workflow Builder, the request skips this step and goes straight to `Approved` — surface "auto-approved (below threshold)" in the history.)
- **Send Back for Revision** → required note → flips to `Sent Back`. Requester edits and resubmits; history preserved across the revision cycle.
- **Reject** → required reason → terminal `Rejected`. Cannot be undone (a new request must be created if needed).

### CEO approval drawer (Stage 3)

Same three actions as Finance, terminating in `Approved` or `Rejected` or returning to the requester via `Sent Back`. Show prior Finance validator's note and any revision history.

### Finance disbursement drawer (Stage 4) — **the audit-anchor screen**

- Shows the full approved request + the requester's bank details (account name, bank, account number).
- **"I have made the transfer" form:**
  - **Bank transaction ID (MANDATORY).** Free-text (different Nigerian banks use different reference formats — Zenith / GTB / UBA / Kuda all differ; we require _something_, never try to validate the shape).
  - Optional receipt screenshot upload (to Documents, `document_type='disbursement_receipt'`).
  - Optional note ("transferred from account ending …").
  - Disbursement date (defaults to today; editable).
- **Submit:** the request flips to `Disbursed`. The system auto-creates an Expense (6.7) under the chosen cost-centre, with `expense.source_type='cash_request'` and `source_id={request_id}`. Bank Reconciliation (6.6) gets the disbursement as an unmatched outflow waiting for the bank statement line.
- **Match status pill (post-disbursement):** `Pending Match` / `Matched` (auto-matched on bank-statement import) / `Manual Match` (Finance ticked it). Visible on the request detail and on the Expense it spawned.

### Cash Advance settlement (post-disbursement, Cash Advance type only)

When a Cash Advance is `Disbursed`, the requester gets a "Settle this advance" task in Tasks (6.19). The settlement form:

- Lists the advance amount.
- "Receipts" file upload (one or more, multi-upload).
- "Change returned" amount (if any).
- Submit → request flips to `Settled`. If `receipts_total + change_returned ≠ advance_amount`, the difference is logged and routed to Finance for review.
- **Unsettled advances:** server-side cron flags advances older than the configured window for payroll deduction (HR 6.11). UI shows a "Settlement overdue" badge on the request and a notification fires.

### Status timeline (read-only, on every request)

Vertical timeline component showing every state change: who, when, decision, note. This is the audit chain — make it clean and obvious. Use the existing `<Timeline>` primitive.

**Tables:** `{brand}.cash_requests` (+ history table), `{brand}.cash_advance_settlements` (existing); auto-posts to `{brand}.expenses`; feeds `shared.audit_log`. (Confirm exact `cash_requests` table name/columns with backend; the audit's Appendix C will list this as a structural addition if not yet present. Build the UI against the spec; flag any missing column when integrating.)

**Components:** `CashRequestList`, `CashRequestSubmitDrawer` (type radio + bank-details guard), `FinanceValidationDrawer`, `CeoApprovalDrawer`, `DisbursementDrawer` (the mandatory transaction-ID form — this is the critical one), `MatchStatusPill`, `SettlementForm`, `Timeline` (status history).

**Rules:**

- **Transaction ID is mandatory; format is not validated** — different Nigerian banks use different references. Reconciliation against the bank statement is what proves correctness.
- **Manual disbursement only, never via gateway.** The disbursement drawer does NOT integrate Paystack/Opay/Stripe — Finance makes the transfer in their own banking app and brings the transaction ID back. This is deliberate: gateways exist to _receive_ customer money, and using them for internal outflows would just be paying 1.5% to move company money to a staffer's account.
- **Bank-details guard at submit** prevents the "stalled at disbursement because requester has no bank details on file" failure mode.
- **Send Back for Revision** preserves history and lets the requester edit; Reject is terminal.
- **Threshold-skip is per-entity config** in Org & Workflow Builder (6.27); CEO can override by ticking "needs CEO sign-off" on the request itself.
- **Audit-write fired on every transition** (who, when, decision, note — including the transaction ID entry).
- **Permission gates:** any user can view their own requests (`/my`); Finance role sees `/queue`; CEO sees `/approval`; only Finance can fill the disbursement drawer; only the requester can fill the settlement form.

**Interconnections:** HR (6.11) — bank details, payroll deductions for unsettled advances; Org & Workflow Builder (6.27) — approval threshold + routing; Smartcomm (6.17) — stage notifications; Documents (6.13) — supporting-doc + receipt storage; **Expenses (6.7) — auto-posts on disbursement**; Accounting (6.6) — entry + transaction-ID feed into Bank Reconciliation; AI Insights (6.30) — alerts on stale unmatched disbursements.

**Edge cases:**

- Requester goes on leave between submission and approval — the request stays in queue; revisions can be assigned to a deputy via Org Builder if configured.
- Finance and CEO are the same person at launch (Faith). The system **still requires both clicks** — the role of validation and approval are tracked separately even if the same person does both, so when Finance is hired, the historical data already separates them.
- Currency mismatch between request and disbursement: rare, but if happens, the disbursement records its own currency + FX rate (mirrors how `sales_order_payments` handles partials).

---

# PART 3 — THE STOREFRONT (public site, Next.js SSR)

**Mandate:** fully replace Shopify — own every pixel, every customer record, every transaction. SSR for SEO; native everything (no Klaviyo, no chat-widget SaaS, no YouTube/IG iframes). Three principles: **fast on Nigerian networks**, **owned & native**, **conversion-engineered**.

### 3.1 Design system & "physics"

Separate, more expressive token set than the Hub (driven by `storefront_themes`, themeable per brand via Storefront Studio). Signature interactions (smooth scroll reveals, sticky add-to-cart, cart drawer, micro-interactions) are part of the brand — keep them, but never at the cost of CLS/LCP. Respect `prefers-reduced-motion`.

### 3.2 Pages

- **Homepage** — a sequenced funnel: hook → proof → objection-handling → social proof → loyalty. Blocks defined by `storefront_pages` (rendered, bounded). Heavier systems (loyalty hub, hair quiz, stylist directory, subscriptions) live on dedicated pages reached from compact entry-points (density is sequenced, not stacked).
- **PDP (product page)** — high-res gallery (zoom/swipe/fullscreen, WebP, lazy), **native self-hosted video** (poster first, loads on click — no iframes), wig attributes (texture/lace/length/density/cap/colour — searchable/filterable), variant selector, reviews + ratings (verified-buyer, with photos; JSON-LD rich snippets), related products ("complete the look"), **Subscribe & save** widget, cart drawer with free-shipping progress + volume-discount nudges + transparent loyalty discount. Reads published prices (set in Pricing — fee already absorbed via D-7) and live stock (SSOT). **Payment-model badge:** PDPs for stock items show "Pay any amount — ships when paid in full" (Layaway); custom/styled PDPs show "50% deposit unlocks production" (Deposit-triggered). The badge is rendered from `product.payment_model`.
- **Category/Collection** — dynamic (`product_collections`/rules), smart search + filtering (typo-tolerant), breadcrumbs.
- **Multi-currency** — IP detection (MaxMind) sets currency on first visit; visible header switcher persists choice to session/return visits. Render with the stored rate semantics; settlement always NGN.
- **Cart & checkout** — persistent cart (`shared.carts`/`cart_items` — soft FK to products/orders), guest checkout, saved addresses, coupon/points entry (validated server-side), real-time shipping (Chowdeck Lagos / GIGL nationwide), clear order summary in the selected currency. **Payments: Paystack & Opay (local; primary + automatic fallback per Business Setup), Nomba, Stripe (international). No Pay-on-Delivery — every wig is styled/customised before shipping, so the order cannot enter production until payment clears (v2.1 product decision).** For custom/Deposit-triggered items, the checkout collects the deposit amount (default 50%, configurable) and the balance is paid later via the Pay-Link or customer account. Published price already includes gateway fee (D-7 gross-up) — customer sees one clean total, no "+₦X processing fee" line. Abandoned-cart recovery (configurable wait → email/WhatsApp).
- **`/order` — Public Order Form** _(NEW v2.1+; no-login, public)_ — the no-friction order-capture page for IG/FB/WhatsApp customers. Single-page form: first name, last name, **day & month of birth** (auto-enrols the customer in birthday-discount automations in Retention 6.23), billing address, delivery address with "same as billing" toggle (default ON), phone, email, product picker (categories/search/variants like the storefront, simplified). Pay at checkout (same gateway tier as storefront, no PoD). **Two modes — same form:**
  - **Public mode** (default): any visitor opens the URL, fills it themselves.
  - **Staff mode** (deep-linked from CRM/Sales when logged in): the staffer either generates a one-time link to send the customer, or fills the form live during the WhatsApp/IG call. Sales attribution is preserved — the resulting `sales_orders` row carries the staffer's user ID for commission. `sales_channel` is tagged `'public_form'` (public mode) or `'whatsapp'/'instagram'/'facebook'` (staff mode, picked from a small "I'm helping a customer who came from…" selector).
  - **Smart contact handling on submit:** match `email + phone` against `shared.contacts`. If matched, merge (with a confirmation prompt in staff mode; silent in public mode but logged). Otherwise create a new contact + CRM customer profile. The birthday month/day immediately enrols the new contact in the birthday-discount automation.
  - **Confirmation page** post-payment: shows order number, the QR/tracking link, and "We'll let you know when we start working on your wig" (or, for Layaway, "Pay anytime — here's your balance and your pay-link").
- **`/pay/{order_token}` — Public Pay-Link** _(NEW v2.2+; no-login, public, token-protected)_ — the page customers land on from the Smartcomm pay-link reminder. Shows: order number · the wig(s) ordered · total · paid · balance · "Pay any amount" form with the gateway choice. Token reuses `public_tracking_token` from `sales_orders`. On submit, routes through the active gateway (Paystack primary, Opay fallback) and creates a new `sales_order_payments` row via webhook on success. Success page shows the new balance and (if zero) "You're paid in full — we're on it." Loyalty points earned proportionally per partial.
- **`/install/{order_token}` — Curated Install Hub** _(NEW v2.2+; no-login, public, the QR target on the printed letter)_ — see §3.6 below.
- **Content pages & blog** — `storefront_content_posts` (About, Wig Care Guide, Blog with inline products, FAQ with FAQ schema). SSR + structured data.
- **Order Timeline / live tracking (`/track/{order_token}`)** — branded timeline from `order_timeline_events` (vocabulary from `timeline_event_codes`): Order Placed → Confirmed → (Weaving in Progress, custom) → Quality Check → Packaging → Dispatched → In Transit (Chowdeck rider map) → Out for Delivery → Delivered. Notifications at each transition (WhatsApp/email, Meta-approved templates). `tracking_links` (rotateable token).
- **Customer account — `/account`** — orders, tracking, addresses, **wishlist** _(no backing table — BLOCKED ON BACKEND; build UI, flag — see Appendix C)_, subscriptions (maintenance), loyalty/referrals dashboard, Streak Stars balance/tier/progress.
  - **`/account/orders` — My Orders self-serve installments** _(NEW v2.1+)_. Each order card shows: order number · status pill · total · **balance pill** (amber if outstanding, green if paid) · payment-model badge · "Pay any amount" CTA per card (opens the same payment flow as `/pay/{order_token}` without needing the token). Click an order → detail view with full payment history (every partial), tracking link, and re-order CTA. **This is the long-tail companion to the Pay-Link:** customers who set up an account once can pay any balance any time without hunting for a link.

### 3.3 Native engines

- **Streak Stars & loyalty** (3-step "sign up → earn ★ → bigger lifetime discount"): display balance/tier/progress from loyalty config. **D-6: star-specific earn-actions (IG follow, UGC-upload boost, newsletter, add-birthday) and lifetime-discount semantics that exceed the `loyalty_ledger.transaction_type` enum + tier model are BLOCKED ON BACKEND — render what the schema supports, flag the rest.** Loyalty discounts must never break the Pricing min-margin floor.
- **UGC ingestion pipeline:** curation queue in E-Commerce admin (§2.4) → backend downloads IG media (URLs expire 24–48h → copy file), FFmpeg compress + poster → own-server storage (abstraction; no S3/Cloudinary) → DB record + SKU link + "Verified UGC" tag → Storefront Studio media library → renders as native HTML5 video with a "Shop this look" link. `shared.product_reviews` for reviews; `{brand}.product_videos` for video.
- **Reviews:** verified-purchase only, moderated, photo support, aggregated stars (JSON-LD).
- **Hair Quiz:** "Find your style" stepper → product recommendations + capture as CRM lead with answers + award stars. **D-5: no quiz tables exist — BLOCKED ON BACKEND; build the `QuizStepper` UI, flag.**
- **Subscriptions:** cadence, paused/active/cancelled, next-charge date, self-serve manage; surfaces on PDP + `/subscriptions` account page.
- **Discounts:** volume-discount table (PXG 2=$10/3+=$22, custom excluded), BOGO popups, coupon entry — all server-validated, floor-respecting.

### 3.4 Components (storefront)

`ProductGallery`, `NativeVideo` (deferred), `VariantSelector`, `ReviewStars`, `ReviewList`, `QuizStepper` _(flagged)_, `SubscribeWidget`, `SubscriptionManager`, `VolumeDiscountTable`, `BogoPopup`, `CartDrawer`, `ShippingProgressBar`, `CurrencySwitcher`, `OrderTimeline`, `LoyaltyHub`, `StylistDirectory`, `ContentPostRenderer` (blog/FAQ with schema), **`PublicOrderForm`** (v2.1+), **`PaymentModelBadge`** (v2.1+), **`PublicPayLinkPage`** (v2.2+), **`MyOrdersBalanceList`** (v2.1+; the self-serve installment view), **`InstallHub`** (v2.2+; see §3.6).

### 3.5 Architecture, video & performance

SSR (Next.js), code-split, CDN. **Native video policy: no iframes, ever** — self-hosted, deferred (poster → load on click). Personalised bits (cart, name, loyalty balance) hydrate client-side after interactive. Defer the very few remaining third-party scripts via `@next/third-parties`. Image pipeline: WebP, responsive sizes, lazy loading. Budget Core Web Vitals on the storefront (LCP/CLS/INP) — it's a ranking factor and a conversion factor on Nigerian networks. Net result vs a Shopify/Regirl-style site: same conversion mechanics, statically fast, fully owned, immune to app outages, and every interaction (loyalty, reviews, UGC, quiz, installment payments) feeds the Hub + AI Insights instead of a third party.

### 3.6 The Curated Install Hub — public page spec (v2.2+)

Public, no-login, token-protected at `/install/{order_token}` where `order_token` is the existing `public_tracking_token` from `sales_orders` (same token, second purpose — no new tables). This is the page the QR on the printed delivery letter resolves to.

**Render flow (SSR):**

1. Resolve token → fetch order summary (variant attributes: texture, lace type, length, colour; customer first name; delivery city; order number; delivery date if known).
2. **Pick the right install video:** match against UGC pipeline + branded explainers by `(texture, lace_type, length)` priority. Fall back gracefully (closest match) if no exact hit; never show a blank state.
3. **Pick the right Wig Care Guide:** match `storefront_content_posts` where `post_type='wig_care_guide'` and tags/categories overlap the variant's attributes.
4. **City-filtered stylist directory:** query `shared.stylist_partners` where `city = order.delivery_city AND status = 'active' AND current_tier_key IN (...)`; show top 2–3, each linking to their `/verify/badge/{badge_token}` page.
5. **Review request:** check `delivered_at + 7 days ≤ now`; if true and no review yet for any variant in the order, show "Tell us about your wig" CTA → opens the review form, awards Streak Stars on submit.
6. **Re-order CTA:** maintenance products matched to the variant (oils, edge control, satin caps in matching colour) — links to the Public Order Form or storefront PDPs.

**Visual layout (mobile-first; the customer scans the QR with their phone):**

- Hero: "Welcome, {first_name} — let's get your {wig_name} installed."
- Big native HTML5 video (poster, plays on tap).
- Below the fold, in order: written wig-care tips (the matched Wig Care Guide rendered as `<ContentPostRenderer>`), the "Need help installing?" CTA opening a pre-populated WhatsApp thread (`https://wa.me/{brand_phone}?text=Hi, I need help installing my order {order_number}`), the city-filtered stylist directory cards, the review request CTA (unlocked after window), the re-order CTA cards.
- Footer: brand identity + "From all of us at Pixie Girl Global / Faitlyn." (Or read from `business_config.tagline`.)

**Component:** `<InstallHub>` — orchestrates the six render-flow steps; sub-components reuse existing primitives (`<NativeVideo>`, `<ContentPostRenderer>`, `<StylistDirectory>`, `<ReviewStars>`).

**Performance & SEO:** SSR; the install video is the LCP element — preload its poster; defer the stylist directory & re-order grid until below-fold. **Do not index publicly** — the page contains an order's details; set `<meta name="robots" content="noindex,nofollow">`. The QR is the only intended discovery vector.

**Privacy:** the token grants read-only access to the customer's first name, the wig details, and the delivery city — no email, no phone, no full address. If the token is leaked, exposure is bounded. The "Need help" WhatsApp link uses the brand's number, not the customer's. Same privacy posture as `/track/{order_token}`.

**Failure & edge states:**

- Invalid/revoked token → friendly 404 ("This install guide isn't available — please check the QR or contact us"); never reveal whether the token exists.
- No matching install video → show the closest-match generic install video + a banner ("We're building a video specifically for your wig — coming soon").
- Order not yet delivered → still works (the customer can preview the install guide before the wig arrives); just hide the review CTA.
- Multi-variant order → show a small "Which wig are you installing?" picker before the video block; rest of the page personalises per variant pick.

---

# PART 4 — THE STYLIST PORTAL (`style.pixiegirlglobal.com`)

**Role:** `hub_stylist` API role (scoped to `shared.stylist_*` only). Separate lightweight app; consistent, never edits Hub or storefront.
**Screens:**

- **Public landing + application** — portfolio + IG/YouTube/website links → creates an application (`stylist_partners` status `application_received`). Brand-alignment questionnaire.
- **Public badge verification** — `/verify/badge/{token}` → live tier/status/expiry from `stylist_partners` (`badge_token`, `current_tier_key`, `current_tier_expires_at`, `badge_revoked_at`). Cannot be faked; reflects revocation instantly.
- **Partner dashboard (authenticated)** — leads, bookings/assignments (`stylist_assignments`, `stylist_assignment_offers`), earnings + payout statements (`stylist_payouts`, `stylist_payout_lines`), badge, contract (e-signed — **D-4 flagged**).
  **Components:** `ApplicationForm`, `BadgeVerifyPage`, `PartnerDashboard`, `AssignmentOfferCard` (accept/decline), `PayoutStatement`.
  **Rules:** reviews only from platform-routed customers. Quality-hold payout status visible. Scoped strictly to stylist data (server-enforced).

---

# PART 5 — APPENDICES

## Appendix A — Module → migration-file attachment map

When building a module with an AI agent, attach **this guide's module section + the file(s) below + that module's OpenAPI paths**.

| Module / screen                                                                   | Attach these migration files                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, users, roles, permissions, org, workflow, staff, geo-clock                  | `000003_shared_people.sql` (+ `000015` seed, `permission_module_keys`)                                                                                                                                                                                                    |
| System config, currencies, FX, tax, doc-numbering, business_config, bank accounts | `000002_shared_system.sql` (+ `000015`)                                                                                                                                                                                                                                   |
| Smartcomm, documents, email signatures, notifications                             | `000004_shared_comms.sql`                                                                                                                                                                                                                                                 |
| Calendar, tasks                                                                   | `000005_shared_scheduling.sql`                                                                                                                                                                                                                                            |
| Retention (loyalty, coupons, subscriptions, referrals)                            | `000007_shared_retention.sql`                                                                                                                                                                                                                                             |
| Stylist programme + portal                                                        | `000008_shared_stylists.sql`                                                                                                                                                                                                                                              |
| Inter-company UI + reconciliation                                                 | `000009_shared_intercompany.sql`                                                                                                                                                                                                                                          |
| Storefront Studio, reviews, carts, order timeline, timeline vocabulary            | `000010_shared_storefront.sql`                                                                                                                                                                                                                                            |
| Social + ad marketing                                                             | `000011_shared_social_marketing.sql`                                                                                                                                                                                                                                      |
| Praxis, AI Insights, AI Control, embeddings, vendor creds                         | `000012_shared_ai.sql` (+ `000014` triggers, `000015` seed)                                                                                                                                                                                                               |
| Catalogue, products, variants, content posts, channel sync                        | `template/000016_business_catalogue.sql.template`                                                                                                                                                                                                                         |
| Stock SSOT                                                                        | `template/000017_business_stock.sql.template`                                                                                                                                                                                                                             |
| CRM & pipeline                                                                    | `template/000018_business_crm.sql.template`                                                                                                                                                                                                                               |
| Sales, quotations, **sales campaigns/flash sales**                                | `template/000019_business_sales.sql.template`                                                                                                                                                                                                                             |
| POS                                                                               | `template/000020_business_pos.sql.template`                                                                                                                                                                                                                               |
| Invoicing                                                                         | `template/000021_business_invoicing.sql.template`                                                                                                                                                                                                                         |
| Accounting                                                                        | `template/000022_business_accounting.sql.template`                                                                                                                                                                                                                        |
| Expenses                                                                          | `template/000023_business_expenses.sql.template`                                                                                                                                                                                                                          |
| Purchasing & imports                                                              | `template/000024_business_purchasing.sql.template`                                                                                                                                                                                                                        |
| Production + Service Job Tracker                                                  | `template/000025_business_production.sql.template`                                                                                                                                                                                                                        |
| Pricing engine                                                                    | `template/000026_business_pricing.sql.template`                                                                                                                                                                                                                           |
| HR, commission, appraisal/KPI, payroll                                            | `template/000027_business_payroll.sql.template`                                                                                                                                                                                                                           |
| Logistics + couriers                                                              | `template/000028_business_logistics.sql.template`                                                                                                                                                                                                                         |
| Retail/consignment partners                                                       | `template/000029_business_retail_partners.sql.template`                                                                                                                                                                                                                   |
| Email campaigns + milestone rules                                                 | `template/000030_business_email_campaigns.sql.template`                                                                                                                                                                                                                   |
| Retention (bundles, maintenance, workflows)                                       | `template/000031_business_retention.sql.template`                                                                                                                                                                                                                         |
| Dashboards & reports                                                              | `template/000032_business_dashboards.sql.template`                                                                                                                                                                                                                        |
| **Cash Request & Disbursement (6.32, v2.1+)**                                     | **whichever migration adds `cash_requests` (confirm with backend) + `template/000023_business_expenses.sql.template` (auto-post target) + `000004_shared_comms.sql` (notifications)**                                                                                     |
| **Public Order Form, installments, fee gross-up, install hub (v2.1/v2.2)**        | **`template/000019_business_sales.sql.template` + `template/000016_business_catalogue.sql.template` (`payment_model` confirm) + `template/000026_business_pricing.sql.template` (gateway-fee config confirm) + `000010_shared_storefront.sql` (letter template confirm)** |
| Triggers/indexes behaviour (read for invariants)                                  | `000013/000014`, `template/000033/000034`                                                                                                                                                                                                                                 |

## Appendix B — Coverage map (every table has a UI home, reconciled to 425)

Read with the backend Admin-UI tiers (Tier-1 = full CRUD, Tier-2 = seeded+editable, Tier-3 = read/action-only). Every table now maps to a screen in this guide:

- **Tier-1 config** → its module screen or a Settings sub-screen (all listed in §1.2 route map). The previously-orphaned config tables — `custom_field_defs`, `couriers`, `retail_partners`/consignment, `report_templates`, `bonus_rules`, `performance_kpi_definitions`, `payroll_deductions`, `bank_accounts`, and the whole **retention cluster** — now have explicit screens (§2.13, §2.10, §2.21, §2.31, §2.19).
- **Tier-3 system/append-only** → read-only views + state-machine actions only (Accounting posted journals, all `*_state_history`, `stock_movements`, `cost_components`, `loyalty_ledger`, `audit_log`, `*_webhook_events`, `ai_usage_*`, insight tables, `sales_order_payments`, `invoice_payments`). Never expose direct UPDATE/DELETE; reversal-only.
- **New audit tables** → `storefront_content_posts` (§2.4 `/content-posts`), `timeline_event_codes` (§2.28 timeline vocabulary), `ai_insight_service_match` (§2.30 service-match inbox), `permission_module_keys` (§2.15 access-matrix source), `product_variants.channel_external_ids/sync_state` (§2.4 `/channel-sync`).
- **v2.1/v2.2 additions (confirm exact table names with backend; flag any absent):** `cash_requests` (§2.32 /cash-requests), `payment_gateway_config` per-gateway fee schedules (§2.31 + §2.12), `products.payment_model` / `payment_model_config` (§2.2 + §2.31), `documents` rows with `document_type='delivery_letter'` (§2.10), `storefront_letter_templates` (§2.28 letter-templates editor), `business_config.allow_staff_manual_payments` toggle (§2.31, D-8).

## Appendix C — Backend dependencies (BLOCKED — cannot ship until backend exists)

Build the UI behind a feature flag; do not ship writing-to-nowhere screens. Escalate these to the backend team:

1. **E-signature** (D-4) — no signature tables/endpoints. Needed for Documents e-sign + Stylist contract signing. Proposed: `signature_requests`, `signature_events` (signer, method, evidence, signed_at) bound to `documents`.
2. **Hair Quiz** (D-5) — no quiz tables/endpoints. Needed for the storefront quiz → CRM-lead capture + stars. Proposed: `hair_quizzes`, `hair_quiz_responses` linked to `contacts`/`crm_deals`.
3. **Streak Stars extended earn-actions & lifetime-discount semantics** (D-6) — the `loyalty_ledger.transaction_type` enum lacks IG-follow / UGC-upload / newsletter / add-birthday / create-account; tiers model a multiplier, not a lifetime-discount %. Decide: extend schema, or render only what's supported and soften the storefront copy.
4. **Wishlist** — named in the storefront account area; no table/column. Trivial to add.
5. **POS offline idempotency key** (audit L-6) — confirm the API exposes a client idempotency key for offline replay dedupe; if not, the offline queue can double-post.
6. **Configurable loyalty/stars earn-rule values** — no per-action rule/config table; "configurable earn-actions" needs one (e.g. `loyalty_earn_rules`).

**v2.1+ additions to confirm with backend (each is a small structural addition if absent — flag and proceed):** 7. **`products.payment_model` / `product_variants.payment_model`** — per-product/variant Layaway vs Deposit-triggered (with deposit %). Frontend specs assume this column; if it doesn't exist yet, add it. 8. **`payment_gateway_config`** — per-gateway, per-currency fee schedule (pct, fixed, cap) + primary/fallback assignment. Feeds Pricing gross-up (§2.12) and Accounting fees account (§2.6). Confirm exact table name. 9. **`business_config.allow_staff_manual_payments`** (D-8 toggle) — boolean. Default false. Ships off; CEO can flip on the day Finance is hired. 10. **`business_config` installment defaults** — default `payment_model`, default `deposit_pct`, `abandonment_window_days`, `reminder_cadence_days` — or a sibling table. 11. **`storefront_letter_templates`** — brand-styled delivery-letter template (per brand, optionally per product type) with WYSIWYG body, merge-token support, signature-image URL. Lives alongside `storefront_themes`/`storefront_pages` conceptually. 12. **`documents.document_type='delivery_letter'`** — confirm this enum value exists or add it; the generated letter PDF is stored as a `documents` row.

**v2.2+ Cash Request module:** 13. **`cash_requests` (and history table)** — the new module's primary table. Columns implied by §2.32: `request_type` (advance/reimbursement), `status`, `amount_ngn`, `currency`, `display_amount`, `fx_rate_used`, `purpose`, `cost_centre`, `account_id`, `requester_user_id`, `validator_user_id`, `approver_user_id`, `disburser_user_id`, `bank_transaction_id` (the audit anchor, free-text), `disbursement_receipt_doc_id`, `match_status`, `auto_approved_below_threshold` (bool), `revision_count`, etc. Confirm exact schema with backend; the audit will surface this as a new table.

**v2.2+ Curated Delivery Letter & Install Hub:** 14. **Letter PDF generation endpoint** — backend triggers at order entering `packing`; produces PDF, writes to Documents. Frontend never generates — it presents what's there. Confirm endpoint contract. 15. **Install hub asset-matching logic** — backend endpoint returning, given an `order_token`, the matched install video, matched Wig Care Guide post, matched stylist directory entries, and re-order recommendations. Frontend renders the response.

## Appendix D — Audit-findings traceability (confirm each is incorporated)

| Finding (source)                                                | Severity            | Where handled in this guide                                                                                                                                                           |
| --------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H-1 No RLS; isolation is app/server-only                        | High                | §0.3, §1.3, §1.4 (always send entity scope; never trust client; API is the boundary)                                                                                                  |
| M-1 Documents "Signatures" has no signature tables              | Med                 | §2.23 + D-4 + Appendix C (e-sign behind flag, BLOCKED)                                                                                                                                |
| M-2 Hair Quiz unbacked                                          | Med                 | §3.3 + D-5 + Appendix C (QuizStepper behind flag)                                                                                                                                     |
| M-3 Streak Stars not modelled as distinct layer                 | Med                 | §0.5 D-6, §3.3, Appendix C                                                                                                                                                            |
| L-1 KPI weights not enforced to sum 100 (proven live)           | Low→**UI-critical** | §0.5 D-3, §2.13 `KpiDefinitionEditor` weight-sum-100 guard (UI is the only guard)                                                                                                     |
| L-2 Loyalty thresholds: seed vs spec conflict                   | Low                 | §0.5 D-1, §2.19 (render from `loyalty_tiers`, surface for owner to set canonical)                                                                                                     |
| L-6 POS offline idempotency                                     | Low                 | §2.3 + Appendix C                                                                                                                                                                     |
| Cross-schema soft-FK orphan risk                                | Med                 | §1.4, §2.23 (handle missing soft-FK targets gracefully)                                                                                                                               |
| Stylist tier naming (4 different namings)                       | —                   | §0.5 D-2, §2.20 (render tier label from config)                                                                                                                                       |
| Frontend gap G-1: no Retention admin module                     | High                | **§2.19 (new `/retention` module, 8 sub-screens + analytics)**                                                                                                                        |
| Frontend gap G-2: no flash-sale builder                         | High                | **§2.18 (new `/campaigns` 3-state builder)**                                                                                                                                          |
| Frontend gap G-3: orphaned config screens                       | Med                 | §2.10 couriers, §2.21 retail partners, §2.31 custom-fields/doc-numbering/bank-accounts/reports, §2.13 KPI/bonus/deductions                                                            |
| Admin-doc stale (420 vs 425) + naming errors                    | —                   | §0.4 (corrections), Appendix A/B (425-reconciled), new-table screens throughout                                                                                                       |
| Admin-doc `fx_rates`→`currency_rates`, tax location             | —                   | §0.4, §2.31                                                                                                                                                                           |
| **PD v2.1: Cash Request & Disbursement module added**           | New                 | **§2.32 (new module: submit/validation/approval/disbursement screens), §2.7 link, §1.2 route map**                                                                                    |
| **PD v2.1: Public Order Form (no-login)**                       | New                 | **§2.4 admin config, §3.2 storefront page (public + staff modes, smart contact merge)**                                                                                               |
| **PD v2.1: Opay added; gateway redundancy**                     | New                 | §2.31 (gateway config, primary/fallback), §2.12 (Pricing fee schedule), §2.6 (Accounting Opay reconciliation)                                                                         |
| **PD v2.1: Payment-fee pass-through (D-7)**                     | New                 | §0.5 D-7, §2.12 (`FeeGrossUpBreakdown`, `ChannelPriceGrid`), §2.6 Payment Processing Fees account, §3.2 (PDPs/checkout: one clean total)                                              |
| **PD v2.1: No Pay-on-Delivery on storefront**                   | New                 | §3.2 (cart & checkout — PoD removed; styled wigs require payment before production)                                                                                                   |
| **PD v2.2: Installment payments per product**                   | New                 | **§2.2 (Payment Workbench: balance ribbon, 3 action paths, payment-model badge), §2.5 (live-balance AR ageing), §3.2 `/pay/{token}` + `/account/orders` self-serve, §3.4 components** |
| **PD v2.2: Manual-payment toggle (D-8) — separation of duties** | New                 | §0.5 D-8, §2.2 (Record Manual Payment hidden until toggle ON), §2.31 (toggle config with confirmation modal)                                                                          |
| **PD v2.2: Curated Delivery Letter & Install Hub**              | New                 | **§2.10 (`/logistics/letters` print queue + letter PDF panel), §2.28 (`/letter-templates` WYSIWYG editor in Storefront Studio), §3.6 (public `/install/{token}` page spec)**          |

## Appendix E — Component states & handoff checklist (every screen)

For each screen, confirm before "done":

- [ ] Loading (skeleton matching layout), Empty (with create CTA if permitted), Error (retry, logged), Permission-denied (clear panel).
- [ ] Permission-aware controls (view/create/edit/delete/approve) gated against `permissions`; read-only fallback when no edit.
- [ ] Entity scope sent on every call; no cross-entity reads; `ALL` only for CEO read views.
- [ ] Money via `MoneyText` (NGN truth + display currency from stored rate); hidden cost/salary fields never requested for unauthorised roles.
- [ ] Workflow-gated writes submit to `workflow_instances`, not the target table.
- [ ] Custom fields (`custom_field_defs`) rendered for the entity type.
- [ ] State-machine screens offer only valid transitions; append-only/posted records are read-only with the correct action (void/reverse/adjust).
- [ ] Real-time subscriptions reconciled with query cache; degrades gracefully if AI/sockets unavailable.
- [ ] a11y: 44px targets, keyboard, focus, ARIA, contrast under both brand themes, reduced-motion.
- [ ] Audit-write fired on every mutation; "updated by/at" shown where present.

## Appendix F — Glossary of canonical decisions (owner sign-off needed)

Resolve D-1…D-6 (§0.5) with the product owner before the affected screens are finalised. The frontend's universal stance is **render from the database, never hard-code** — but the underlying canonical values (loyalty thresholds, stylist tier labels, KPI weights) must be set correctly in seed/config or the UI will faithfully display contradictory numbers. The KPI weight-sum-100 rule (D-3) is the one place the UI must add a hard validation the database does not provide.

---

_End of guide. This document is the UI/UX/behaviour contract; the migration SQL and OpenAPI spec are the field/endpoint truth. Where any older document (including the backend Admin-UI Requirements) disagrees, this guide wins unless a migration says otherwise — in which case the migration wins and the drift should be flagged._
