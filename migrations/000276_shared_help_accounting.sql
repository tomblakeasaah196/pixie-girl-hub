-- ============================================================
-- MIGRATION 000276 — Help Center content: Accounting & Finance
-- Pixie Girl Hub · V2.2 §6.4 (Accounting) · §6.30 (Help Center)  [PR2]
--
-- Populates the existing 'finance' category (seeded empty in 000214) with
-- the full Accounting set: overview, chart of accounts & journals,
-- periods & closing, financial reports, bank & tax & FX, and a FAQ.
--
-- Grounded in src/modules/accounting + apps/admin/src/pages/accounting:
-- tabs CoA / Journals / Periods / Bank / Tax Center / Reports; account
-- groups & accounts, period close, journals, reports (trial balance, P&L,
-- balance sheet, cash flow, AR/AP ageing), bank statements, FX
-- revaluation, tax computation & filings.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

-- The 'finance' category already exists (000214). Upsert is a safe no-op.
INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('finance', 'Finance & Accounting',
   'The books — chart of accounts, journals, period close, financial reports, bank, tax and FX.',
   'Wallet', 50)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'accounting-overview',
  'What Accounting is (the books)',
  'The double-entry books for each company — fed automatically by sales, invoices and purchases, NGN-based with FX handled.',
  $md$
## What it is

**Accounting** (sidebar → **Accounting**, or `/accounting`) is the **books** —
the double-entry ledger for each company. Most of it fills itself: sales,
invoices, receipts, purchases and payroll **post** here as they happen, so the
ledger reflects the business without re-keying.

## The tabs

- **CoA** — the Chart of Accounts (your account structure).
- **Journals** — the double-entry entries that make up the ledger.
- **Periods** — accounting periods, and closing them.
- **Bank** — bank statements and reconciliation.
- **Tax Center** — tax computation and filings.
- **Reports** — the financial statements.

## NGN-based with FX

The books are kept in **naira**, with **FX revaluation** handling foreign-
currency balances so USD (or other) amounts are restated correctly. You record
in the currency of the transaction; the books stay consistent in NGN.

## Two companies, two sets of books

Pixie Girl and Faitlynhair each have their own ledger. The active business chip
selects which books you're looking at; the CEO can see both. Genuinely
cross-company items are handled by Intercompany.
$md$,
  'ceo', 'accounting',
  ARRAY['accounting','books','overview','double-entry','fx'], 10
FROM shared.help_categories c WHERE c.slug = 'finance'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. CoA & journals ────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'accounting-coa-and-journals',
  'Chart of accounts and journal entries',
  'The account structure everything posts to, and the journals — mostly automatic, sometimes manual — that make up the ledger.',
  $md$
## Chart of Accounts (CoA)

The **CoA** is the list of accounts your money is classified into — assets,
liabilities, income, expenses — grouped into **account groups**. It's the
skeleton every transaction hangs on: a sale credits income, a purchase debits an
expense, and so on.

## Journals

A **journal entry** is a balanced double-entry posting (debits equal credits).
Most journals are created **automatically** when something happens in the Hub (an
invoice is raised, a payment lands, payroll runs). You can also post **manual**
journals for adjustments — accruals, corrections, opening balances.

## Why it self-fills

Because Sales, Invoicing, Purchasing and Payroll post their own journals, the
ledger stays current without an accountant re-entering every transaction. Manual
journals are the exception, for the things software can't infer.

## Draft vs posted

A journal can sit as a **draft** before it's posted. Praxis Insights flags a
**draft entry unposted for 7+ days** (the books aren't closing) — so nothing
lingers half-recorded.
$md$,
  'ceo', 'accounting',
  ARRAY['accounting','coa','journals','double-entry','posting'], 20
FROM shared.help_categories c WHERE c.slug = 'finance'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Periods & reports ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'accounting-periods-and-reports',
  'Periods, closing and the financial statements',
  'Close a period to lock it, then read the trial balance, P&L, balance sheet, cash flow and ageing reports straight from the ledger.',
  $md$
## Periods and closing

Accounting runs in **periods** (typically months). **Closing** a period locks it
so its figures can't shift under you — the basis for reliable reporting and for
starting the next period clean.

## The reports

From the **Reports** tab (all read live from the ledger):

- **Trial Balance** — every account's balance, proving debits = credits.
- **Profit & Loss** — income vs expenses for the period.
- **Balance Sheet** — what you own and owe at a point in time.
- **Cash Flow** — where cash moved.
- **AR / AP Ageing** — what customers owe you and what you owe suppliers,
  bucketed by age.

## Why close before you trust the numbers

An open period can still receive postings. Closing draws the line so the P&L and
balance sheet you show for that month are final — which is exactly why the flag
on stale draft journals matters: they must be posted before a clean close.
$md$,
  'ceo', 'accounting',
  ARRAY['accounting','periods','close','reports','p-and-l','balance-sheet'], 30
FROM shared.help_categories c WHERE c.slug = 'finance'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Bank, tax & FX ────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'accounting-bank-tax-fx',
  'Bank reconciliation, tax and FX revaluation',
  'Match the ledger to your bank statements, compute and file tax, and restate foreign-currency balances at the current rate.',
  $md$
## Bank

The **Bank** tab is where you bring in **bank statements** and reconcile them
against the ledger — confirming that what the books say matches what the bank
says. Reconciliation is the check that catches missed, duplicated or mis-posted
transactions.

## Tax Center

**Tax computation** works out what's owed, and **tax filings** track the returns
you submit. Keeping tax in the books means the liability is visible as it accrues,
not a surprise at filing time.

## FX revaluation

For balances held in foreign currency, **FX revaluation** restates them at the
current rate, so the naira value of a USD balance is correct on the books. You
run a revaluation and it posts the gain/loss — the mechanism that keeps an
NGN-based ledger honest about foreign holdings.

## Bank accounts & gateways

The bank accounts and payment gateways themselves are configured in **Settings**;
Accounting is where their activity is reconciled and reported.
$md$,
  'ceo', 'accounting',
  ARRAY['accounting','bank','reconciliation','tax','fx','revaluation'], 40
FROM shared.help_categories c WHERE c.slug = 'finance'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'accounting-faq',
  'Accounting FAQ',
  'Do I post entries myself, reopening a closed period, why draft journals get flagged, and how FX is handled.',
  $md$
## "Do I have to post every entry myself?"

No — most journals post **automatically** from what happens elsewhere (sales,
invoices, purchases, payroll). You only post **manual** journals for adjustments
the system can't infer.

## "Can I reopen a closed period?"

Closing is meant to be final so reports stay stable. Reopening is a deliberate,
restricted action — treat a close as a commitment and post everything (including
draft journals) before you close.

## "Why is a draft journal being flagged?"

Because it's been **unposted for 7+ days**. A draft doesn't affect the ledger
until posted, so a stale draft means the books aren't fully recorded. Post it (or
discard it) to clear the flag.

## "We take payment in dollars — how is that handled?"

You record in the transaction currency; the books stay in **naira**, and **FX
revaluation** restates foreign balances at the current rate so the NGN figures
are correct.

## "Where are the financial statements?"

The **Reports** tab — Trial Balance, P&L, Balance Sheet, Cash Flow, AR/AP
Ageing — read live from the ledger, so they reflect current postings.
$md$,
  'ceo', 'accounting',
  ARRAY['accounting','faq','journals','periods','fx','reports'], 50
FROM shared.help_categories c WHERE c.slug = 'finance'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'accounting'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
