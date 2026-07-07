-- ============================================================
-- MIGRATION 000272 — Help Center content: Retail Partners (consignment)
-- Pixie Girl Hub · V2.2 §6.13 (Retail/Consignment) · §6.30 (Help Center)
--
-- Seeds the full Retail Partners set: overview, partners & locations,
-- consignment stock & movements, settlements, and a FAQ.
--
-- Grounded in src/modules/retail_partners + apps/admin/src/pages/retail-
-- partners: tabs Partners / Stock / Movements / Settlements; partner
-- CRUD + status + locations; consignment stock, movements, settlements
-- (approve, dispute, mark paid).
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('retail-partners', 'Retail Partners',
   'Consignment: partners who hold your stock, what they''ve sold, and settling up.',
   'Store', 49)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retail-overview',
  'How consignment works here',
  'Partners hold your stock and sell it on your behalf; the Hub tracks what they hold, what they sold, and what they owe you at settlement.',
  $md$
## What consignment means

A **retail partner** holds *your* stock in *their* shop and sells it for you.
You still own it until it sells. **Retail Partners** (sidebar → **Retail
Partners**, or `/retail-partners`) is where you track that arrangement: what each
partner holds, what they've sold, and what they owe you.

## The tabs

- **Partners** — the consignment partners, their details and status.
- **Stock** — how much of your inventory each partner currently holds.
- **Movements** — stock sent to a partner and returned from them.
- **Settlements** — reconciling their sales and getting paid.

## Why it's its own module

Consignment stock is a special case: it's counted, but it's sitting off-site at
someone else's shop, and the money for it arrives later at settlement. Keeping it
separate from your own **Stock** locations means your on-hand count stays clean
and the partner relationship is tracked end to end.
$md$,
  'ceo', 'retail',
  ARRAY['retail','consignment','partners','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'retail-partners'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Partners & locations ──────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retail-partners-and-locations',
  'Setting up partners and their locations',
  'Add a consignment partner, record their shop locations, and set them active or inactive as the relationship changes.',
  $md$
## Adding a partner

On the **Partners** tab, create a **partner** with their business and contact
details, then set their **status** (active while trading; inactive when the
arrangement pauses or ends). Only active partners take new consignment.

## Locations

A partner can have one or more **locations** (their shops). Consignment stock
and sales are tracked against a location, so if a partner runs several outlets
you can see which one holds — and sells — what.

## The relationship record

Everything a partner does — stock they hold, movements to and from them, and
settlements — hangs off this record, so the partner page is the single view of
how that relationship is performing and what's outstanding.
$md$,
  'ceo', 'retail',
  ARRAY['retail','partners','locations','status'], 20
FROM shared.help_categories c WHERE c.slug = 'retail-partners'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Consignment stock & movements ─────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retail-stock-and-movements',
  'Sending stock out and tracking what''s held',
  'Record stock moved to a partner and returned from them, so you always know how much of your inventory is out on consignment.',
  $md$
## Movements: out and back

A **movement** records stock going **to** a partner (consignment out) or coming
**back** from them (returns / recall). Recording movements is what keeps the
partner's held quantity accurate.

## The Stock tab

The **Stock** tab shows, per partner (and location), how much of each item they
currently hold. It's the answer to "how much of our inventory is sitting out
there?" — which matters, because that stock is your money tied up until it sells.

## Keeping your own count clean

Because consignment stock is tracked here rather than in your normal Stock
locations, your on-hand count reflects what *you* can sell directly, while this
module reflects what partners can sell on your behalf. The two don't get
confused.
$md$,
  'ceo', 'retail',
  ARRAY['retail','stock','movements','consignment','returns'], 30
FROM shared.help_categories c WHERE c.slug = 'retail-partners'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Settlements ───────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retail-settlements',
  'Settling up with a partner',
  'Reconcile what a partner sold, approve the settlement, and mark it paid — with disputes and overdue amounts surfaced by Insights.',
  $md$
## What a settlement is

A **settlement** reconciles a partner's sales for a period: what they sold of
your stock, what they owe you (net of their agreed cut), and the paperwork to
close it out.

## The flow

1. **Create** the settlement for the period.
2. **Approve** it once the figures are agreed.
3. **Mark paid** when the money lands.

If the numbers don't agree, a settlement can be **disputed** — which keeps it
open and visible rather than quietly written off.

## What Insights watches

Praxis flags a settlement that is **disputed**, or **approved/invoiced but
unpaid for 7+ days** (escalating from 30 days or when disputed). So money a
partner owes you doesn't slip through — the settlement either gets paid or gets
chased.

## Why the sign-off

Approve-then-pay means a settlement isn't just marked done by one person.
Combined with the dispute path, it protects both sides and keeps consignment
income reconcilable against the stock the partner actually held.
$md$,
  'ceo', 'retail',
  ARRAY['retail','settlements','approve','paid','dispute'], 40
FROM shared.help_categories c WHERE c.slug = 'retail-partners'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retail-faq',
  'Retail Partners FAQ',
  'Consignment vs a normal sale, unsold stock, disputed settlements, and why partner stock is separate.',
  $md$
## "How is consignment different from a normal sale?"

In a normal sale you sell direct and get paid now. In **consignment** the
partner holds your stock and you're paid **at settlement**, only for what
actually sold — unsold stock stays yours and can be returned.

## "A partner didn't sell everything — what happens?"

Record a **movement** bringing the unsold stock back (a return/recall). You're
only settled for what sold; the rest comes home or stays on consignment for the
next period.

## "A settlement amount is wrong."

Mark it **disputed** rather than approving it. That keeps it open and flagged by
Insights until it's resolved, so a disagreement isn't buried.

## "Why isn't partner stock in my normal Stock count?"

Because it's off-site and unsold — counting it as on-hand would overstate what
you can sell directly. Retail Partners tracks it separately so both numbers stay
true.

## "A partner owes me and hasn't paid."

Insights flags an approved/invoiced settlement **unpaid past 7 days**. Chase it
from the settlement, and use the partner's **status** if the relationship needs
pausing.
$md$,
  'ceo', 'retail',
  ARRAY['retail','faq','consignment','returns','settlement','dispute'], 50
FROM shared.help_categories c WHERE c.slug = 'retail-partners'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'retail'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
