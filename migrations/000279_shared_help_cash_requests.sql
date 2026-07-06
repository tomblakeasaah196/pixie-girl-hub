-- ============================================================
-- MIGRATION 000279 — Help Center content: Cash Requests & Disbursement
-- Pixie Girl Hub · V2.2 §6.32 (Cash Request) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Cash Requests set: overview, raising a request, the
-- approval queue (My / Finance / CEO), settlement, and a FAQ.
--
-- Grounded in src/modules/cash_request + apps/admin/src/pages/cash-
-- requests: request create/submit, documents, history, KPIs; settlement
-- wizard; My / Finance queue / CEO approval flow.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('cash-requests', 'Cash Requests',
   'Requesting money out — the approval queue, disbursement and settling what was spent.',
   'Wallet', 54)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cash-overview',
  'What Cash Requests is for',
  'The controlled way money leaves the business: a request, an approval chain, a disbursement, and a settlement — nothing paid on a whim.',
  $md$
## What it is

**Cash Requests** (sidebar → **Cash Requests**, or `/cash-requests`) is the
front door for money going **out** of the business — an advance for a job, funds
for a purchase, an operational disbursement. Every request is raised, **approved
through a chain**, disbursed, and then **settled**.

## Why it's separate

Getting cash out is exactly where control matters most. Rather than "someone
transferred it," a cash request has a **requester**, an **amount**, a **reason**,
supporting **documents**, an **approval trail** and a **history**. That turns
disbursement into an auditable process.

## The approval queue (§6.32)

Requests move through queues by role:

- **My** — the requests you raised, and their status.
- **Finance queue** — requests waiting on finance review.
- **CEO approval** — where higher-value or final sign-off happens.

Who approves at which step follows your business's rules and thresholds.

## Where it connects

It overlaps with **Expenses** (advances are settled there) and posts to
**Accounting**. Cash Requests is the *disbursement* mechanism; Expenses is where
an advance is defined and accounted for.
$md$,
  'all', 'cash',
  ARRAY['cash','disbursement','overview','approval'], 10
FROM shared.help_categories c WHERE c.slug = 'cash-requests'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Raising a request ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cash-raising-a-request',
  'Raising and submitting a cash request',
  'State the amount and purpose, attach documents, submit — then track it through the approval chain from your My queue.',
  $md$
## The steps

1. **Create** the request: amount, purpose, and who/what it's for.
2. **Attach documents** — a quote, a pro-forma, anything that justifies the
   amount.
3. **Submit** — it enters the approval chain.
4. Track it in **My** requests as it moves Finance → CEO (per your rules).

## Show the chain before you submit

A good request makes approval fast: a clear reason and supporting documents mean
the approver doesn't have to come back and ask. The **history** on the request
records every step, so there's never a question of who approved what.

## Status

A request is **draft** until submitted, then **pending** through each approval
step, then **approved** (ready to disburse) or **rejected** (with a reason). You
always know where yours is.
$md$,
  'all', 'cash',
  ARRAY['cash','request','submit','documents','approval'], 20
FROM shared.help_categories c WHERE c.slug = 'cash-requests'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Disbursement & settlement ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cash-disbursement-and-settlement',
  'Disbursing and settling a cash request',
  'Once approved, the money is disbursed and later settled with proof of what it was spent on — closing the loop.',
  $md$
## Disbursement

Once a request is **approved**, the money is **disbursed** to the requester. This
is the point cash actually leaves — and because it required the approval chain,
it's authorised, not assumed.

## Settlement

Money out must be **accounted for**. The **settlement wizard** walks the
requester through showing what the cash was spent on (with documents/receipts).
If less was spent, the balance is returned; if more, it's reconciled. Settling is
what turns "we gave them cash" into "and here's exactly what happened to it."

## The tie to advances

A cash request that funds an **advance** is settled in step with the Expenses
advance settlement — an advance disbursed and **unsettled for 14+ days** is
flagged by Praxis, so nothing paid out is left unaccounted.
$md$,
  'all', 'cash',
  ARRAY['cash','disbursement','settlement','advance'], 30
FROM shared.help_categories c WHERE c.slug = 'cash-requests'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'cash-faq',
  'Cash Requests FAQ',
  'Cash request vs expense claim, who approves, tracking status, settling, and why documents matter.',
  $md$
## "Cash request or expense claim?"

A **cash request** gets money **out before** it's spent (a disbursement you then
settle). An **expense claim** reimburses money you **already** spent. Advances sit
across both — requested here, settled in Expenses.

## "Who approves my request?"

It follows the **queue chain** — typically Finance review, then CEO sign-off for
higher amounts — based on your business's thresholds. You submit; the chain routes
it. Watch progress in **My** requests.

## "How do I know where my request is?"

The request's **status** and **history** show every step and who acted. No need to
chase — it's all on the request.

## "I got the cash — now what?"

**Settle** it: use the settlement wizard to show what it was spent on, attach
proof, and return any balance. Unsettled disbursements are flagged, so settle
promptly.

## "Why do I need to attach documents?"

Because a request for money should justify itself. A quote or pro-forma makes
approval quick and the disbursement defensible — it's the difference between a
process and a favour.
$md$,
  'all', 'cash',
  ARRAY['cash','faq','approval','settlement','documents'], 40
FROM shared.help_categories c WHERE c.slug = 'cash-requests'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'cash'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
