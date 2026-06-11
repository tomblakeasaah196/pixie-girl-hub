# Entity Isolation

How PXG and FLH data stay clean and separate.

## Why this matters

PXG has an external investor; FLH is wholly Faith's. **Their books must never cross.** Any leak (a costing line booked to the wrong company, a journal entry posted twice, an investor seeing FLH's salary structure) is a credibility-destroying bug.

## The three lines of defence

1. **Schema-per-business at the DB level** — primary mechanism
2. **brand-context middleware** — every API call resolves to one brand
3. **Permission-scoped retrieval in RAG** — AI can never surface the wrong brand's data

## Schema-per-business

```
pixiegirl.sales_orders    ←→  pixiegirl.invoices   ←→  pixiegirl.journal_entries
faitlynhair.sales_orders  ←→  faitlynhair.invoices ←→  faitlynhair.journal_entries
```

You literally cannot write `SELECT * FROM sales_orders` and accidentally pull both brands. The schema name must be specified, and every query goes through a repo that takes a `brand` parameter, builds `pixiegirl.foo` or `faitlynhair.foo`, and refuses any other value.

```js
const { VALID_BRANDS } = require("../../config/brands");

function tableFor(brand) {
  if (!VALID_BRANDS.has(brand)) throw new Error(`Invalid brand: ${brand}`);
  return `${brand}.foo`;
}
```

## brand-context middleware

Every request to `/api/v1/*` runs through `brandContextMiddleware`:

1. Reads `X-Brand-Context` header (primary signal)
2. Falls back to URL path `/api/v1/{brand}/...`
3. Falls back to `user.default_business_key`
4. Verifies the resolved brand is in `user.available_businesses` (CEO has both)
5. Sets `req.brand` for the request

If the resolved brand isn't accessible, the request 403s before the controller runs.

## Inter-company trade

Where the two companies do trade with each other (PXG → FLH wholesale, FLH → PXG styling services), it's a **formal invoice pair**, not a shared data flow:

```
PXG raises an invoice TO FLH        (lives in pixiegirl.invoices)
FLH receives the invoice            (lives in faitlynhair.supplier_invoices)
The PAIR is recorded in shared.intercompany_transactions
```

The `intercompany_transactions` row links the two sides. A nightly reconciliation job checks every IC transaction has matching journal entries in both brands' books. Any mismatch is flagged as a Tier-1 AI Insight (`shared.ai_insight_intercompany_alerts`).

## Shared tables

Some data is genuinely cross-brand and lives in `shared.*`:

- `users`, `roles`, `permissions` — staff work across both
- `contacts` — a customer might buy from both brands
- `intercompany_transactions` — by definition spans both
- `audit_log` — single source of truth for what happened
- `ai_messages`, `ai_embeddings` — AI is one system
- `webhook_log` — incoming webhooks logged centrally

Shared tables that hold per-brand data (like `contacts.loyalty_points_by_business`) include a `business` column so cross-brand views can still segment.

## RLS — status (corrected 2026-06-11)

V2.2 §3 mandates **row-level security** at the database layer. Two facts that
were previously mis-recorded (see `HUB_VS_PIXIE_DEEP_VERIFICATION.md` R-1):

1. **The policies ARE applied.** Migration `000200_shared_rls.sql` enables RLS
   on every `shared.*` table with a `business` column (62 tables) with the
   `brand_isolation` policy `current_business() IS NULL OR business =
current_business()`. (Per-brand ERP data lives in brand schemas and is
   isolated by schema, not by this RLS.)
2. **The plumbing was NOT there.** `transaction()` did not set the GUC, the
   `withBrand` helper named in the migration never existed, and the old
   parameterised `SET LOCAL app.current_business = $1` would have thrown
   (the `SET` command takes no bind params). So `current_business()` was always
   NULL → the policy let every brand through → RLS was inert (failed open).

**Now wired (R-1, 2026-06-11):** the brand + user resolved by
`middleware/brand-context.js` are bound into an `AsyncLocalStorage` request
context (`config/request-context.js`); `transaction()` reads it and applies
`app.current_business` / `app.current_user_id` via
`set_config(name, value, true)` (parameter-safe, transaction-local). So **every
request-scoped transaction now filters shared tables to the request's brand**,
and the WITH CHECK blocks cross-brand writes. `brandTransaction(brand, userId,
fn)` is the explicit choke point for worker/cron/outbox paths.

**Remaining R-1 step (read side):** one-shot `query()` reads outside a
transaction still run on a pooled connection with no GUC → RLS treats them as
"no filter", so those reads stay app-layer-isolated only (same as before — no
regression). Completing read-side enforcement (wrapping context'd one-shot
reads, or a request-scoped connection) is a follow-up that needs a staging
perf check before rollout.

## What to never, ever do

- **Never** join `pixiegirl.foo` to `faitlynhair.bar` in one query
- **Never** pass a brand value from a request body without going through middleware
- **Never** allow Praxis to switch brands mid-conversation without explicit confirmation
- **Never** copy data between brand schemas in code — use the formal IC invoice pair
