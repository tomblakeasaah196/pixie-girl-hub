# Prompt — PXG Care & Accessories PR 4 (final PR)

Implement **PR 4 — the final PR** of the PXG Care & Accessories plan in `tomblakeasaah196/pixie-girl-hub`, following `docs/PXG_RETAIL_PRODUCTS_FEASIBILITY.md` (§ "PR 4 — campaigns, full merchandising/incentive correctness, regressions and PXG pilot" and the §9 PR 4 checklist). Work **only** on the branch Arena assigns to this session. Open **one draft PR** from it and do **not** merge it.

## 0. Verify prerequisites first (do not trust me)
- Run `git fetch origin main` and `gh pr view 735 --json state,mergedAt,mergeCommit`. PR 3 (#735) must be `MERGED` and your branch must be based on the resulting `main`. If it is not merged, stop and tell me.
- Re-run on `main` before you change anything, and record the results as a baseline:
  - `npx jest --ci --json --outputFile=/tmp/jest.json && node scripts/ci/assert-unit-results.mjs /tmp/jest.json`. Only the 3 known pre-existing failures are allowed (`praxis_ai/sql-agent-chain`, `praxis_ai/sql-agent-fallback`, `services/currency-service`).
  - All care suites: `npx jest tests/unit/*/care-*`. Expect 13 green.
  - The three PGlite suites, which should pass 14/14, 13/13 and 7/7:
    - `node --test tests/helpers/care-sales-pglite.node.cjs`
    - `node --test tests/helpers/care-pr3-pglite.node.cjs`
    - `node --test tests/helpers/care-migration-pglite.node.cjs`
- Check whether `ci/github-workflows/pr-checks.yml` has been installed into `.github/workflows/` and report which.
- Environment notes:
  - `node_modules` may not persist between turns. Reinstall the root, `apps/admin`, `apps/storefront` and `apps/landing` with `PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci`.
  - Commit and push early and often.
  - The sandbox cannot push `.github/workflows/*`.

## 1. Money-path gate (hard rule, carried from PR 2/3)
Search GitHub issues, discussions, and PR comments/reviews (including #733–#735) for **owner approval** of:
- (a) the provisional initial-zone delivery fee for retail web delivery;
- (b) retail tax treatment.

If approval is found, quote and link it, then implement the charged retail delivery path. It must use a server-derived initial zone fee plus the PR 3 review queue. There must be no browser-entered fee, no ₦0 loophole, and no weight-based pricing.

If approval is **not** found, keep retail web delivery **fail-closed** (pickup only, staff manual fee allowed) on every channel, including campaign landing. Implement everything else and report the blocker in the PR.

## 2. Scope
1. **Campaigns and bundles.**
   - Extend these to deliberately include retail sold independently: the Campaign Builder/Bundle pickers, campaign public detail/membership, and the deal/discount/pricing/checkout stages (`src/modules/sales_campaigns/*`).
   - Also extend the landing app's product modal, featured cards, cart and checkout (`apps/landing/*`).
   - Carry the exact `variant_id`, real stock, and the same **EXTRA DELIVERY FEES MAY APPLY** notice (bold uppercase, **MAY** never WILL) and review behaviour.
   - Retail kind never bypasses campaign membership. Coupons and deals apply to retail only when **explicitly configured**.
   - Retail never counts toward wig-unit tiers, wholesale/reseller thresholds or hair-size premiums, including inside bundles.
   - Use canonical `bundle_offers` / `bundle_offer_products`. Do not restore the legacy bundle mirrors.
2. **Merchandising and surfaces.** Cover collections, curated related products, reviews, sitemap/SEO, safe AI search, social proof, global/admin search, account order history/wishlist, and reporting/analytics.
   - Retail appears in order history but is never counted as a wig unit.
   - Shade finder and wig quiz stay hair-only.
   - Public DTOs must not leak costs, suppliers or raw wig bases.
3. **Incentives.**
   - Retail-only orders earn **zero** loyalty/purchase points and **zero** customer or stylist referral rewards/commissions.
   - Mixed orders use only the eligible wig value. Look at `src/modules/retention/*`, `src/modules/stylist_programme/referral.service.js` and `src/shared/hr_payroll/*`.
   - A retail-only purchase must not erase *first-wig* offer eligibility, without falsifying generic first-order history.
   - Accrual and reversal must be idempotent under duplicate events, cancellations and refunds.
   - Never make retroactive changes to settled incentives.
4. **Finance.** Verify channel price and product-level tax (or an approved variant-tax extension) across invoices, credit notes and reports. Also verify per-SKU operational COGS/stock valuation, and that delivery-review GL entries reconcile.
5. **Release readiness.**
   - Run both brands on every channel: staff sales, main web, both `/o` hosts and campaign landing.
   - Confirm old wig/FLH orders and existing links still work.
   - Test that migrations are safe **including repeated repair**.
   - Write a pilot runbook: what to monitor (stock, delivery reviews, payments, reward/commission ledger, fulfilment, error logs) and the rollback (turn off the PXG gate to stop **new** retail selling without hiding already-paid orders).
   - Close or list the outstanding approvals: tax, description/claims, returns, mixed-order cancellation, and pilot sign-off.

## 3. Standing rules (unchanged)
- Retail-only orders pay in full. Mixed orders keep the order-wide wig instalment.
- Retail stock is tracked only as stock; no batch/lot/expiry gate.
- FLH rejects retail everywhere: the DB CHECK `chk_care_accessories_role` plus app gates.
- The PXG gate is `brand === 'pixiegirl'` && `FEATURE_PXG_CARE_ACCESSORIES_ENABLED`, and stays **off in production**. Do not flip it. Pilot activation is my decision after review.
- Never:
  - reclassify past orders;
  - backfill inventory balances;
  - globally publish product bases;
  - change FLH rules;
  - enable native Meta sync;
  - call real payment or courier providers as a substitute for tests.
- The `delivery_fee_settled` Comms Studio template still needs operator setup. Report its status.

## 4. Testing (real, not mocked-only)
- Add real-SQL PGlite suites using the shared fixture `tests/helpers/care-pglite-fixture.cjs`, each with a jest `spawnSync` wrapper (model: `tests/unit/sales/care-pr3-db.test.js`). They must cover:
  - retail-only and mixed campaign checkout;
  - membership bypass refused;
  - coupon opt-in;
  - wig-tier and size-premium exclusion in bundles;
  - zero retail rewards/commissions;
  - mixed orders use the wig-only basis;
  - duplicate/cancel/refund reversal applied once;
  - first-wig eligibility after a retail purchase;
  - FLH forged retail refused on campaign paths;
  - wig-only/FLH regressions unchanged byte-for-byte.
- Run all of these:
  - all care suites;
  - the full unit gate (`assert-unit-results.mjs`);
  - admin `npm run build`;
  - storefront `npx vite build && npx tsc --noEmit -p .`;
  - landing build/tsc;
  - `node scripts/ci/lint-changed.mjs <base> <changed files>`.
- Run browser checks (Playwright or equivalent against local builds) of the exact notice on the main shop, campaign landing and both `/o` pages. State clearly that these are local, not staging.

## 5. Deliverables and honesty
- Commits and **one draft PR** from the assigned branch. Do not merge.
- Update the guide: the PR 3 row to *Merged* with the verified SHA/date, the PR 4 row, the PR 4 progress entry (commands, exact results, blockers) and the §9 PR 4 checklist. Tick only what is proven.
- Never fabricate green results. Separate embedded-PG and local results from staging. Explicitly list everything unverified: staging migration replay, real ledger, real providers, browser runs on deployed hosts, and pilot approvals.
- Only mark the four-PR feature complete if the PR 4 exit proof in the guide is fully met. Otherwise say exactly what remains before pilot activation.
