# PXG Care & Accessories — engineering implementation guide

- **Decisions recorded:** 23 September 2026
- **Business:** Pixie Girl (`pixiegirl`) **only**; Faitlyn Hair (`faitlynhair`) must not receive this feature.
- **Source-audit baseline:** `513136e` (re-read current HEAD in a new Arena session; code may have moved).
- **Status (updated 2026-09-24):** PR 1 and PR 2 are **merged into `main`** — PR #733 → merge `45701c9` on 2026-09-23; PR #734 → merge `770f833` on 2026-09-24 — both verified through the GitHub API rather than assumed. PR 2 merged as an explicit work-in-progress with three named leftovers; those were completed as foundation commits at the start of the PR 3 branch (storefront `/care-and-accessories` routes + disclosure UI, `.github/workflows/pr-checks.yml`, and this progress-row update). **PR 3 is in progress.** PR 4 is not started. The public feature gate `FEATURE_PXG_CARE_ACCESSORIES_ENABLED` remains **off** — no pilot is authorized before PR 4. The source audit predates these implementation changes. No production DB checks or provider calls are authorized by this guide. Estimates are planning ranges, not a quotation.

## How to use this guide in a new Arena chat

Read the **owner decisions**, **progress**, **four-PR plan** and **release gates** before changing code. Implement **one numbered PR at a time**; base the next PR on the merged predecessor and recheck the current repository, rather than assuming this audit is timeless. The Arena session's assigned branch takes precedence over any example branch name: do not switch to an unrelated branch. Put the relevant progress update **in each implementation PR**, with actual evidence, and update it again after that PR merges. Do not claim a PR is merged or a check passed without verification. The guide must be present in the next chat's checkout; if a new session starts from `main` before this document is merged, bring/merge the documentation in first rather than relying on a chat link.

The target journey is:

> Create an item once in **Care & Accessories** → receive physical stock against its exact SKU → find it in all relevant searches/selling interfaces → sell it alone or with wigs → use the existing orders, payments, stock ledger, fulfilment and accounting records.

This is **not** a new merchandising category alone. Use an internal `catalogue_role = retail` (proposed implementation field), ordinary `products` / `product_variants`, and ordinary `line_kind = 'product'` sales lines. Never fake a styled wig, head size, lace or service. All functionality is guarded for PXG on the **server**, even when shared tables have compatible columns in both brands.

### Owner decisions — the contract for the four PRs

| Area | Decision and engineering consequence |
|---|---|
| Name | **Care & Accessories everywhere people see the feature:** admin Catalogue section, staff selectors/filters, customer navigation and campaign merchandising. `retail` is an internal code classification only. Do **not** introduce “Retail Products” as the admin label or “PXG Essentials” as the approved public label. Optional subcategories must sit under Care & Accessories and are not required for launch. |
| Product authoring | Support one default SKU for a simple comb **and** ordinary labelled variants (e.g. 50 ml / 100 ml), each with its own exact SKU, price, stock and optional barcode. Name/code/SKU search must find them. Descriptions can carry ingredients, directions and warnings initially; no arbitrary option-matrix builder or automated hair-growth/medical claims. |
| Sales channels | Quick Sale, quotes/amendments, storefront, campaign/landing checkout, product search, collections/bundles where appropriate, and Instagram **DM checkout links exactly like WhatsApp DM checkout links**—the existing catalogue-share → `/o` flow, including both web implementations. This is the definitive Instagram scope; native Meta/Instagram Shop/feed/product-tag synchronization is **not requested**. FLH remains unchanged. |
| Inventory | Per-SKU receipts, counts, reservations, costs and sellable-location availability. **Stock-only:** no retail preorder, supplier backorder, negative stock, rewig substitute or styling job. **No batch/lot or expiry tracking for the MVP.** Treat these as a later, separately scoped feature, not an MVP gate. |
| Delivery | **Manual calculation and staff fee entry for orders containing retail.** No weight-band, dimensional-weight, carrier-rate or split-shipment project now. Wig-only delivery behavior stays intact. Retail-containing website checkouts must prominently show **EXTRA DELIVERY FEES MAY APPLY**; “may” is intentional—do not say the surcharge *will* apply. The safe provisional web flow is specified below, and must not silently collect a later fee. |
| Payment | Retail-only orders require full payment under the ordinary order/payment rails. Mixed wig-and-retail orders **retain the existing order-wide wig instalment policy**; do not claim retail is individually paid in full in a mixed deposit order. Wig-only orders keep current behavior. Per-line deposit accounting is out of scope. |
| Merchandising | Retail may be deliberately selected for collections, bundles, campaigns and general coupons; **no automatic blanket retail discounts**. Retail never counts as another wig in wig-count promotions or receives head-size/lace premiums. |
| Incentives | **No loyalty or referral rewards/commissions for retail value.** Preserve a customer's eligibility for a *first wig* when they previously bought only retail. Mixed-order rewards/commissions must use eligible wig value, not the entire total. Still record retail purchases truthfully in order history. |
| Release | New retail items start as drafts and require deliberate publication. Four sequential, independently reviewed PRs stay behind a PXG-only gate; **no public or staff pilot until PR 4** passes integration/brand regressions. Then activate a limited PXG pilot. Maintain the progress log after each PR. |

### Delivery implementation boundary and payment safety

**Approved:** staff manually calculate and enter the delivery fee when retail is involved; websites show **EXTRA DELIVERY FEES MAY APPLY** in **bold uppercase**, with **MAY** unchanged. Do not build weight-driven quotes now. The existing `product_variants.weight_g` may be recorded as catalogue data if useful, but must not secretly influence a new checkout rate. Pickup has no delivery charge.

**Explicit engineering assumption to make the existing paid website checkouts workable (not an owner-approved rate card):** for a retail-containing *delivery* cart, charge an initial, nonzero existing-zone fee at checkout if a zone is configured: determine the wig-only quantity for a mixed basket; use that wig quantity for its existing tier, or the zone's one-item/base tier for retail-only. **Never count retail pieces as extra wigs.** Label this charge as the initial delivery amount, subject to manual review; display the exact bold notice before payment and in the order confirmation where the delivery amount is shown. For a confirmed pickup, do not imply a delivery charge. If the zone cannot resolve or yields no billable initial fee, preserve the existing public fail-closed/pickup/contact-staff behavior; do not smuggle a `₦0` delivery order through or trust a browser-entered fee. This assumption must be validated with the business **before PR 2 web checkout ships**; if even an initial zone fee is unacceptable, design a pay-after-manual-quote checkout instead and re-estimate rather than silently changing the money flow.

After a web order is placed, show it in a durable staff **delivery review** queue. Staff calculate the actual final fee and enter it (or mark the initial charge final). If the final fee exceeds the amount already agreed/paid, **request the customer's explicit acceptance and a separate verified payment before dispatch**; no silent card charge. For a decrease, reconcile a credit/refund; if the buyer declines an increase, allow a supported cancellation/refund path. Do not replace totals on an already-paid order with an unrecorded payment or bypass invoice/accounting postings. The existing Sales `setDeliveryFee` endpoint updates an order's total and clears `fee_pending` but does not itself constitute customer consent or payment reconciliation; audit/harden it or use the amendment workflow with proper ledger/payment guards. Staff-created orders/quotes can capture the agreed manual fee before payment. Wig-only and FLH quotes, fee guards and fulfilment must remain exactly as before.

**Outstanding approvals, not silently answered by this guide:** actual product tax treatment; cosmetic returns/restock eligibility; the custom-wig cancellation-fee allocation on a **mixed** order (today it is an order-wide percentage); whether the initial-zone-fee assumption above is acceptable; and approved product/tax/returns copy. **Batch/expiry is explicitly out of scope for the MVP and is not an unanswered question.** Treat these as gates before the relevant financial release/pilot. A live website notice is **not** consent for an unknown future charge.

<a id="pxg-pr-progress"></a>
## PR progress — update this section after **every** PR

| PR | Scope | State | PR URL / merge evidence | Verification / blocker |
|---|---|---|---|---|
| **1** | PXG classification, Care & Accessories authoring, SKU stock/cost/count safety | **Merged** — 2026-09-23 | [#733](https://github.com/tomblakeasaah196/pixie-girl-hub/pull/733), merge `45701c9ebee26dedf485569053cb89bed4247cef` (state `MERGED`, verified via GitHub API 2026-09-24) | 12 focused suites/62 tests passed at submission; the full unit suite and repo-wide lint were **not** green when it merged and still are not (see the PR 3 baseline below). Migration `000094` has never been replayed against a complete deployed PostgreSQL schema — fresh bootstrap/upgrade/replay and staff browser workflows remain **unproven**. See the 2026-09-23 entry. |
| **2** | Staff Sales, common retail resolver, storefront search/cart/checkout | **Merged** — 2026-09-24 (merged as an explicit WIP; leftovers completed on the PR 3 branch) | [#734](https://github.com/tomblakeasaah196/pixie-girl-hub/pull/734), merge `770f833f5f240d00ea4843519566e592482d9f39` (state `MERGED`, verified via GitHub API 2026-09-24) | Shipped: typed retail resolver, `000095`, createOrder/quotation/amendment retail gates, cart + checkout fail-closed delivery, public `/care*` routes, admin picker/Quick Sale care kind. Merged **without** the storefront `/care-and-accessories` pages, `pr-checks.yml` and this row update; all three were completed as PR 3 foundation commits. **Blocker carried forward:** no owner approval for the provisional initial-zone delivery fee or for retail tax treatment, so the retail web delivery money path stays fail-closed. No staging/real-PostgreSQL validation. |
| **3** | Instagram/WhatsApp order links, both `/o` checkouts, manual fee operations | **In progress** | branch `arena/01a0d212-pixie-girl-hub` (PR URL added when opened) | Foundation commits done (PR 2 leftovers a/b/c). Baseline on `main` at `770f833`: full unit suite 276 suites / 273 pass / **3 pre-existing failures** (`praxis_ai/sql-agent-chain`, `praxis_ai/sql-agent-fallback`, `services/currency-service`), 2433 tests / 2431 pass; all 12 care suites green (56 tests). Money-path gate re-checked and **still unresolved** — see the PR 3 entry. |
| **4** | Campaigns/merchandising, incentive exclusion, full regression and gated PXG pilot | Not started | — | Gated behind a merged PR 3. |

**Required update protocol (for the next Arena agent):**

1. Before work: verify the real branch/HEAD and staging prerequisites, select the next `Not started` PR, set it `In progress` **in this file**. Never describe unrun checks as passed.
2. Before opening **each** PR: update its row to `Ready for review`, add its actual branch/PR link when available, commit/submit this documentation update **with that implementation PR**. In a dated entry below record: scope completed, migrations and replay results, backend tests, frontend builds/typechecks, real-DB/manual browser scenarios, PXG/FLH evidence, security/money checks, skipped checks/reasons, any change from owner decisions, rollback and remaining risks. An unchecked box or failure remains visible.
3. **After** a PR is merged: confirm its merged status and merge SHA/URL using GitHub, then update its row to `Merged` and record date before proceeding to the next PR. The next implementation PR can carry this update for its predecessor; after PR 4, use a small documentation follow-up if necessary. Do not pre-fill a future merge SHA or quietly treat `Ready for review` as `Merged`.
4. If blocked or abandoned, set `Blocked`, explain why, keep subsequent PRs gated and identify who must decide. Do not expand the four-PR scope without recording and re-estimating it.

**Entry template — copy after each PR:**

```text
### PR N — YYYY-MM-DD — State
PR: link (or not opened); merge SHA/date: pending until verified
Baseline/current HEAD; implementing Arena session branch:
Shipped/changed tables, endpoints and UI surfaces:
Checks run + exact commands/results; real-DB & both-brand evidence:
Checks not run + reason; outstanding business decisions:
Migration/replay/rollout and rollback notes:
Review findings, follow-ups and next PR gate:
```

### PR 1 — 2026-09-23 — Merged (submitted as a draft; verification was still in progress)

> **Post-merge note (2026-09-24, written from the PR 3 branch):** PR 1 did merge —
> [#733](https://github.com/tomblakeasaah196/pixie-girl-hub/pull/733), merge SHA
> `45701c9ebee26dedf485569053cb89bed4247cef`, `mergedAt` 2026-09-23T22:26:33Z,
> confirmed through `gh pr view 733 --json state,mergedAt,mergeCommit`. The entry
> below is preserved as it was written **before** that merge, including its
> "not merged" wording and its list of unproven items — those caveats were true
> at the time and several are still open. Nothing in it should be read as
> evidence that the migration was replayed against a deployed schema.

- **PR / merge:** branch `arena/01a0cf2b-pixie-girl-hub`; PR URL pending creation; **not merged**. The owner asked for a PR before all checks were green; this is a draft, not `Ready for review`.
- **Implemented so far:** PXG-only default-off authoring gate, draft/publish and distinct Care SKU options, category, price/tax/copy/media, cost-redacted admin view, create-only spreadsheet import/export, clone/trash/restore, costed receipts/PO/GRN, location/SKU-exact counts submitted for approval, and temporary database triggers prohibiting sales/production before typed checkout. FLH retail writes fail the SQL constraint. Instagram remains the existing DM catalogue-share → `/o` flow for **PR 3**, not a native Shop; batch/lot/expiry tracking is **not** included. PRs 2–4 have not started.
- **Checks actually run:** `npm test -- --runInBand 'tests/unit/(catalogue/care-|stock/care-|purchasing/care-|purchasing/po-create-and-receive)'` — 12 suites/62 tests passed; these include a 5-case embedded-PostgreSQL migration smoke against a *representative pre-upgrade fixture*, not the complete deployed schema. `npm --prefix apps/admin run build` passed (TypeScript and Vite). Changed-file backend/admin ESLint checks passed. `git diff --check` passed.
- **Not green / still to verify:** the first full unit run had 4 failures/271 passes; the Care migration assertion was corrected and its focused suite passed, but the full run must be repeated. Three other failures involve SQL-agent expectations and a pre-existing Jest factory error in the currency suite. Repository-wide backend/admin lint commands fail on existing unrelated files. The 000094 migration has **not** been run against a complete PostgreSQL staging schema, so fresh bootstrap/upgrade/replay and staff browser workflows are unproven. No live payment/provider calls or production database actions were performed. All unchecked PR 1 acceptance items remain unchecked pending actual evidence.
- **Rollout/rollback:** leave `FEATURE_PXG_CARE_ACCESSORIES_ENABLED=false` outside controlled verification; no pilot and no customer selling. Migration is additive and intentionally fails closed for retail sales. If the feature must be halted, keep the flag off and retail sales trigger in place; do not drop columns or erase SKU/stock history. Do not merge before migration validation, reviewed green PR checks and conflict verification.

### PR 2 — 2026-09-24 — Merged (as an explicit WIP; leftovers completed on the PR 3 branch)

```text
PR: https://github.com/tomblakeasaah196/pixie-girl-hub/pull/734
merge SHA/date: 770f833f5f240d00ea4843519566e592482d9f39 / 2026-09-24T06:15:03Z
                (state MERGED, verified with `gh pr view 734 --json state,mergedAt,mergeCommit`)
```

- **Baseline / HEAD:** based on merged PR 1 (`45701c9`). Implementing branch was `arena/01a0d07e-pixie-girl-hub`; merged into `main` at `770f833`, which is the base of the PR 3 branch.
- **Shipped (19 files):** `src/modules/catalogue/retail-resolver.js` (typed one-row-per-active-SKU projection: live channel price, sellable-location stock, `preorder: false` / `rewig_eligible: false`); migration `000095_business_care_typed_sales`; `sales.service.js` + `sales.repo.js` + `amendment.service.js` retail gates converging on `createOrder` (`RETAIL_FULL_PAYMENT_REQUIRED`, `RETAIL_NOT_CUSTOM`, amendment shortfalls → `OUT_OF_STOCK` never a pre-order/rewig); `storefront/{cart.service,cart.repo,storefront.service,storefront.controller,public.routes}.js` (exact-SKU adds, live re-pricing at quote, `care_delivery_notice`, `delivery_available: false`, checkout `RETAIL_DELIVERY_ARRANGED` 422, public `/care/enabled` + `/care` + `/care/:slug`); admin `product-search.ts` `care` kind, `ProductPicker`, `QuickSaleForm` stock-only badge, and an in-chat `CataloguePickerModal` that deliberately still **excluded** care.
- **Checks run (as reported by the PR, and re-verified on `main` from the PR 3 branch):** all 12 care suites green — `npm test -- --runInBand tests/unit/catalogue/care- tests/unit/stock/care- tests/unit/purchasing/care- tests/unit/storefront/care-` → **12 suites / 56 tests passed**; `care-sales-pglite.node.cjs` 14/14 and `care-migration-pglite.node.cjs` 7/7 under embedded PostgreSQL (PGlite) rendering the **real** `000094`/`000095` templates per brand; `npm --prefix apps/admin run build` green.
- **Checks NOT run / still open:** no staging or real-PostgreSQL validation — `tests/integration/*` needs a live database and cannot run in the sandbox, so the generic-cart SQL repair is proven only against PGlite fixtures. No browser walkthrough of the storefront. `000095` has not been replayed against a complete deployed schema.
- **Outstanding business decisions (the money-path gate):** searched GitHub for owner approval of (a) the provisional initial-zone delivery fee and (b) actual retail tax treatment — the repository has **zero issues**, **Discussions are disabled** (`HTTP 410`), and PRs #733/#734 have **no comments or reviews** recording a decision. Both remain **unresolved**, so retail web delivery stays fail-closed (pickup allowed; staff manual fee entry allowed) and retail tax still reuses the product-level `taxable` / `vat_rate`. This is a carried-forward blocker for PR 3 and PR 4, not something PR 2 settled.
- **Merged with three known leftovers,** all completed as foundation commits at the start of PR 3: (a) the storefront app's `/care-and-accessories` list + detail routes and cart/checkout disclosure UI, (b) `.github/workflows/pr-checks.yml`, (c) this progress-row update. The PR's own "Remaining" list named all three; it was merged anyway with a WIP banner, so PR 3 verified them independently rather than trusting the merge.
- **Rollout / rollback:** `FEATURE_PXG_CARE_ACCESSORIES_ENABLED` stays **off**; no pilot. Killing the flag stops new retail creation and public sale while already-placed retail order read/fulfilment/refund paths keep working. `000095` is idempotent (`DROP` → `CREATE OR REPLACE`) so repair replay is safe.

### PR 3 — 2026-09-24 — In progress

- **Baseline / HEAD:** `main` at `770f833` (merged PR 2). Implementing Arena session branch: `arena/01a0d212-pixie-girl-hub`.
- **Prerequisites re-verified independently,** not taken on trust: `git fetch origin main` → `origin/main == 770f833`; `gh pr view 733/734 --json state,mergedAt,mergeCommit` → both `MERGED` (`45701c9` / `770f833`). PR 2's three leftovers were audited in the working tree and confirmed genuinely absent (no `/care-and-accessories` route files, no `pr-checks.yml`, PR 2's table row still `Not started`) before any PR 3 work began.
- **Baseline recorded on `main` before changes:** full unit suite `npm run test:unit -- --runInBand` → **276 suites, 273 passed, 3 failed; 2433 tests, 2431 passed, 2 failed**. The three failures are pre-existing and unrelated to this feature (`tests/unit/praxis_ai/sql-agent-chain.test.js`, `tests/unit/praxis_ai/sql-agent-fallback.test.js`, `tests/unit/services/currency-service.test.js`) — they are quarantined by name in `scripts/ci/assert-unit-results.mjs` rather than hidden behind `continue-on-error`.
- **Money-path gate re-run before any charged delivery path was written:** see the PR 2 entry — still unresolved, so retail web delivery remains fail-closed in PR 3 as well.
- Detailed PR 3 evidence (scope, commands, results, blockers) is appended to this entry as the work completes.

---

## 1. Research scope and confidence

This assessment used repository-wide dependency searches, migration/SQL inspection, and manual tracing through the relevant backend modules and the admin, storefront and campaign landing apps. The checkout has 2,928 Git-tracked files; that is a repository inventory, **not a claim that every line in every file was manually read**.

Areas covered:

- Catalogue creation, variants, publishing, categories, collections, bundles, media, import/clone/trash, pricing and costs.
- Stock receipts, purchasing, stock registers, counts, movements, reservations, returns and adjustments.
- Quick Sale, quotations, order amendments, public checkout, campaign checkout and messaging checkout links.
- Instagram/WhatsApp messaging, social proof, product search, AI search and public product DTOs.
- Logistics, commissions/referrals, retention, reporting, invoicing, accounting, production/styling boundaries and brand isolation.
- Bootstrap/repair migrations and existing test coverage.

**Validation performed:** two read-only Node assertions against the existing pure stock-count planner confirmed the omitted-product and multi-variant risks described below. No database was accessed, no live sales/payment/provider calls were made, and no application code was changed. The full test suite and app builds were not run for this planning exercise. Deployed schema, production configuration and Meta account capabilities remain unverified.

Code behavior takes precedence over old README/specification comments. Some comments describe intended behavior that is not implemented by the current path.

---

## 2. What already exists, and what blocks the feature

### 2.1 Reusable foundation

| Existing capability | Evidence | Implication |
|---|---|---|
| Generic physical products | [`catalogue.validator.js:31–99`](../src/modules/catalogue/catalogue.validator.js#L31) accepts `product_type = physical/service/digital`; hair attributes are optional. | A comb or bottle is already representable as a physical product at the database level. |
| Stock-bearing SKUs | [`000016…catalogue:218–279`](../migrations/template/000016_business_catalogue.sql.template#L218) defines variants, SKU, barcode, prices, weight and reorder settings. | Reuse one inventory identity per sellable SKU. |
| Stock initialization | [`catalogue.service.js:237`](../src/modules/catalogue/catalogue.service.js#L237), [`stock.subscribers.js:90–102`](../src/modules/stock/stock.subscribers.js#L90). | Variant creation already emits an outbox event that seeds zero stock at active locations. Creation does **not** mean physical units have arrived. |
| Inventory ledger | [`000017…stock:64–137`](../migrations/template/000017_business_stock.sql.template#L64). | Receive, reserve, sell, transfer, return and adjust the same variant. No separate accessory ledger needed. |
| Ordinary sales lines | [`sales/pricing/totals.js:46–80`](../src/modules/sales/pricing/totals.js#L46). | Retail can use `product_id`, `variant_id`, snapshots and `line_kind = product`. |
| Channel pricing | [`sales/pricing/channel-price.js`](../src/modules/sales/pricing/channel-price.js). | Existing storefront/POS/wholesale/partner price tiers can be reused, with explicit selection and validation. |
| Generic financial posting | [`accounting.subscribers.js:48–100`](../src/modules/accounting/accounting.subscribers.js#L48). | Revenue and cost-of-goods posting are not intrinsically wig-only. Correct cost capture still needs verification. |

### 2.2 Confirmed blockers and material risks

1. **The normal creation wizard requires a head size.** `BaseProductWizard.tsx:78` requires both a name and at least one size. Submission creates products named with size labels. The underlying nullable hair fields do not make the current user journey generic.
2. **Base products are deliberately forbidden from publishing.** The validator rejects visibility fields, and `catalogue.service.js:619` forces base visibility off. Template `000043_business_base_never_storefront.sql.template` also hides all visible `products` rows and strips their storefront channel.
3. **The website reads styled products, not general physical products.** `storefront.repo.js:80` and `storefront.service.js:268` use styled records, styled variants and head-size/lace/colour configuration. Merely adding a category leaves retail absent from the shop.
4. **Styled is a real wig model, not just a marketing wrapper.** The styled variant schema requires colour and size; later migrations require its base-product link. Publishing requires an active styled variant. The model also participates in styling jobs and rewig substitution.
5. **Variant selection is inconsistent across sales paths.** Admin `resolvePick` expands every active base variant into separate lines; messaging resolves only the default variant; campaign product checkout selects its first variant. A 50 ml / 100 ml product cannot safely rely on those different behaviors.
6. **The dormant generic cart path needs repair, not just exposure.** `cart.service.js:165` selects `pv.price_ngn`, `p.product_name`, `pv.variant_label`, `pv.thumbnail_url` and `p.is_active`; those names do not match the canonical product/variant schema inspected here. The Smartcomm base resolver also checks `p.is_active`. These are source/schema inconsistencies to validate against staging, not a claim that a production failure was reproduced.
7. **Retail stock-outs must not inherit wig production promises.** New sales apply the brand's universal preorder policy to every channel unless the product is excluded. The amendment shortfall path separately records added units as preorders. A comb must not silently become “made to order, 4–8 weeks.”
8. **Campaign math treats ordinary product lines as wigs.** Campaign `buildDealLines` and `priceQuoteLine` classify `product_id` lines as styled/raw wigs. Campaign bundle resolution adds a head-size premium to every component, including generic variant components. That would give accessories inappropriate discounts or premiums.
9. **Delivery quotes are based on wig quantities.** `zones.service.js` computes rate-card tiers from `qty`; storefront, landing and staff forms feed basket quantities into it. A `weight_g` column exists, but it is not the basis of these quotes. Several combs could be charged as several wigs.
10. **Hair-only stock counts can affect new retail stock.** With `unlisted = zero`, every stocked SKU in the count's loaded scope whose product is omitted receives a planned write-down. Multiple stocked variants under one product are treated as ambiguous. Both behaviors were confirmed with pure-function probes; a probe did not post an adjustment.
11. **Cost Vault entry is not automatically a COGS basis.** Simplified Goods Reception sends no cost; Cost Vault stores encrypted true costs; operational costing reads weighted-average or legacy standard cost. A retail costing workflow must bridge the intended accounting basis without exposing confidential costs.
12. **Several secondary website features also assume styled IDs.** Related-product results, collection membership APIs, product reviews, social-proof lookup and public product card types require more than changing the main shop query.

### 2.3 Important source references

- Creation UI: [`BaseProductWizard.tsx:68–113`](../apps/admin/src/pages/catalogue/BaseProductWizard.tsx#L68).
- Base publishing guard: [`catalogue.service.js:615–643`](../src/modules/catalogue/catalogue.service.js#L615).
- Replayed hiding migration: [`000043_business_base_never_storefront.sql.template`](../migrations/template/000043_business_base_never_storefront.sql.template).
- Styled publishing: [`styled.service.js:241–260`](../src/modules/catalogue/styled.service.js#L241); styled variant constraints in templates `000041` and `000049`.
- Admin multi-variant expansion: [`product-search.ts:230–246`](../apps/admin/src/lib/product-search.ts#L230).
- Generic cart query: [`cart.service.js:156–195`](../src/modules/storefront/cart.service.js#L156).
- Messaging default variant: [`smartcomm.order-links.resolvers.js:21–83`](../src/modules/smartcomm/smartcomm.order-links.resolvers.js#L21).
- Preorder enforcement: [`sales.service.js:809–836`](../src/modules/sales/sales.service.js#L809); amendment fallback: [`amendment.service.js:1516–1535`](../src/modules/sales/amendment.service.js#L1516).
- Campaign classification: [`campaigns.public.service.js:416–453`](../src/modules/sales_campaigns/campaigns.public.service.js#L416), [`:800–819`](../src/modules/sales_campaigns/campaigns.public.service.js#L800).
- Campaign bundle size pricing: [`campaigns.public.service.js:601–679`](../src/modules/sales_campaigns/campaigns.public.service.js#L601).
- Delivery tiers: [`zones.service.js:17–42`](../src/modules/logistics/zones.service.js#L17).
- Count plan: [`stock.count-plan.js`](../src/modules/stock/stock.count-plan.js); scope queries: [`stock.repo.js:1423–1459`](../src/modules/stock/stock.repo.js#L1423).
- Cost capture: [`stock.service.js:1267–1278`](../src/modules/stock/stock.service.js#L1267), [`stock.repo.js:561–579`](../src/modules/stock/stock.repo.js#L561), [`cost_vault.service.js:125–157`](../src/modules/catalogue/cost_vault.service.js#L125).

---

## 3. Implementation design and invariants

### 3.1 Separate behavior from merchandising

Use three distinct concepts:

| Concept | Example | Purpose |
|---|---|---|
| Existing `product_type` | `physical` | Physical versus service/digital. **Do not change its meaning.** |
| Proposed `catalogue_role` | `base` or `retail` | Private hair-stock base versus independently sellable retail product. Controls workflow eligibility. |
| Existing `category_id` | Care & Accessories (parent; optional subcategories later) | Organizes browsing and reporting. Changing a category must not change stock/fulfilment semantics. |

`catalogue_role` is a proposed name, not an existing field. Existing records should retain their existing/base behavior. Do not infer a bulk reclassification from product names or from missing hair attributes without reviewing real data.

A retail product would have:

- `product_type = physical`, `catalogue_role = retail`, and stock tracking on by default.
- A default stock-bearing variant automatically created for a simple item.
- A draft-by-default, explicit publish/unpublish lifecycle, subject to catalogue approval permissions.
- No required cap size, hair origin, lace, head-size tier, styled colour or factory-base linkage.
- No styled/service provenance on its sales lines, no automatic styling job and no rewig eligibility.
- Stock-only availability: explicitly excluded from universal preorders across every sale and amendment path.
- Explicit prices for the enabled selling contexts, with approved fallbacks rather than silent zero pricing.

### 3.2 PXG-only capability, enforced on the server

Expose a shared capability such as `retail_products_enabled`, but keep it **allowed only for `pixiegirl` for this feature**. FLH must not gain the feature merely because an admin toggles an unrestricted flag or sends a crafted payload.

Enforce it in:

- Catalogue create/update/publish/clone/import services, not only a hidden tab.
- Retail search and public catalogue resolution.
- Cart add, quote and checkout, order links, campaigns and raw sales APIs.
- Shared-schema carts, links, reviews and social records using the correct `business` scope.
- Any import/intercompany path that might otherwise create retail records in FLH.

Shared tables/columns can remain structurally compatible across brand schemas so common queries do not crash in FLH. Structural migration compatibility is not feature activation. Reuse the existing authenticated brand middleware and authorization rather than accepting a browser-supplied capability as authority.

### 3.3 One catalogue identity and one stock identity

A 50 ml bottle is one retail variant with its own SKU. A 100 ml bottle is another variant with its own SKU; simple labelled options **are required at launch**. A comb with no options has a hidden/default variant; staff should not have to understand this technical detail.

The launch can use `variant_name` as a simple option label. A full colour × volume × pack-size matrix builder is not necessary to sell normal options, and can be deferred.

**Every selling surface must select the exact same `variant_id`.** Do not expand all sizes, quietly fall back to another bottle size, or replace a chosen inactive option with the default.

Stock quantities remain whole pieces/bottles/packs. “50 ml” describes the sellable unit; it does not mean the stock ledger holds 50 fractional millilitres. Decanting, bulk unit conversion and per-millilitre consumption are a separate inventory problem.

### 3.4 Public catalogue contract

Add a genuine typed public product contract, conceptually:

- `kind: styled | retail`
- `id`, `name`, `slug`, image, category, prices and availability
- Styled-specific options **or** retail variant options
- A real stock-variant reference for a selected retail item

Do not place a retail `product_id` in a field named `styled_id` to avoid updating consumers. That would conceal an identity mismatch in reviews, cards, links, analytics and fulfilment.

Reuse common product cards, cart components and checkout screens, with different option panels. Retail pages should not show “Buy unstyled,” size guides, lace premiums or production copy.

The public reader must select only approved public fields. Exposing `products` must not expose private hair-base photographs, Cost Vault information or unrelated stock-room records.

**URL policy for this guide:** use `/care-and-accessories/:slug` as the canonical PXG retail route; preserve existing `/product/:slug` wig URLs. Products and styled products currently check slug uniqueness in separate tables. Enforce uniqueness within public retail products and test concurrent publishing/restoration, legacy wig links and social shares. Do not resolve a slug by arbitrary first-match logic across tables.

### 3.5 Common sellable-product resolution

Factor a small shared server-side resolver/policy layer for the new retail path. It should establish:

1. Brand and capability.
2. Product role, lifecycle, channel eligibility and deletion state.
3. Variant ownership, active state and exact option choice.
4. Correct live channel price, currency rules and public snapshots.
5. Sellable-location stock, availability and preorder policy.
6. Eligibility for wig discounts, styling, rewig and delivery calculation.

Use it from cart/quote/checkout, messaging links, campaign checkout and sales/amendment validation. This avoids repairing the generic product path differently in five places. It need not replace the entire existing styled pricing engine.

### 3.6 Categories and navigation

Use **Care & Accessories** for the admin section, staff search filters, customer navigation and launch category, slug `care-and-accessories`. Hair Care, Combs & Brushes and Accessories are possible *later subcategories*, not additional approved top-level labels. Assign launch items to the parent. Categories are currently feature-gated by `catalogue_config.categories_enabled`; both admin and public reads honor it. Seed/enable PXG only and configure navigation explicitly.

Public category filtering currently matches an exact slug. **Before** assigning items to optional child categories, extend the parent listing to include approved descendants or use a role-based landing page; otherwise the parent may appear empty.

Define a consistent search contract as well: name/product code and SKU must find the product and preserve the selected option; add barcode lookup if barcode-based selling is expected. Admin catalogue search currently matches name/code/slug, while stock and global search have different SKU handling. A barcode column alone does not establish scanner or search support. Update role filters, counts, pagination and deep links across these queries, not just the picker labels.

### 3.7 Alternatives considered

| Approach | Assessment |
|---|---|
| Add only an Accessories category | Insufficient: does not remove wizard constraints, publish products or fix checkout behavior. |
| Model goods as services | Wrong stock and fulfilment behavior. Reject. |
| Give accessories fake styled colours/head sizes | Fast-looking workaround with long-term pricing, production and reporting defects. Reject. |
| Generalize the entire styled model | Technically possible, but requires weakening wig constraints and auditing all styled consumers. Higher regression risk for both brands. |
| Build a separate accessory inventory/sales module | Duplicates ledgers, payments, returns and accounting unnecessarily. Reject. |
| Retail role over existing products/variants, plus a proper public listing path | Recommended balance of reuse, clarity and brand isolation. |

---

## 4. Field and model impact inventory

This is a dependency/behavior inventory. **An affected table does not necessarily need new columns.** Most operational tables can remain unchanged.

### 4.1 Catalogue and configuration

| Model / fields | Treatment |
|---|---|
| `products.product_id`, `product_code`, `name`, `slug`, `category_id`, `short_description`, `long_description`, `brand_name`, `meta_title`, `meta_description`, `search_keywords` | Reuse. Make available in the retail form, imports, search and public projection. Add cross-kind URL safeguards. |
| Proposed `products.catalogue_role` | New stable discriminator, default preserving legacy behavior. Do not casually change it after sales/links exist. |
| Proposed product publication state | Draft on creation, explicit PXG publish/unpublish after price/media/stock policy validation. Reuse existing `is_visible_storefront`, `visible_on_channels`, `published_at` and deletion/audit fields as appropriate. Avoid conflicting sources of truth and never publish private hair bases. |
| `products.product_type`, `track_stock`, `taxable`, `vat_rate`, `is_custom` | Reuse. Retail physical goods normally track stock and are not custom production. Tax treatment is merchant-configured, not inferred from “hair care.” |
| Hair fields: `texture_type`, `lace_type`, `hair_length_inches`, `density`, `cap_size`, `primary_colour`, `hair_origin`, `lace_size_codes` | Keep for hair; not mandatory or displayed as wig controls for retail. Ordinary retail colour can be an option label instead. |
| `preorder_enabled`, `preorder_excluded`, `expected_ready_date`, `production_lead_days` | Explicit retail stock-only defaults. New-order, cart, availability and amendment behavior must agree. Supplier backorders, if later allowed, need different wording from factory production. |
| `size_code`, `base_family_id`, `rewig_eligible` | Retail ineligible; do not put retail products into head-size families or donor searches. Guard direct APIs and imports too. |
| `payment_model`, `required_deposit_pct`; variant payment overrides | Existing columns are not the active payment authority. Retail-only full payment needs explicit order-level enforcement; mixed orders retain the current wig order plan. Do not fake a per-line full payment guarantee. |
| `product_variants.variant_id`, `product_id`, `sku`, `barcode`, `variant_name`, `is_default`, `is_active`, `display_order` | Reuse. Add a normal variant picker. Preserve identity through checkout, receipts, purchase orders and links. |
| Variant NGN/USD storefront, POS, wholesale, partner and compare-at prices | Reuse. Retail creation/import must populate intended selling prices; the current base import primarily provisions wholesale data. Validate channel prices before enabling sales. |
| `weight_g`, `reorder_point`, `reorder_quantity` | Reuse catalogue/stock fields as relevant. Weight may be stored for future use but is **not** a delivery-price input in the four PRs. Do not build weight bands now. |
| `variant_length_inches`, `variant_colour`, `variant_density`, `variant_cap_size` | Hair axes remain optional; do not overload head-size fields with bottle volume. |
| Optional `option_values` / generic option definitions | Only needed for structured multiple axes. Simple labelled variants can use `variant_name` initially. Not an existing implemented generic options system. |
| `channel_external_ids`, `channel_sync_state` | Storage exists; not evidence of a working Meta/native shop synchronizer. |
| `product_categories` and `catalogue_config.categories_enabled` | Seed/configure PXG categories and navigation deliberately. Preserve FLH's current settings. |
| `catalogue_config.allow_base_in_collections_bundles` | Do not globally enable hidden hair bases to permit retail. Add a retail-specific eligibility rule. |
| `product_images` product/variant/styled references, URL, alt text, primary/order fields | Reuse media storage; project retail-owned imagery without a styled gallery requirement. Test exact variant ownership and public safety. |
| `product_videos`, `product_seo`, `product_attribute_values` | Potential reuse for videos, SEO and optional product facts. Tables alone do not guarantee retail UI/API coverage. |
| Optional ingredients, directions, warnings, net contents / pack information | Put approved ingredients, directions and warnings in existing descriptive content initially. Dedicated structured cosmetics fields/UI need a separate decision; do not generate unsupported hair-growth/medical claims. |
| `styled_products`, styled colours/variants, size/lace tiers, shades, styled BOM | Preserve hair behavior. Ensure “create styled from base” and per-variant base assignment cannot accidentally use a retail product as a hair base. |
| `product_collection_members`, `product_collection_rules` | Existing DB membership can target product/styled records after migrations, but current service/validator are styled-only. Extend eligibility, reads, rule evaluation and import/export together. |
| `product_related` | Existing pairs use base product IDs; current public reader resolves related bases into styled products. Add direct retail destinations and typed cards. |

### 4.2 Stock, purchasing and costs

| Model / fields | Treatment |
|---|---|
| `stock_levels`: `variant_id`, `location_id`, `on_hand`, `reserved`, generated `available` | Reuse. No second inventory balance. Public availability must restrict to sellable locations; current generic cart availability sums across locations without that restriction. |
| `stock_movements`: variant/location, type, signed quantity, channel, references, `unit_cost_ngn` | Reuse all normal movements. Opening stock must be a receipt/adjustment, not a direct overwrite of `on_hand`. |
| `stock_reservations`, `stock_adjustment_lines`, `stock_transfer_lines`, `stock_alerts` | Reuse; add retail coverage in selectors, filters and regression tests. |
| `inbound_shipment_lines` / Goods Reception input | Database lines already use a variant. Simplified input currently resolves `product_id` to default variant; add exact variant receipt selection for multi-SKU retail. |
| Stock count input, matching and loaded scope | Add explicit scope and SKU/variant-level counting. An omitted retail item in a hair count must not be a zero count. Apply the same rules to UI and CLI import paths. |
| `supplier_products`, `rfq_lines`, `po_lines`, `grn_lines` | Existing variant references can serve retail procurement. Purchasing UI should preserve chosen variant rather than defaulting from product. |
| `product_variant_cost_vault` | Reuse encrypted supplier/true-cost records and grants. No public cost exposure through new generic DTOs. |
| `variant_costing`, `product_variants.cost_price_ngn`, sales `unit_cost_ngn` | Verify an operational cost source is captured and reconciles. Do not assume a Cost Vault write updates weighted-average or standard cost. |
| Lot/batch/expiry inventory | **Not in the MVP.** No end-to-end lot/expiry/FEFO capability was found. Do not add decorative expiry fields or implement this in PR 1–4; a future lot-tracking feature requires its own design and estimate. |

### 4.3 Sales, shared carts and downstream models

| Model / fields | Treatment |
|---|---|
| `sales_order_lines`, `quotation_lines`: product/variant references, quantity, name/variant/SKU snapshots, price, cost, tax and discount | Reuse. Correct exact-SKU resolution is the primary change. |
| `sales_order_lines.line_kind`, `styled_id`, `service_offering_id` | Retail uses `line_kind = product`, with no styled/service reference. A new sales-line enum is not required. |
| `sales_orders`: channel/type, fulfilment, payment plan/model, custom flag, preorder fields, totals, currency, attribution | Keep existing order model. Retail-only pays in full; mixed keeps the existing order-wide wig instalment plan. Add an auditable retail delivery-review workflow; do not corrupt old snapshots or silently revise already-paid totals. |
| Shared `carts` / `cart_items`: `business`, product/variant/styled/bundle references, quantities, snapshots, prices, currency | Existing generic item storage is usable. Repair add/quote/checkout validation and live pricing, not just the TypeScript type. |
| Shared order-link item JSON | Add retail kind and explicit variant identity to validator, normalization, resolver, snapshot and both checkout UIs. Preserve legacy links. |
| `sales_campaign_products`: product/category/styled targets, prices and include/exclude flags | Generic references exist, but publisher, builder, detail reads and pricing need retail semantics. Do not require a linked wig. |
| `bundle_offers`, `bundle_offer_products`, `sales_campaign_bundles` | One canonical Catalogue bundle model, reused live by campaigns. Audit both storefront and campaign resolution/pricing consumers. Pin correct retail variants and quantities; no head-size premiums or wig-unit discounts for them. Legacy `product_bundles` / `product_bundle_items` were removed by template `000065`; do not recreate a second bundle catalogue. |
| `invoice_lines`, credit-note references, receipts and payment records | Mostly reuse snapshots and totals. Confirm stock-bearing goods are sold through Sales, not only typed onto a standalone invoice. |
| `delivery_items` and delivery headers | Reuse physical SKU lines/descriptions. Manual retail delivery review/fee entry; wig-only quotes unchanged. Do not let retail quantities masquerade as wig counts or derive a new weight-based rate. |
| `consignment_stock`, `consignment_movements`, `partner_settlement_lines` | Reuse variant-based partner stock/sales; extend selection and verify agreed prices. |
| `crm_deal_products` | Already accepts product/variant/free description. Check any surfaced product selector and links; no new deal model required. |
| `pricing_rules`, `pricing_floors`, `pricing_scenario_results`, `price_history`, `channel_price_overrides` | Reuse with role/category filters and correct retail selection. Existing bulk USD repricing already includes product variants. |
| Commission rules, loyalty, coupon, referral records | Exclude retail value from loyalty/referral/commission accrual, including mixed orders; preserve first-wig eligibility. General coupons/campaigns can include retail only if explicitly configured. Test outbox idempotency, order-history truth and no retrospective re-rating. |
| Shared `product_reviews`, `customer_wishlists`, `social_posts.tagged_product_ids` | Preserve business scope; generalize ID resolution where it assumes styled IDs. Wishlist storage is already variant-based. |
| Page-view/funnel events, sales reports, stock insights | Preserve stable typed identities and labels; add retail breakdown/filter where required rather than counting retail units as wigs. |

---

## 5. Pages, components and endpoint impact map

Legend: **Change** = required implementation; **Verify** = predominantly reuse with regression checks; **Protect** = deliberately exclude retail from a hair-only workflow.

### 5.1 Admin catalogue, stock and operations

| Surface / principal files | Work |
|---|---|
| `pages/catalogue/CataloguePage.tsx`, `BaseTab.tsx`, `StyledTab.tsx`, admin router, `lib/catalogue.ts` | **Change:** PXG-only **Care & Accessories** tab/routes/types. Keep base and styled records unambiguous; the `retail` discriminator is not a visible section name. |
| `BaseProductWizard.tsx`, `BaseProductPage.tsx`, `CloneAndSizesBar.tsx` | **Change/Protect:** provide retail create/detail editing; do not require size runs, “create other sizes,” or styled conversion for retail. A dedicated retail form can reuse ordinary controls. |
| `CategoriesTab.tsx`, `CatalogueSettingsTab.tsx` | **Change:** retail navigation/category behavior, defaults and capability presentation; no FLH feature activation. |
| `BulkImportModal.tsx`, catalogue import services, `TrashModal.tsx` | **Change:** retail templates, exact SKU handling, role-preserving clone/restore, channel prices and publish guards. Retain historical stock/order references. |
| `CostVaultSection.tsx`, `CostVaultGrants.tsx`, `UsdRepriceModal.tsx` | **Verify/targeted change:** reuse costs/permissions/currency tools for retail. Preview and copy must not imply every item is styled. |
| Media editors, `CoverImageEditor.tsx`, videos and SEO controls | **Verify/targeted change:** support retail ownership and gallery projection. |
| `BaseProductPicker.tsx`, `components/catalogue/ProductPicker.tsx`, `VariantPicker.tsx`, `StyledVariantPicker.tsx` | **Change:** context-specific allowed kinds; retail exact-option selection. A global “include retail everywhere” switch is unsafe for hair-base selectors. |
| `CollectionsTab.tsx`, `AddToCollection.tsx`, `BundlesTab.tsx`, `BundleProductPicker.tsx`, `AddToBundle.tsx`, collage tools | **Change:** independently list retail and optionally merchandise it with wigs; validate membership/pricing in backend too. |
| `ShadesTab.tsx`, `AddToShade.tsx`, `StyledVariantsManager.tsx`, `StyledProductionManager.tsx`, `AiDraftModal.tsx` | **Protect:** these remain hair/styling-specific. Retail copy drafting would need its own prompt/flow if desired. |
| Stock `ProductsTab.tsx`, `OverviewTab.tsx`, `StockPage.tsx`, stock types | **Change/Verify:** retail rows, kind/category filters, truthful labels/deep links, optional variant drilldown. Product totals currently aggregate all variants. |
| Stock `ReceiveTab.tsx`, `GoodsReceptionImportModal.tsx` | **Change:** retail picker, exact variant receipts and agreed cost workflow. |
| Stock `StockCountImportModal.tsx`, `AdjustmentsTab.tsx`; `stock.count-sheet.js`, `stock.count-plan.js`, `scripts/import-stock-count.js` | **Change:** scoped counts and retail SKU matching; preserve hair imports. |
| Stock `MovementsTab.tsx`, `TransfersTab.tsx`, `LocationsTab.tsx`, `AlertsTab.tsx` | **Verify/targeted change:** existing ledger behavior, labels, filters and destinations. |
| `pages/purchasing/PurchasingPage.tsx` and purchasing types/services | **Change/Verify:** source retail goods and preserve variant from PO to receipt. Current input accepts variant IDs, but common UI workflow selects a base product. |
| `pages/retail-partners/MovementModal.tsx`, Stock/Movements/Settlements tabs | **Change/Verify:** selectable retail SKU, partner stock movements, prices and settlements. |
| `pages/production/RunDrawers.tsx`, production units, styled BOM and service-job material pickers | **Protect:** do not offer retail as a hair unit. If a stocked retail item is also a legitimate consumable, allow that only in the appropriate material context. |

### 5.2 Staff selling and customer checkout

| Surface / principal files | Work |
|---|---|
| `pages/sales/QuickSaleForm.tsx`, `lib/product-search.ts` | **Change:** retail in search, correct selected variant/price/snapshot, no required wig, correct delivery and payment policy. Include walk-in, phone, event and social-attributed sales. |
| `QuoteFormModal.tsx`, quotations, quote-pay routes | **Change/Verify:** retail quotations, document rendering and conversion/payment into an ordinary stocked order. |
| `ChangeOrderModal.tsx`, `amendment.service.js` | **Change:** exact retail options, preserve kept-line prices, no automatic retail preorder or rewig on added short-stock units. |
| Orders, order detail, preorders, Delivery Pending, payment/report/archive screens | **Verify/targeted change:** ordinary/mixed order rendering and actions; distinguish retail from wigs in relevant filters/copy. |
| `components/messaging/CataloguePickerModal.tsx`, messaging product cards/thread, `lib/smartcomm-types.ts` | **Change:** retail selection and variant identity. This duplicates some product-kind declarations, so changing the central picker is not enough. |
| `smartcomm.order-links.{service,resolvers,repo,public.routes}.js`, `smartcomm.validator.js`, share resolver in `smartcomm.service.js` | **Change:** allowed kinds, item normalization, exact variant resolution, image/price snapshots, business checks and legacy-link behavior. |
| Admin `pages/order/OrderCheckoutPublic.tsx` | **Change:** retail line type/options and fulfillment copy; use the same public validation and delivery calculation. |
| Storefront `routes/o.$slug.tsx`, `lib/order-link.ts` | **Change:** the second implementation of the link checkout must also work. Do not update only the admin-hosted form. |
| `storefront/order-form.routes.js`, validator and `storefront.service.js` | **Change:** generic product eligibility, exact variants, pricing, quantity and brand checks for submitted/signed link items. |
| `storefront/cart.*`, `checkout.public.routes.js`, quote/checkout service | **Change:** repair generic path; consistent live repricing at add/quote/submit; no hidden/deleted/wrong-brand SKU; correct availability, stock and tax. |
| Storefront `lib/storefront.ts`, `routes/product.$slug.tsx`, `shop.tsx`, `shop.$category.tsx` | **Change:** typed mixed catalogue, retail details/options, filters/search, image/price/availability. |
| Storefront cards/templates/homepage rails, `YouMayAlsoLove.tsx`, collections and bundle pages | **Change:** real product-kind identity, retail membership and links. Home merchandising should be curated, not indiscriminately inject every retail item into a wig-specific section. |
| Storefront cart/checkout UI, account order/wishlist displays | **Verify/targeted change:** existing generic line UI can be reused after DTO/resolution work; confirm names, option labels, prices, tracking and restock behavior. |
| `pages/invoicing/InvoiceCreateDrawer.tsx`, invoice/credit-note/detail/public-document views | **Verify:** generated order documents are largely generic. Manual invoice creation is currently a free-text financial workflow, not an existing catalogue picker; making it a full stock-selling UI is separate work. Staff should use Quick Sale/quotes for stocked sales. |

### 5.3 Campaigns, discovery, shipping and adjacent systems

| Surface / principal files | Work |
|---|---|
| Admin `CampaignBuilderPage.tsx`, `CampaignBundlesPage.tsx`, `StyledProductPicker.tsx`, campaign product detail and landing previews | **Change:** retail membership/picking, descriptions, cards and preview parity. |
| Backend `sales_campaigns/campaigns.{service,repo,validator}.js`, `campaigns.public.service.js`, `campaigns.bundles.{repo,service}.js`, deal/discount/pricing services and `checkout.stages.js` | **Change:** detail authorization, exact variants, retail prices, no wig-unit contribution or size premiums, quote/checkout parity and eligibility. Keep the canonical Catalogue bundle source; update all price projections, not only final checkout. |
| Landing `components/blocks/FeaturedProducts.tsx`, `product/ProductDetailModal.tsx`, cart/checkout components, `lib/{types,cart-store,api-client,deals}.ts` | **Change:** non-wig item types/options, persistent-cart compatibility, correct checkout and “add another wig” nudges only when relevant. |
| `src/modules/search/search.registry.js` | **Change:** command-palette search routes currently send product/SKU hits to `/catalogue/base/:id`. Retail hits need the correct destination. |
| `storefront.repo.js` digest/card lookups, `ai-search.service.js` | **Change:** natural-language search can find retail, without inventing products/claims; use public-safe live records and retail-aware prompts. |
| `shade_finder/*`, hair quiz | **Protect:** remain hair recommendation tools. “Everywhere products are searched” means appropriate general product searches, not treating oil as a wig shade. |
| Public reviews, sitemap, SEO and social proof | **Change:** reviews resolve only styled IDs today; sitemap depends on product list; social proof takes a styled identity. Generalize without losing existing reviews/URLs. |
| Social Studio `social.validator.js`, `social.repo.js`, social frontend/API types | **Verify/targeted change:** product tagging/links and proof should accept the correct retail identity. This is not native Instagram Shopping integration. |
| Logistics `zones.service.js`, public quote callers, manual Sales delivery-fee route, Delivery Pending/staff UI | **Change:** retain wig-only zone/quantity rates; retail-containing website orders show **EXTRA DELIVERY FEES MAY APPLY**, charge only the approved provisional zone fee and require auditable manual review/consent for adjustments. Staff enter final fee. No weight engine or FLH rate change. |
| Logistics deliveries/tracking, sales readiness, service-job subscribers | **Verify/targeted copy:** retail bypasses studio work, not payment/packing/dispatch. Mixed orders still wait for real wig work unless split fulfillment is explicitly designed. |
| Pricing module; accounting and stock-cost posting; invoices/payments | **Verify/targeted fixes:** channel pricing, cost basis, tax, currency, returns, idempotency and reporting. No wholesale rewrite of the finance engine. |
| Retention/coupons/rewards/referrals, HR commissions, stylist referral program | **Change:** zero retail loyalty/referral/commission value; mixed calculations use only eligible wig value and first-wig offers ignore retail-only history. Keep customer purchase history accurate. |
| Dashboard metrics, sales exports, AI insights, CRM links | **Verify/targeted change:** generic totals work; add role/category breakdown where required and correct hard-coded catalogue drill links. |
| Business config, brand middleware, RBAC, outbox/realtime, schema scripts | **Change/Verify:** PXG gate, correct create/publish/cost permissions, event-driven stock initialization, cache invalidation and safe upgrades/replays. |

### 5.4 What “all channels” means in this repository

- Quick Sale and the shared Sales engine support many attribution channels. Phone, event, Instagram, WhatsApp, Facebook and similar values do not each imply a separate product UI or connector.
- The old POS terminal **selling application** is retired. Quick Sale is the relevant selling UI. The remaining POS module reconciles terminal payments; its price tier and sales-channel labels still matter.
- The walk-in QR and online onboarding forms register customers. They are not catalogue checkout forms and do not need artificial product selectors.
- Public payment links, invoices and quotation links should accept/display the resulting retail order. They do not each need a second catalogue implementation.
- WooCommerce/external IDs and channel labels remain in the code. They are not sufficient evidence that live external-product synchronization is implemented or configured.

---

## 6. Instagram: verified scope versus an additional integration

**Verified current path:** staff use the messaging catalogue picker → a short `/o/<slug>` order link is created → the customer selects quantities and checks out → the sale keeps social-channel/staff attribution. Instagram and WhatsApp messaging are supported channels in this flow.

Retail must participate in that same path, including:

- Searchable name and image in the picker.
- Correct SKU/pack-size choice before sharing, or an explicitly designed customer option picker.
- Independent item quantity and price, not an attached wig.
- Retail-only and mixed checkout, stock and delivery behavior.
- Existing invoice/receipt/payment-link sharing.
- Correct brand, link lifecycle, signed-price behavior and historical snapshots.

**Decision is final for this guide:** Instagram means **the existing DM catalogue-share and checkout-link flow, just like WhatsApp**. Native Instagram Shop/product tags, Meta catalogue feeds and in-app checkout are **not requested**. No native connector was found in the source audit; do not ask this question again or add a native integration to PR 1–4.

---

## 7. Business rules and financial invariants

### Stock and product eligibility

PXG retail is **stock-only**. Set `preorder_excluded` and disable rewig eligibility by role; enforce both server-side on create, import/clone, cart/quote, checkout, quote conversion and **order amendments**, whose added-unit shortfall path independently creates preorders today. Show sold out when sellable stock is exhausted. A product is not a service and creates no styling work. No supplier backorders in this release.

Public generic-cart availability currently sums all locations (`cart.repo.js:251–264`), whereas styled availability applies sellable-location rules. Resolve retail availability and reservation against the same authorized sellable locations; preserve stock-movement/outbox idempotency and audit trails. Avoid over-selling a final item between a storefront request and a DM-link checkout.

### Channel prices, merchandising and campaigns

- Use the selected SKU's permitted live channel price. Quotes, order-link snapshots and order submission must agree about price/availability; reject/requote stale, foreign-brand, deleted, unpublished or mismatched variants. A generic cart currently retains a stale price in one quote branch—repair it, including real-DB SQL coverage.
- Staff can select retail for campaigns, collections, bundles and curated website placements; retail need not be attached to a wig. Opt-in product/category membership and coupon scope explicitly, rather than silently discounting every retail item.
- Retail units are not a second/third wig, do not satisfy raw-wig/wholesale wig thresholds and do not receive head-size, colour or lace charges. A retail bundle component must retain its own exact SKU. Preserve old wig prices and FLH campaign behavior.

### Payments, cancellation and returns

`computeDepositPolicy` uses brand instalment settings plus the **order** input, not product-level payment columns. Enforce **full payment for retail-only orders** in every sales path; **mixed orders retain the current order-wide wig instalment plan**, even though that means retail can be part of a deposit-funded order. Do not introduce misleading “retail must be paid in full” messages on mixed orders. Existing wig-only payments remain untouched. A per-line payment allocation system is not included.

Current cancellation fees are computed from the order-wide `is_custom_order` flag and entire total (`sales.service.js:2803–2816`). **The owner has not chosen a fee split for mixed custom-wig/retail cancellations.** Do not silently charge a custom-wig fee on retail goods or silently waive existing wig fees; route mixed cancellation for staff review and obtain a written policy before PR 4 goes live. Product returnability, opened cosmetics and saleable-stock restock rules likewise require approval; a financial refund does not prove an item may be returned to sellable stock. Tests must cover the chosen policy and non-automatic restocking until approved.

### Manual delivery and non-Studio fulfilment

No weight calculation, weight rate cards, courier integration or separate-parcel shipping is authorized in these PRs. Preserve wig-only zone/quantity behavior for both brands. For retail-containing orders, **staff manually calculate and enter the final delivery fee**; staff Quick Sale and quotes already have editable fee fields, and Sales has a delivery-fee endpoint and amendment flow, but those paths must be reviewed for payment, invoice, ledger and state safety.

For *website delivery* with retail, first obtain business approval for the provisional zone-fee assumption in the opening section. If approved, the server may charge its existing minimum/base zone amount (retail-only) or wig-only zone tier (mixed) up front, excluding retail quantities from wig tiers. Show **EXTRA DELIVERY FEES MAY APPLY** in bold uppercase on storefront, campaign landing and **both** `/o` checkouts before payment and on the delivery confirmation where applicable. Never assert that an extra fee is certain. Staff review the order and, if needed, request **explicit consent and verified payment** for any difference before dispatch. If delivery is unavailable/unpriced, keep existing fail-closed behavior and offer pickup/contact rather than pretending delivery is free. Pickup has no delivery fee; avoid contradictory pickup copy. A previously paid order's total cannot be changed without reconciling payments, receipts and refunds; the existing `setDeliveryFee` SQL update is **not** a complete top-up/payment workflow.

A comb-only order proceeds through payment, packing, dispatch or pickup, and completion **without a stylist assignment**. A mixed order waits for its real wig work before the single parcel is dispatched. Adjust customer-facing “goes into production” copy conditionally; do not remove valid wig/FLH production messages.

### Operational costs, tax, reporting and incentives

- Confirm tax category/rate for each retail product with PXG/accounting; existing `products.taxable` / `vat_rate` are **product-level**, so all its variants share that rule. If 50 ml and 100 ml actually require different tax treatment, re-scope variant-level tax rather than pretending the current schema supports it. Do not guess a cosmetics VAT exemption or apply wig tax rates by proximity. Establish an operational receipt cost per SKU for weighted-average/standard COGS and valuation. Encrypted Cost Vault true-cost entry is not automatically operational COGS; simplified Goods Reception may omit cost.
- Report Care & Accessories revenue, units and margin separately without calling the items wigs; existing GL accounts may remain unless accounting explicitly requests new ones. Invoices, receipts, dashboards and exports must show correct option labels, shipping adjustments, channel and tax.
- **Retail earns no loyalty points, customer referral reward or stylist referral commission.** For mixed orders, exclude retail value from reward/commission bases; `stylist_programme/referral.service.js` currently uses the whole order total. Allocate mixed coupon/bundle discounts to eligible wig lines rather than paying commission on a whole mixed total; Finance should approve the precise mixed tax/shipping basis before pilot, while pure-wig orders retain existing behavior. Preserve idempotent outbox processing and do not retroactively change settled historic commissions. A prior retail purchase remains visible in customer history, but cannot consume a specifically *first-wig* entitlement; distinguish a first order from a first eligible wig purchase when necessary.

### Batch/expiry boundary

**Owner decision: no batch or expiry tracking in this MVP.** Receive and sell by SKU, not lot. Do not block PR 1 or the MVP on an expiry-system discovery; treat any later request for lot-level receipt, FEFO, return or recall tracking as a new project. Product-label/claim approvals, where applicable, are separate from building an inventory batch engine.

---

## 8. Four large, sequential implementation PRs

**Dependency order:** PR 1 → PR 2 → PR 3 → PR 4 → limited PXG pilot. Four **separate** GitHub PRs, not four commits in one giant PR. Review/merge each before basing the next one on current `main`, subject to the new Arena chat's assigned-branch rules. Each PR updates the [progress section](#pxg-pr-progress) with evidence. Keep the public feature gate **off** in production until the complete PR 4 release checklist passes; staging may enable it with controlled test data. No early staff pilot was authorized. If a PR requires changing the owner contract, document it and get approval before merging.

### Cross-PR architecture and non-negotiable contracts

- **PXG server gate:** combine an immutable brand allowlist (`brand === 'pixiegirl'`) with a PXG rollout flag for new authoring/publishing/sales; no client parameter may enable either. Check it at create, publish, clone/import, search/list, public resolution, cart, link, checkout, raw sales and campaign membership. Staging may enable the flag to test individual PRs while production stays disabled through PR 4. Common database shape is allowed in FLH; **behavior is not**. Existing wig data remains `catalogue_role = base` by default. Reject a forged `retail` object in `faitlynhair`, even if posted through a shared cart/link.
- **Identity:** `products.catalogue_role` distinguishes a private base from a public retail good; `product_type = physical` retains its old meaning. Single-item goods get a default variant; selectable pack sizes get distinct `variant_id`/SKU/price/stock. The public contract uses `kind: styled | retail` and exact identity. No fake `styled_id`, head-size, colour, lace, rewig donor, styling job, service or replacement base.
- **Publication:** draft by default; explicit permissioned publish after required channel price/media/valid SKU checks. Preserve private base lockdown. **PR 1 publish approves a retail catalogue record for the future typed channels; it must NOT flip the legacy `products.is_visible_storefront` flag or make public sales possible before PR 2–4.** A public reader projects only approved fields—no costs, suppliers, internal images or hidden bases. Existing wig URLs stay `/product/:slug`; new retail canonical pages use `/care-and-accessories/:slug` in PR 2.
- **Authoritative sale:** one server-side resolver for brand, role, lifecycle/channel visibility, variant ownership/activity, live channel price, currency, sellable-location stock and stock-only rules. Use it consistently in staff orders, quote conversion/amendments, generic cart, DM links and campaign checkout. Validate again immediately before reservation/payment; preserve historical snapshots and idempotency.
- **Accounting/operations:** creation seeds **zero** stock through the outbox, receipt/adjustment makes it real, per-SKU operational cost supports COGS, and `line_kind = product` uses ordinary sale/return/payment rails. No retroactive reclassification or direct `stock_levels` overwrite. Manual delivery adjustments and incentives must reconcile with paid-order snapshots, invoices, customer consent, rewards and stock.
- **Kill switch:** turning the PXG gate off prevents **new** retail creation/public sale, but cannot make already-paid retail order details, fulfilment, returns or refunds inaccessible. FLH stays off through every transition.

### PR 1 — PXG identity, Care & Accessories authoring and safe stock

**Dependency:** first. **Rollout:** schema/API/admin only, public sale gate off.

1. Verify the actual staging schema/data and the current bootstrap/repair sequence. Add a `catalogue_role` value for `base | retail`, defaulting all historical products to `base` with no bulk name-based guessing. Plan migrations for both brand schemas when shared SQL expects compatible columns, but only PXG may create/use retail. Protect historic base/styled links and SKU uniqueness. Put new ALTERs in a monotonic migration; ensure new-brand bootstrap gets the column before role-aware statements execute.
2. Keep `catalogue.service.js`'s base-only publish guard on hair bases, and provide a **separate** explicit retail publish lifecycle that cannot accidentally expose a base through the old endpoint. Fix template `000043_business_base_never_storefront.sql.template` so repair never unpublishes retail again, while private hair bases remain invisible. Template `000043` runs **before** newly appended migrations and has no CREATE TABLE sentinel; its role-aware SQL must also work when an old schema has **no `catalogue_role` yet**. Test fresh bootstrap, pre-upgrade repair, upgrade and repeated repair on both schemas. Never run a destructive repair in production to discover this.
3. Add PXG **Care & Accessories** admin section with a simple product form and labelled per-SKU options, media, category, description/directions/warnings, channel prices, tax choice, optional barcode, stock-only defaults and explicit draft/publish. Reuse products/variants; remove hair-size requirements from this new path, not from the wig wizard. Implement PATCH/clone/import/restore/purge invariants and block turning a sold/linked retail product into a base (or vice versa). Protect styled-base assignment/import, BOM/production and rewig APIs from retail IDs.
4. Seed/configure a `care-and-accessories` category/navigation **for PXG only**; no FLH category or tab. A root category is enough at launch. Ensure product name/code/SKU searches, admin autocomplete and role-aware deep links do not force `/catalogue/base/:id` for retail. Preserve untouched wig pickers in hair-only flows.
5. Receive/count/purchase/adjust/transfer the exact SKU. A hair-only stock count using `unlisted: zero` must **not** write down omitted retail; a multi-variant retail count needs explicit variant/SKU matching, in both spreadsheet UI and `scripts/import-stock-count.js`. A receipt must not silently take the default bottle size. Verify variant-created outbox zero-seeding and operational cost capture/valuation independent of encrypted Cost Vault records.

**Likely files:** `migrations/template/000016*`, `000043*` and a new compatible migration; `src/modules/catalogue/{catalogue.*,styled*,availability*,rewig*}`; `src/modules/stock/{stock.*,stock.count-plan,stock.subscribers}`; `src/modules/purchasing`; `scripts/{bootstrap-business,repair-business-schema,import-stock-count}.js`; `apps/admin/src/pages/catalogue/*`, `pages/stock/*`, `pages/purchasing/*`, `lib/{catalogue,product-search}.ts`. The precise edit set must be confirmed against current HEAD.

**PR 1 exit proof:** one comb/default SKU and one 50/100 ml product can be drafted, deliberately published and received at separate locations/costs in PXG; a hair-only count and CLI import leave the bottles intact; repeated repair does not hide retail or reveal hair bases; forged FLH create/import/clone/publish calls fail; default gate off prevents public sale. Run targeted catalogue/stock tests **plus** real-DB bootstrap/upgrade/replay checks. Progress row and failures documented.

### PR 2 — authoritative retail sales, Quick Sale and main storefront

**Dependency:** merged PR 1. **Rollout:** public feature still gated; staging-only checkouts. **Before web money work:** PXG owner confirms the provisional zone-fee assumption and actual retail-product tax rates. Retail-only full payment has already been chosen.

1. Implement the common retail sellable-SKU resolver and shared typed `kind` projection. Repair generic cart SQL using the **actual** product/variant columns (the inspected path selects nonexistent `pv.price_ngn`, `p.product_name`, etc.); test against a real migrated database, not only mocked queries. Add consistent SKU/stock/availability queries and live-price revalidation at add/quote/submit and reserve. Preserve styled checkout results and old links.
2. Update shared admin pickers, `lib/product-search.ts`, Quick Sale, Quote Form, Change Order and Sales validators/services. Preserve the chosen `variant_id`: the current base picker expands all active variants, while other paths choose a default. Support retail-only and mixed orders/quotes, amendment shortages without retail preorders, explicit fulfilment choices, live channel prices, taxes and customer snapshots. Retail-only full payment is an enforced **order** rule; mixed instalments stay order-wide. Quote conversion must not change SKU or invent a wig.
3. Add `/care-and-accessories/:slug` detail and typed shop/search/category cards, option selector, cart, quote and checkout to the main storefront. Keep existing styled URLs/reviews/size controls unchanged. Do not return confidential Cost Vault, internal supplier or hidden-base fields. Use the Care & Accessories category/nav label, and reject unpublished/deleted/wrong-brand items from both URL and checkout.
4. For main web orders containing retail, add the exact **EXTRA DELIVERY FEES MAY APPLY** bold uppercase notice and *provisional*, server-derived fee behavior approved above. Exclude retail quantities from wig tier counting; a retail-only delivery uses a configured initial zone fee or fails closed/offers pickup. Staff Quick Sale and Quote Form accept an agreed **manual** fee; do not let their auto-quote effect silently overwrite a staff confirmation when cart items change. The staff-review completion and safe post-payment fee adjustment ship in PR 3; PR 2 **must stay gated**.

**Likely files:** `src/modules/{sales,storefront,catalogue,stock,logistics}/*`, `src/modules/storefront/{cart.*,checkout.public.routes.js,storefront.*}`; `apps/admin/src/{lib/product-search.ts,pages/sales/*}`; `apps/storefront/src/{lib/storefront.ts,routes/product.$slug.tsx,routes/shop*,components/*}` plus a new retail detail route. Use current route names, not this guide as a filename generator.

**PR 2 exit proof:** PXG staff can search 50 ml vs 100 ml and sell either alone or with a wig; quote, amendment and web cart keep the exact SKU, price, tax, inventory and no retail preorder. Main storefront retail page/cart/checkout show the disclosure, cannot expose unpublished/private stock or use an unpriced delivery; FLH and wig-only totals unchanged. Concurrency, stale-price, variant mismatch, full-payment and real-DB SQL tests pass. Gate remains off outside staging; update progress evidence.

### PR 3 — Instagram/WhatsApp link checkout and manual delivery operations

**Dependency:** merged PR 2. **Rollout:** gate still off publicly.

1. Extend the messaging Catalogue picker and Smartcomm order-link validator, normalizer, resolver, snapshot and public routes to carry a **retail kind and exact `variant_id`**, independent of any styled item. Preserve existing styled links, signed/snapshotted price semantics, expiry and brand isolation. The current base link chooses a default variant and checks a schema-mismatched `p.is_active` field; validate and fix in the retail-capable path with real DB coverage. Forge/tamper tests must fail.
2. Update **both** public `/o/<slug>` implementations—`apps/storefront/src/routes/o.$slug.tsx` and `apps/admin/src/pages/order/OrderCheckoutPublic.tsx`—and `src/modules/storefront/{order-form.routes.js,storefront.service.js}`. Show normal retail option/name/image/price/quantity, allow retail-only and mixed checkout, and display **EXTRA DELIVERY FEES MAY APPLY** as bold uppercase wherever a retail-containing delivery order's initial fee is shown. Preserve social attribution and service-only/non-retail behavior. Do not build a native Meta catalogue connector.
3. Complete the **manual fee** operations for retail-containing online orders: persist a durable `needs_delivery_review`-equivalent state; put these orders in a staff queue; permit authorized staff to enter/confirm a calculated final fee with audit, customer consent and verified top-up/refund or supported cancellation as appropriate. Reconcile `shipping_fee_ngn`, order totals, paid balance, invoices, payment links and GL/notifications **before dispatch**. `sales.service.js:setDeliveryFee` / `sales.repo.js:setDeliveryFee` currently update totals and clear a pending flag; do not assume that alone reconciles paid financial documents. Do not reuse the fragile `fee_pending` text filter as a stand-in for a fully priced order under review. Preserve original shipping calculation for wig-only/FLH.
4. Verify an ordinary retail order bypasses Studio jobs but still reaches pack/dispatch/pickup/complete. Mixed orders require only genuine wig/styling work. Review order detail, Delivery Pending, invoice/receipt/payment link, notifications, social-product tagging and production copy. The content of the website notice must say **MAY**, not **WILL**.

**Likely files:** `src/modules/smartcomm/smartcomm.order-links.*`, `smartcomm.{service,validator}.js`, `src/modules/storefront/{storefront.service.js,order-form.routes.js}`, `src/modules/sales/{sales.service,sales.repo,amendment.service}.js`, `src/modules/logistics/*`, `apps/admin/src/{components/messaging/*,pages/order/*,pages/sales/DeliveryPendingView.tsx,pages/sales/OrderDetailPage.tsx}`, `apps/storefront/src/routes/o.$slug.tsx`, `src/modules/social_media/*`.

**PR 3 exit proof:** Instagram/WhatsApp share → `/o` on **both** web hosts → retail-only order with exact SKU, genuine stock reservation, correct payment and no styling job. A retail delivery starts with the approved initial zone charge, shows the notice, is queued for manual review, and cannot dispatch with an unapproved/unpaid increase; pickup and wig-only controls stay intact. Extra charge refusal/refund, double-submit/idempotency and FLH forged-link tests pass. Update progress evidence.

### PR 4 — campaigns, full merchandising/incentive correctness, regressions and PXG pilot

**Dependency:** merged PR 3. **Rollout:** do not lift the public gate until final approvals/tests; after merge, run a limited PXG pilot and update the guide.

1. Extend Campaign Builder/Bundle pickers, campaign public detail/membership, deal/discount/pricing/checkout stages, and the landing app's product modal, featured cards, cart and checkout. Retail-only and mixed campaign baskets must work end-to-end with deliberate selection, exact variants, real stock and the same delivery disclosure/review. A product cannot bypass campaign membership merely because it is of retail kind; general coupon inclusion is opt-in. Exclude retail from wig-unit tiers and remove hair-size premiums on retail bundle components. Canonical bundle offers are `bundle_offers` / `bundle_offer_products` and campaign links; do not restore deleted legacy bundle mirrors.
2. Finish collections, curated related products, reviews, sitemap/SEO, safe AI search, social proof, global/admin search, account order/wishlist presentation and reporting. Keep hair-only shade finder and quizzes hair-only. Public product DTOs must not leak costs, suppliers or raw wig bases. A retail purchase must appear on order history but not be counted as a wig unit in analytics.
3. Exclude retail from purchase-points/referral reward calculations and stylist referral commissions, including order-wide **mixed** calculations (`src/modules/retention/*`, `src/modules/stylist_programme/referral.service.js`, `src/shared/hr_payroll/*` as relevant). Retain *first wig* offer eligibility after a retail-only purchase without falsifying generic first-order history. Test accrual and reversal once under duplicate events, cancellations and refunds. Verify channel price, correct product-level tax (or an approved variant-tax extension), per-SKU operational COGS/stock valuation, invoices, credit notes and reports. No retroactive rewrites of already-settled incentives.
4. Close product tax, description/claims, returns and mixed-cancellation approvals; **do not add a batch/expiry gate**. Run both-brand, all-channel integration and browser tests; manually inspect the exact notice in the main site, campaign landing and both `/o` pages. Validate safe migrations **including repeated repair**; verify old wig/FLH orders and existing links. Record results and residual risk in the progress section; only then permit limited PXG activation. Monitor stock, delivery reviews, payments, commission/reward ledger, fulfilment and error logs. If outcomes are wrong, disable **new** retail selling through the PXG gate without hiding already-paid orders.

**Likely files:** `src/modules/sales_campaigns/*`, `src/modules/retention/*`, `src/modules/stylist_programme/*`, `src/modules/storefront/{reviews*,sitemap*,ai-search*,storefront.*}`, `src/modules/accounting/*`, `src/modules/ai_insights/*`, `src/modules/search/search.registry.js`, `apps/admin/src/pages/sales-campaigns/*`, `apps/landing/{components,lib}/*`, `apps/storefront/src/{routes,components}/*`, relevant tests. Recheck actual paths before editing.

**PR 4 exit proof:** campaign landing and web checkout sell retail independently; correct coupon/membership/bundle/wig-count rules; zero retail rewards and wig-only commission bases; first wig still eligible after retail; finance/stock/fulfilment reconcile; all existing channel checkouts and both brands pass. PXG rollout approval and any consent/policy decisions are documented. Only then mark the four-PR feature complete.

**Never** reclassify past orders, directly backfill inventory balances, globally publish product bases, modify FLH's rules, enable native Meta sync, or substitute an external payment/courier call for a staging/test check. A failed gate blocks the next PR or public activation, not a reason to skip evidence.

---

## 9. Acceptance and regression checklist — check only with evidence

Use a **PXG staging dataset** with a simple comb, a 50 ml/100 ml hair-care product and a wig. Include stock in a sellable and a non-sellable location, contrasting prices, an FLH wig and forged FLH retail payloads. Include a retail-only order, wig-only order, mixed order, coupon/campaign order and both pickup and delivery. Do not claim a checked item passed without a command, database assertion or browser trace in the PR progress entry. No live payment/provider calls are authorized by this guide; use test/sandbox credentials when execution is approved.

### PR 1 — catalogue, stock and brand isolation

- [ ] PXG Catalogue visibly calls the section **Care & Accessories**. A comb with no hair fields creates one default SKU at **zero stock**; a 50/100 ml product creates two distinct labelled SKUs, prices, costs and optional barcodes. Search by name/code/SKU finds the right variant.
- [ ] Draft/unpublished/deleted retail is not publicly buyable; explicit publish requires approved fields/media/channel price; private hair bases stay invisible, including after clone/import/restore and repeated repair.
- [ ] FLH cannot create/publish/list/sell retail through UI, raw API, import/clone, shared cart, campaign link or forged order link. Normal PXG/FLH styled/base workflows do not change.
- [ ] Exact-SKU receipts, cost valuation, adjustments, transfers, purchasing, partner stock and returns reconcile. An omitted retail SKU in a **hair-only** `unlisted: zero` count remains untouched; counting 100 ml does not move 50 ml stock, including spreadsheet and CLI imports.
- [ ] Cost Vault access remains private and does not magically become operational COGS; missing SKU costs are detectable.
- [ ] Fresh bootstrap, upgrade from old schema, **pre-upgrade repair**, and repeated post-upgrade repair preserve PXG publication and private bases; FLH stays feature-off.

### PR 2 — Sales and storefront

- [ ] Staff Quick Sale, quotation, quote conversion and amendment use the exact selected SKU; each can sell retail **without** a wig and mixed with one. Inactive/deleted/wrong-brand/mismatched variants and zero/stale channel prices cannot be bought.
- [ ] New orders **and amendment shortages** cannot turn sold-out retail into preorders, rewig substitutes, factory assignments or styling jobs. Public availability considers only sellable locations; concurrent last-item attempts do not oversell.
- [ ] The main shop/category/search/card/detail, `/care-and-accessories/:slug`, cart, quote and checkout work for retail-only and mixed. Wig `/product/:slug` links, checkout totals and FLH behavior remain unchanged; no confidential stock-room/cost/private imagery leaks.
- [ ] Retail-only pays **in full**. Mixed orders keep the existing single order-wide wig instalment plan, including any deposit. Do not present mixed retail as separately paid. SKU, live price, tax and stock remain consistent from add → quote → submit → reservation/payment; real DB detects incorrect cart SQL columns.
- [ ] Main-storefront retail delivery shows **EXTRA DELIVERY FEES MAY APPLY** in bold uppercase before payment. Retail quantity never inflates wig-count delivery tiers; pickup and unpriced-zone safeguards work. Website remains gated publicly until PR 4.

### PR 3 — DM links, both checkout UIs and manual delivery

- [ ] Instagram/WhatsApp Catalogue share retains exact retail SKU, price snapshot, expiry and brand; retail-only `/o` works on **both** the storefront and admin-hosted order-checkout pages. Old styled links still work. A customer cannot forge a retail variant or client-supplied shipping fee.
- [ ] Retail-containing website delivery orders are **queued for staff review**. Staff can enter/confirm a manually calculated fee with audit; if higher than what the customer agreed/paid, the customer explicitly accepts and pays the difference using a verified path **before dispatch**. Lower fees reconcile a credit/refund. Rejected increases can cancel/refund; no silent charge or unbalanced paid order.
- [ ] The bold uppercase exact notice reads **EXTRA DELIVERY FEES MAY APPLY** (not WILL) on the main shop, both `/o` UIs and relevant confirmations; the campaign landing checkout is added in PR 4. Confirmed pickup never creates a delivery charge. A missing/zero zone does **not** become a free delivery loophole.
- [ ] Retail-only fulfilment needs no Studio job; mixed orders create only genuine wig work. Invoice/payment link/tracking/notification/receipt copy does not promise retail wig production. Repeated submit, payment webhook and outbox delivery are idempotent.

### PR 4 — campaigns, incentives, rollout

- [ ] Campaign admin/product membership, public landing cards/detail/cart/quote/checkout, collections, curated bundles and related-product results can deliberately include retail sold independently. Retail receives only **explicitly configured** coupons/deals; cannot bypass campaign authorization.
- [ ] A comb does not count as another wig in wig thresholds, wholesale/reseller rules or size premiums, including campaign bundles. Prices/available stock and channel currency agree from landing preview through server checkout.
- [ ] Retail-only earns **zero loyalty or customer/stylist referral rewards**. Mixed rewards/commissions use eligible wig value only and are not duplicated by retries; a customer's earlier retail purchase does not erase their first-**wig** eligibility. Historical commissions do not change retroactively.
- [ ] Public reviews, sitemap, SEO, safe AI search, wishlists/account, social proof, invoices, reporting and operational COGS show typed retail identity; shade finder/wig quiz remain hair-only. Public DTOs reveal no secret costs/private media.
- [ ] The campaign/landing retail checkout shows the same bold uppercase **EXTRA DELIVERY FEES MAY APPLY** notice and enters the same manual-review flow. Wig-only and FLH checkout, fee and incentive baselines remain unchanged.
- [ ] Written owner sign-off exists for the provisional web zone fee, actual retail-product tax treatment, approved product descriptions/claims, returns/restock treatment and mixed-custom cancellation fees. Without these, do **not** turn on the public PXG gate.
- [ ] Both-brand staging E2E confirms staff, main storefront, campaign landing and **both** `/o` URLs; wig-only, retail-only, mixed, pickup/delivery, manual fee adjustment/decline, cancellation/refund and accounting/stock totals. Observe a limited PXG pilot before broader activation.

### Test commands / execution notes for the next agent

- Backend targeted suites: `npm test -- --runInBand tests/unit/catalogue tests/unit/stock tests/unit/sales tests/unit/storefront tests/unit/sales_campaigns tests/unit/smartcomm tests/unit/accounting` (add retention/stylist tests when touched). Full suites: `npm run test:unit -- --runInBand` and `npm run test:integration -- --runInBand`, with a properly isolated test DB. Inspect `tests/integration/checkout-styled-bundle.test.js` and add retail/mixed siblings or extend it; **mocks cannot validate the generic-cart SQL column mismatch**.
- Root `npm run lint`; `npm --prefix apps/admin run build` (includes admin typecheck); `npm --prefix apps/storefront run build` **and** `(cd apps/storefront && npx tsc --noEmit)` (its build does not run TypeScript); `npm --prefix apps/landing run typecheck` and `npm --prefix apps/landing run build` when its components change. Run affected frontend lint commands where supported. Record baseline failures separately from new ones; never fabricate green results.
- Test migrations on throwaway/staging databases only, with an explicit rollback plan. Verify against *both* brand schemas with gate on for PXG and off for FLH, and do not run `npm run db:repair` on live data merely because this document lists it.

Existing styled-path tests are useful regressions, **not** proof that retail works. If a DB/browser environment is unavailable, leave relevant boxes unchecked, record why and block activation until they can be run.

---

## 10. Effort and cost — re-baseline after the decisions above

The earlier **25–40 engineer-day** feasibility estimate assumed an agreed, relatively simple delivery rule and mostly existing order-wide rewards/payment treatment. The four-PR contract now also requires exact-SKU option parity, **manual fee review plus consent/payment reconciliation** for online orders and exclusion of retail from otherwise order-wide rewards/commissions. The estimate below is a **new provisional planning range**, not an approval, measurement, guarantee or fixed quote. No weight-price engine is included.

| PR / allowance | Engineer-days | Included |
|---|---:|---|
| PR 1 — classification, catalogue, stock/count/cost and safe replay | 6–9 | Schema/bootstrap/repair, authoring, exact-SKU intake and focused tests. |
| PR 2 — staff Sales + shared resolver + main storefront | 7–11 | Quick Sale/quotes/amendments, generic cart repair, public retail pages, payment and initial shipping disclosure/tests. |
| PR 3 — DM links and manual delivery operations | 5–9 | Both `/o` checkouts, order links, staff fee review, consent/top-up safety and tests. |
| PR 4 — campaigns/merchandising + incentive isolation + release | 8–13 | Landing/deals/bundles, first-wig/reward/commission rules, reporting, both-brand E2E and gated pilot prep. |
| **Engineering subtotal** | **26–42** | These PR bands already include their ordinary focused tests. |
| Integration/staging and schema uncertainty | **4–8** | DB compatibility, cross-channel fixes and manual financial/regression retests. |
| **Revised planning total** | **30–50** | **240–400 hours / approximately 6–10 engineer-weeks** at eight hours/day. |

The exact PR boundaries and estimate must be refreshed after PR 1's schema/staging check and if the provisional initial delivery charge is rejected or mixed cancellation requires automated per-line finance. A cash budget is **30R–50R** at all-in day rate `R`, or **240H–400H** at hourly rate `H`; use the team's actual rate and avoid inventing a naira quote. Product entry, photography, legal label review, opening-stock count and business policy approvals consume additional business time. Existing payment/media/messaging usage charges still apply; no separate inventory platform is recommended.

**Excluded unless separately specified/estimated:** native Meta Instagram Shop/feed/tag sync or in-app checkout; lot/batch/expiry/FEFO/recalls; carrier APIs, weight/volumetric shipping, multi-parcel or split-shipment pricing; automated per-line deposits and novel mixed-order cancellation accounting; full option-matrix generation, bulk-unit conversion/decanting; rebuilding free-text manual invoice entry as a stocked-product checkout; new GL account structure or external marketplace connectors. This does **not** exclude the user's manual retail delivery fee entry or the mandatory website notice.

---

## 11. Approvals, ownership and handoff for the next Arena agent

The owner's naming, SKU, channel, stock-only, instalment, opt-in promotion, no-retail-incentive and four-PR decisions are **settled in the top decision table**; do not reopen them by treating the old feasibility assessment as higher priority. Delivery is explicitly **manual** for now, not a request for a weight-based engine. Distinguish the remaining genuine approvals from implementation questions:

| Gate / owner to confirm | When | Safe action until confirmed |
|---|---|---|
| PXG business: accept or replace the **provisional initial zone fee** for retail-containing website orders; agree the notice/confirmation experience. | Before PR 2 web payment path is implemented/released. | Keep public gate off; no website checkout that charges an unapproved fee. If a fully manual pay-after-quote flow is required, re-scope PRs 2–3 and cost. |
| PXG finance: retail-product tax rates (and whether variants need different rates), operational per-SKU receipt cost method, invoice treatment for shipping changes and the mixed wig-only commission basis (including discount/tax/shipping allocation). | PR 1 for tax/cost inputs; PR 3 for fee changes; sign off before PR 4 pilot. | Do not assume hair products' VAT from wig settings, silently record ₦0 cost, pay commission on retail value or alter a paid total without accounting review. |
| PXG content owner: approve ingredient, directions, warnings and hair-growth marketing claims where applicable; **no batch/expiry engineering gate for MVP**. | Before publishing individual listings. | Keep unapproved claims in draft. Batch/expiry is deferred, not a PR 1–4 requirement. |
| PXG operations: opened/unopened return and saleable-restock rule; **mixed custom-wig + retail cancellation fee**. | Before automated financial handling in PR 4/pilot. | Staff review mixed cancellations/retail returns; do not apply an unapproved order-wide fee to a retail return or put opened goods back into sellable stock. |
| Access policy: which existing catalogue manager can publish; which Sales/Logistics role can approve a **manual fee change**. | PR 1/PR 3, respectively. | Reuse authenticated brand-scoped roles, least privilege and audit; no anonymous fee override. |

### Pilot and rollback runbook (after PR 4, not before)

1. Obtain the written decisions above, approve product copy/claims and confirm staff publish/manual-fee permissions. Take an appropriate database backup and record current migration version, PXG/FLH gate state, wig-only checkout/commission baselines and current order counts. Use a staging/sandbox environment for the detailed payment and delivery rehearsals; **never** use live payment captures just to validate this guide.
2. With the retail-selling gate **off**, deploy safe schema/code to both compatible brand schemas, validate `000043` fresh/upgrade/repeat behavior, and confirm the FLH capability remains unavailable. Do not publish all `products` or bulk-transfer balances. Prepare PXG-only Care & Accessories navigation, two measured sample SKUs and a comb; receive opening stock/cost via normal stock movements, not direct balance SQL.
3. Run the section 9 matrix, including staffed manual-fee review and *refusal* cases. Enable the PXG-only feature for a **small approved pilot** after PR 4 is merged. Check order/payment/stock/outbox ledgers, fee-review backlog, promotions, first-wig eligibility and reward/commission accrual each day; record actual evidence in the progress entry. Only broaden after reconciling these checks with Operations/Finance.
4. If a critical issue occurs, turn off **new** PXG retail purchases and publication; leave already-placed retail order read/fulfilment/return/refund paths working. Record impacted order IDs and ledger differences for manual reconciliation. Do not roll back a data migration, erase orders or directly edit `stock_levels` as an ad hoc kill switch.

**Next-chat starting prompt (copy as needed):**

> Read `docs/PXG_RETAIL_PRODUCTS_FEASIBILITY.md` in the current checkout. This is the PXG-only Care & Accessories engineering guide. Revalidate current HEAD against audit baseline `513136e`, read the progress section, and implement **PR 1 only** as defined in section 8. Keep the feature gated, preserve FLH/wig behavior, test fresh/upgrade/repeated repair and SKU stock counts. Update the progress row and dated evidence in the guide with the PR; do not claim unrun checks passed or start PR 2 before PR 1 merges. Follow the Arena session's assigned-branch instructions.

If this document is absent from the new chat's branch, first merge/bring it into that checkout. A link to a file only on an unmerged Arena branch is **not** equivalent to a document already present on `main`. After every PR, record actual state and link in [PR progress](#pxg-pr-progress); new chats should read that row before choosing work. Do not run production migrations, real payment captures, or Meta/courier integration calls on the strength of this plan alone.
