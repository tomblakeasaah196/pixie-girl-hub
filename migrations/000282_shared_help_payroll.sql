-- ============================================================
-- MIGRATION 000282 — Help Center content: Payroll
-- Pixie Girl Hub · V2.2 §6.11 (Payroll) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Payroll set: overview, the payroll-run lifecycle,
-- commissions & bonuses, payslips & disbursement, and a FAQ.
--
-- Grounded in src/shared/hr_payroll/payroll.routes + apps/admin/src/
-- pages/hr/PayrollPage: payroll-runs calculate→review→approve→pay→
-- reverse; payslips + pdf; commissions approve/reverse; bonuses.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('payroll', 'Payroll',
   'Payroll runs, commissions and bonuses, payslips and disbursement.',
   'Wallet', 62)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'payroll-overview',
  'What Payroll does',
  'Turns the month''s work into pay: base, commission, bonuses and deductions calculated from real HR data, reviewed, approved and paid.',
  $md$
## What it is

**Payroll** (sidebar → **Payroll**, or `/payroll`) turns a period's work into
pay. It gathers base salary, **commission** (from sales staff drove), **bonuses**
and **deductions**, calculates each person's pay, and moves the run through
review, approval and disbursement — producing a **payslip** for everyone.

## Built on HR data

Payroll doesn't ask you to re-type earnings. It reads the **rules** set in HR
(commission, bonus, deduction) and the real data behind them (sales, targets,
attendance), so a run reflects what actually happened. Your job is to review and
approve, not to compute.

## The safeguards

A run is **calculated**, then **reviewed**, then **approved**, then **paid** — and
can be **reversed** if something's wrong. Payslips are generated as PDFs, and the
whole thing posts to **Accounting** as labour cost. Money to people is
high-stakes, so it's staged and auditable.
$md$,
  'ceo', 'payroll',
  ARRAY['payroll','overview','commission','pay'], 10
FROM shared.help_categories c WHERE c.slug = 'payroll'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. The payroll-run lifecycle ─────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'payroll-run-lifecycle',
  'Running payroll: calculate, review, approve, pay',
  'A run moves through clear stages so pay is checked before it leaves — with a reverse for when you need to undo.',
  $md$
## The stages

1. **Create** the payroll run for a period.
2. **Calculate** — the Hub computes each person's pay from base, commission,
   bonuses and deductions.
3. **Review** — check the figures; this is where errors are caught.
4. **Approve** — sign the run off.
5. **Pay** — disburse; payslips are issued.
6. **Reverse** — if something was wrong, unwind the run cleanly.

## Why each stage

Calculating and **paying** in one click would be how a wrong number reaches
everyone's bank account. The **review** and **approve** gates put human eyes and a
sign-off between the calculation and the cash. The **reverse** exists because
mistakes happen and must be undoable without hand-editing the ledger.

## What it posts

An approved, paid run posts to **Accounting** (labour cost, payables cleared) and
produces each employee's **payslip** — so the books and the people are both
squared by the same action.
$md$,
  'ceo', 'payroll',
  ARRAY['payroll','runs','calculate','review','approve','reverse'], 20
FROM shared.help_categories c WHERE c.slug = 'payroll'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Commissions & bonuses ─────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'payroll-commissions-and-bonuses',
  'Commissions and bonuses',
  'Commission is earned from real sales and approved before it pays; bonuses are added and, like commission, can be reversed if needed.',
  $md$
## Commissions

**Commission** is earned from the sales a staff member actually drove, using the
**commission rules** set in HR. It's **approved** before it pays (and can be
**reversed**), so what reaches payroll is confirmed, not assumed. Staff see it
building in their **My HR** earnings.

## Bonuses

**Bonuses** are added on top — a one-off reward, a target hit, a discretionary
payment. Like commission, a bonus can be **reversed** if it was added in error, so
the pay record stays correct.

## Why approve commission separately?

Because commission is derived from sales that might be adjusted, refunded or
disputed. Approving it before the run means a bad sale doesn't silently pay a
commission — you confirm the earned amount, then it flows into pay.
$md$,
  'ceo', 'payroll',
  ARRAY['payroll','commission','bonus','approve','reverse'], 30
FROM shared.help_categories c WHERE c.slug = 'payroll'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'payroll-faq',
  'Payroll FAQ',
  'Where pay figures come from, fixing a paid run, payslips, commission timing, and where rules are set.',
  $md$
## "Where do the pay figures come from?"

From HR: base salary, plus **commission/bonus/deduction rules** applied to real
data (sales, targets, attendance). Payroll **calculates** from those — you don't
type earnings by hand.

## "I approved a run with a mistake."

**Reverse** the run — that unwinds it cleanly rather than you editing the ledger.
Fix the input (a rule, a commission) and re-run.

## "How do staff get their payslip?"

Each run produces a **payslip** per employee, available as a PDF. Staff also see
their earnings picture in **My HR**.

## "Why isn't commission showing in the run yet?"

Commission must be **approved** first (it's derived from sales that could change).
Once approved, it flows into the run. Staff can see it accruing in My HR before
that.

## "Where do I change commission or deduction rules?"

In **HR & Staff** — the rules live there; Payroll applies them each run. That way
a rule change is set once and used consistently.
$md$,
  'ceo', 'payroll',
  ARRAY['payroll','faq','reverse','payslip','commission','rules'], 40
FROM shared.help_categories c WHERE c.slug = 'payroll'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'payroll'
--   ORDER BY sort_order;  -- expected: 4 rows
-- ============================================================
