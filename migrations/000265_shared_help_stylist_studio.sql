-- ============================================================
-- MIGRATION 000265 — Help Center content: Stylist Studio (service jobs)
-- Pixie Girl Hub · V2.2 §6.14 (In-house Styling) · §6.30 (Help Center)
--
-- Seeds the full Stylist Studio set: overview, the job lifecycle,
-- QC & rework, Wig Accountability (anti-pocketing), service types &
-- recipes & chemical reconciliation, and a FAQ.
--
-- Grounded in src/modules/service_jobs + apps/admin/src/pages/service-
-- jobs: tabs My Jobs / Job Board / QC Queue / Wig Accountability /
-- Service Types / Recipes / Chemical Reconciliation; the start→pause→
-- resume→return-for-qc→qc→dispatch→hand-to-sales flow.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('stylist-studio', 'Stylist Studio',
   'In-house styling operations — jobs from intake to hand-over, QC, and wig accountability.',
   'Scissors', 44)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-overview',
  'What Stylist Studio manages',
  'The workshop floor in software: every wig install, colour and styling job tracked from intake to hand-over, with QC and full material accountability.',
  $md$
## What it is

**Stylist Studio** (sidebar → **Stylist Studio**, or `/service-jobs`) runs
your in-house styling operations — the jobs your own stylists do on wigs and
hair. It's the workshop floor as a screen: who's working on what, at what
stage, using which materials, and whether it passed quality control.

## The tabs

- **My Jobs** — the jobs assigned to you.
- **Job Board** — every job in the studio and its stage, for supervisors.
- **QC Queue** — finished jobs waiting to be checked before they go out.
- **Wig Accountability** — the custody trail for every wig that came in (the
  anti-loss control).
- **Service Types** — the catalogue of styling services you offer.
- **Recipes** — standard material/chemical recipes per service.
- **Chemical Reconciliation** — checking chemicals used against chemicals
  booked out.

## Why it's separate from Sales

A styling job has a life of its own — it takes time, uses materials, needs QC —
before it becomes money. Studio manages that work; when the job is done it
**hands over to Sales** to be billed. Keeping them separate is what makes the
**anti-pocketing** controls possible (see Wig Accountability).
$md$,
  'all', 'service_jobs',
  ARRAY['studio','service-jobs','styling','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'stylist-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. The job lifecycle ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-job-lifecycle',
  'A styling job from intake to hand-over',
  'Create the job, assign a stylist, work it (start/pause/resume), send it to QC, then dispatch or hand it to Sales — every step time-stamped.',
  $md$
## The stages

A job moves through clear, tracked stages:

1. **Created** — the job is logged (customer, service type, the wig/hair).
2. **Assigned** — a stylist is put on it (**assign**), or it waits in the queue.
3. **In progress** — the stylist **starts work**; they can **pause** and
   **resume** (so time-on-job is real, not guessed).
4. **On hold** — parked for a reason (waiting on a part, customer decision).
5. **Returned for QC** — work done, sent to the **QC Queue**.
6. **QC passed** or **rework** — a checker approves, or sends it back with
   notes.
7. **Ready for dispatch → dispatched**, or **handed to Sales** to be billed.
8. **Completed**.

You advance a job with **Advance / Start / Pause / Resume / Return for QC / QC
/ Dispatch / Hand to Sales** — each action is time-stamped and attributed.

## Materials, references and time

As work happens the job accrues:

- **Materials & chemicals** booked against it,
- **Reference** photos/notes (the look to achieve),
- **Time logs** from the start/pause/resume actions,
- an **outcome** record when it's done.

## Why the granularity

The stages and time logs turn "it's being done" into an auditable trail —
useful for pay tied to output, for spotting bottlenecks, and for the
accountability checks below.
$md$,
  'staff', 'service_jobs',
  ARRAY['studio','job','lifecycle','qc','stages','time-logs'], 20
FROM shared.help_categories c WHERE c.slug = 'stylist-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. QC & rework ───────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-qc-and-rework',
  'The QC Queue and rework',
  'Nothing goes out unchecked: finished jobs land in the QC Queue, pass, or bounce back for rework with notes.',
  $md$
## The QC Queue

When a stylist marks a job **returned for QC**, it appears in the **QC Queue**.
A checker reviews the actual result against the reference and either:

- **passes** it (records the QC result) — it becomes ready for dispatch or
  hand-over, or
- sends it to **rework** with notes on what to fix.

## Rework

A reworked job goes back to the stylist with the QC notes attached, then
returns to QC when redone. The loop is tracked, so repeated rework on the same
job (or the same stylist) is visible rather than hidden.

## Why QC is its own stage

Separating "done by the stylist" from "approved to go out" means a job can't
skip straight to the customer. It protects the brand's quality and gives you a
real pass/rework rate to manage by.
$md$,
  'staff', 'service_jobs',
  ARRAY['studio','qc','rework','quality'], 30
FROM shared.help_categories c WHERE c.slug = 'stylist-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Wig Accountability (anti-pocketing) ───────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-wig-accountability',
  'Wig Accountability & chemical reconciliation',
  'The controls that stop value walking out the door: a custody ledger for every wig, and chemicals used checked against chemicals booked.',
  $md$
## The problem it solves

A styling job is a moment where value is easy to lose — a completed wig with no
sale attached, or chemicals used that were never booked out. **Wig
Accountability** and **Chemical Reconciliation** are the controls that make that
visible.

## The custody ledger

**Wig Accountability** keeps a **custody ledger** for every wig that entered the
studio — who had it, when, and where it is now. A completed job with **no
linked sale** is exactly what Praxis Insights flags (anti-pocketing), and the
ledger is where you check the trail.

## Chemical reconciliation

**Chemical Reconciliation** compares what a job *should* have used (from its
**recipe**) against what was actually booked, so shortfalls surface instead of
quietly disappearing.

## Recipes and service types

- **Service Types** define the styling services you offer.
- **Recipes** define the standard materials/chemicals a service needs — the
  baseline reconciliation checks against.

## Who this is for

Supervisors and the CEO. Everyday stylists just work their jobs; the
accountability views are the management lens that keeps the honest majority
protected and the gaps visible.
$md$,
  'ceo', 'service_jobs',
  ARRAY['studio','accountability','anti-pocketing','chemicals','recipes','custody'], 40
FROM shared.help_categories c WHERE c.slug = 'stylist-studio'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'studio-faq',
  'Stylist Studio FAQ',
  'Studio vs Stylist Programme, how a job becomes money, why a job got flagged, and pausing work.',
  $md$
## "Is this the same as the Stylist Programme?"

No. **Stylist Studio** is your **in-house** styling floor — your own staff
doing jobs. The **Stylist Programme** is the external **partner** programme
(independent stylists you route leads to and pay out). Different modules,
different people.

## "How does a finished job become money?"

When the work is approved, you **Hand to Sales** — the job becomes an order in
**Sales** and is billed there. That handover is the point value is captured,
which is why a completed job with no sale gets flagged.

## "Why was one of my jobs flagged by Praxis?"

Because it was completed but has **no linked sale** (or, for a cross-entity job,
no inter-company invoice). Attach the sale and the flag clears — it's the
anti-pocketing check doing its job.

## "Can a stylist pause a job?"

Yes — **pause** and **resume** are first-class actions, and the time logs
reflect them, so paused time isn't counted as work. Use **On hold** for longer
waits (a part, a customer decision).

## "Who can see all jobs versus just theirs?"

**My Jobs** is always yours; the **Job Board** and accountability views follow
your permission and record scope. Supervisors see the floor; stylists see their
work.
$md$,
  'all', 'service_jobs',
  ARRAY['studio','faq','stylist-programme','handover','pause'], 50
FROM shared.help_categories c WHERE c.slug = 'stylist-studio'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'service_jobs'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
