-- ============================================================
-- MIGRATION 000277 — Help Center content: Expenses & Advances
-- Pixie Girl Hub · V2.2 §6.10 (Expenses) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Expenses set: overview, filing a claim, cash advances &
-- settlement, approval routing, and a FAQ.
--
-- Grounded in src/modules/expenses + apps/admin/src/pages/expenses:
-- expense claims with categories + receipts, cash advances, KPIs;
-- workflow-gated approval; advance settlement.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('expenses', 'Expenses & Advances',
   'Filing expense claims, cash advances, receipts and the approval that signs them off.',
   'Receipt', 52)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'expenses-overview',
  'What Expenses handles',
  'Two things: reimbursing money staff already spent (claims) and money given upfront to be accounted for later (advances) — both with approval.',
  $md$
## What it is

**Expenses** (sidebar → **Expenses**, or `/expenses`) covers company money that
isn't a supplier purchase:

- **Claims** — money a staff member spent and wants reimbursed (with a receipt).
- **Advances** — money given **upfront** for a purpose, to be **settled**
  (accounted for) afterwards.

Both flow through **approval**, so spend is authorised and recorded, and both
post to **Accounting**.

## Why it's controlled

Loose cash is where money leaks. Requiring a **category**, a **receipt** and an
**approval** on every claim, and a **settlement** on every advance, turns "petty
cash" into an auditable trail — you always know who spent what, on what, and
whether an advance was accounted for.

## Where it connects

Expenses draw on **categories** (how spend is classified), tie to **HR** (who
spent it), and post to **Accounting**. Advances overlap with **Cash Requests**,
which is the disbursement side of getting money out.
$md$,
  'all', 'expenses',
  ARRAY['expenses','claims','advances','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'expenses'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Filing a claim ────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'expenses-filing-a-claim',
  'Filing an expense claim',
  'Pick a category, enter the amount, attach the receipt, and submit — then it routes for approval before reimbursement.',
  $md$
## The steps

1. **Create** the claim: choose a **category**, enter the amount and a
   description.
2. **Attach the receipt** — the proof that backs the claim.
3. **Submit** — it routes to the right approver.
4. On **approval**, it's cleared for reimbursement and posts to the books.

## Why the receipt matters

A claim without a receipt is just an assertion. Attaching the receipt is what
makes reimbursement defensible and keeps the category totals meaningful for the
CEO watching spend.

## Categories

**Categories** classify spend (transport, materials, hosting…). Consistent
categories are what make the expense reports useful — so pick the right one
rather than a catch-all.
$md$,
  'staff', 'expenses',
  ARRAY['expenses','claim','receipt','category','submit'], 20
FROM shared.help_categories c WHERE c.slug = 'expenses'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Advances & settlement ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'expenses-advances-and-settlement',
  'Cash advances and settling them',
  'Money given upfront must be accounted for: an advance is disbursed, spent, then settled with receipts — or it''s flagged as overdue.',
  $md$
## What an advance is

An **advance** is money given to a staff member **before** the spend — for a
trip, a bulk purchase, a job. Unlike a claim (spend first, reimburse later), an
advance is trust extended, so it must be **settled**: accounted for with receipts
once the money is spent.

## The settlement

After spending, the holder **settles** the advance — showing what it was spent on
(with receipts). If they spent less, the balance is returned; if more, the extra
becomes a claim. Settlement is what closes the loop.

## What Praxis watches

An advance that's **disbursed and unsettled for 14+ days**, or flagged **overdue
for settlement**, is raised by Praxis Insights (escalating from 30 days). That's
the guardrail against advances that quietly never get accounted for.

## The tie to Cash Requests

The **disbursement** of an advance — actually getting the cash out — runs through
**Cash Requests**. Expenses is where the advance is defined and settled; Cash
Requests is how the money leaves.
$md$,
  'all', 'expenses',
  ARRAY['expenses','advance','settlement','overdue','disbursement'], 30
FROM shared.help_categories c WHERE c.slug = 'expenses'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'expenses-faq',
  'Expenses FAQ',
  'Claim vs advance, no receipt, who approves, overdue advances, and expense vs supplier purchase.',
  $md$
## "Claim or advance — which do I use?"

Spent your own money and want it back? **Claim**. Need money **upfront** for a
purpose? **Advance** — which you then **settle** with receipts.

## "I lost the receipt."

A claim really needs its receipt to be approved and to stand up to audit. Without
it, approval is at management discretion — expect it to be harder, and don't rely
on it.

## "Who approves my expense?"

It routes through the **approval workflow** to the right approver based on the
amount and rules your business set. You submit; the workflow decides who signs
off. Pending approvals show up for them (and on the dashboard).

## "I was given an advance and haven't settled it."

Settle it promptly — an unsettled advance past **14 days** is flagged by Praxis
(and chased). Show what it was spent on with receipts; return any balance.

## "Is a supplier purchase an expense?"

No. Buying stock from a supplier is **Purchasing** (PO → GRN → supplier invoice).
Expenses is for staff claims and advances — operational spend, not inventory.
$md$,
  'all', 'expenses',
  ARRAY['expenses','faq','claim','advance','approval','purchasing'], 40
FROM shared.help_categories c WHERE c.slug = 'expenses'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'expenses'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
