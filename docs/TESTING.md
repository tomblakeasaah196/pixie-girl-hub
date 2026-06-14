# Testing — Pixie Girl Hub Backend

Status as of 2026-06-13. This closes the first slice of `BACKEND_COMPLETION_PLAN.md` §1
(automated tests + smoke). It replaces "verification by reading" with verification by running.

## What runs today

### Unit tests (no DB — run anywhere)
```
npm run test:unit
```
Pure-function coverage of the integrity-critical math. All expectations were verified against the
actual source modules:

| Suite | File | Guards |
| --- | --- | --- |
| Money | `tests/unit/utils/money.test.js`, `money.charm.test.js` | Decimal parsing, 2dp half-up, charm rounding (NGN/USD/GBP/EUR/GHS), gateway-fee gross-up + cap, currency validation |
| Payroll | `tests/unit/hr_payroll/payroll.calc.test.js` | Progressive PAYE bands, pension/NHF, relief, net pay, employer-pension-excluded-from-net |
| Geofence | `tests/unit/attendance/geo.calc.test.js` | Haversine distance + clock-in accept/reject (permission/accuracy/inside/outside) |
| RBAC vocab | `tests/unit/access/catalog.test.js` | 37 enforced module keys, action + record-scope sets, catalog validators |
| Password reset | `tests/unit/auth/password-reset.test.js` | Hash-only token storage, no account enumeration, single-use, session revocation |
| Bundles | `tests/unit/retention/bundle.test.js` | buy_x_get_y (cheapest-unit grouping) + tiered_qty discount math, subtotal cap |
| Praxis Query Agent | `tests/unit/praxis_ai/query-agent.test.js` | Read-tool exposure, `view`-permission gating (CEO bypass), execute + summarise |
| Access, Campaigns | `tests/unit/access/access.test.js`, `tests/unit/sales_campaigns/*` | (pre-existing) |

### Smoke test (needs a live DB — run on real infra/CI)
```
npm run db:migrate:shared
npm run db:bootstrap:pixiegirl
npm run db:bootstrap:faitlynhair
npm run smoke
```
`scripts/smoke-test.js` boots the real config + pool and confirms the schema is present and seeded:
env validates → DB connects → `shared` schema + identity tables exist → system roles seeded →
business schemas bootstrapped → RLS policy count. Exit 0 = pass, non-zero = fail. It also **prints
the per-role permission-grant counts**, which currently surfaces the §1.3 gap (only `owner` has
grants).

### GL integrity (opt-in integration — needs a live DB)
```
RUN_DB_TESTS=1 DB_HOST=localhost DB_NAME=pixie_hub_test DB_USER=postgres DB_PASSWORD=postgres npm run test:integration
```
`tests/integration/gl-balance.test.js` proves the spec's hard invariant against **actual data**:
every journal entry balances (Σdebit = Σcredit) and each ledger nets to zero. It discovers the
`journal_lines` tables itself (no chart-of-accounts assumptions) and passes vacuously on an empty DB,
becoming a real regression guard once anything posts. **Opt-in** (`RUN_DB_TESTS=1`) so it never
produces a false failure where no DB exists; wire that env var into the CI job that runs
migrate + bootstrap.

### Access matrix (opt-in integration — needs a migrated DB)
`tests/integration/rbac-matrix.test.js` proves migration `000207` seeded the §3 Role×Module
matrix and enforces the spec's privacy rules: Sales Rep has no Accounting/Payroll grant, Ops Mgr
has no Accounting, Business Setup is CEO-only, Finance gets full Accounting (incl. approve), China
Production has no Attendance. Same `RUN_DB_TESTS=1` gate. The `npm run smoke` output also prints
per-role grant counts so you can eyeball the seeded matrix.

### Entity isolation / RLS (opt-in integration — needs a migrated DB)
`tests/integration/entity-isolation.test.js` proves shared-table row-level security (migration
`000200`): it asserts RLS is enabled on every business-scoped `shared.*` table, then provisions a
throwaway **non-superuser** role, connects as it, and verifies a brand context (`app.current_business`)
sees only its own rows while a NULL context (CEO/cross-brand) sees both. Reproduces the production
posture — see `docs/ENTITY_ISOLATION.md` for why a non-superuser connection is required and the
enablement runbook (`scripts/rls/force-rls.sql`, `RLS_READ_ENFORCE`). Same `RUN_DB_TESTS=1` gate.

## ⚠️ Where to run
Do execution-level work (`jest`, `node`, `eslint`, `git`) on **real CI or a clean checkout**, never
through a sandbox file mount — some mounts serve *truncated copies* of recently-edited files and will
report phantom syntax errors / invalid `package.json`. The committed code is fine; the tooling view
isn't. (This is why prior verification stayed static.)

## Next integration tests to build (priority order, per BACKEND_COMPLETION_PLAN §1.1)
Each should run against the CI Postgres and assert both the record state **and** a balanced GL.
1. **Revenue → GL**, one test per entry point: direct sale, POS, storefront order-form, Paystack
   webhook. Create → pay → assert `sales_orders` state + `gl-balance` holds.
2. **Stock**: `reserveForOrder` → `deductForSale` happy path; oversell returns `INSUFFICIENT_STOCK`
   (409).
3. **Discounts**: coupon, bundle (incl. buy_x_get_y once built), loyalty-points redemption,
   campaign — floor-respecting, VAT correct.
4. **Subscription billing** (W-C): one paid order per cycle, idempotent on retry.
5. **Intercompany**: record → match → settle posts balanced entries in **both** books.
6. **RLS isolation**: a Faitlyn user reads zero Pixie rows with `RLS_READ_ENFORCE=on`.
7. **RBAC**: a Sales Rep is denied salary/cost-price reads (depends on §1.3 role seeding).

Suggested harness: a `tests/integration/_helpers.js` that bootstraps a throwaway brand + an admin
user + an open fiscal period, returns an authenticated supertest agent, and truncates business
tables between suites.
