-- ============================================================
-- MIGRATION 000285 — Help Center content: Retention & Loyalty
-- Pixie Girl Hub · V2.2 §6.18 (Retention) · §6.30 (Help Center)  [PR2]
--
-- Seeds the full Retention set: overview, loyalty & streaks, rewards/
-- coupons/subscriptions/bundles, referrals & win-back strategies,
-- analytics, and a FAQ.
--
-- Grounded in src/modules/retention + apps/admin/src/pages/retention:
-- tabs Strategies / Loyalty / Rewards / Referrals / Coupons /
-- Subscriptions / Bundles / Maintenance / Analytics; loyalty tiers,
-- streak tiers, strategy builder.
--
-- Idempotent: ON CONFLICT (slug) DO NOTHING.
-- ============================================================

INSERT INTO shared.help_categories (slug, name, description, icon, sort_order)
VALUES
  ('retention', 'Retention & Loyalty',
   'Keeping customers coming back — loyalty tiers, rewards, coupons, subscriptions, referrals and win-back strategies.',
   'Heart', 65)
ON CONFLICT (slug) DO NOTHING;

-- ── 1. Overview ──────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retention-overview',
  'What Retention does',
  'The toolkit for keeping customers: loyalty, rewards, coupons, subscriptions, bundles and referrals, driven by strategies and measured by analytics.',
  $md$
## What it is

**Retention** (sidebar → **Retention**, or `/retention`) is everything aimed at
keeping customers coming back rather than winning new ones each time — which is
cheaper and worth more. It pulls the loyalty, incentive and win-back tools into
one module.

## The tabs

- **Strategies** — automated retention plays (built in the strategy builder).
- **Loyalty** — tiers customers climb by buying.
- **Rewards** — what loyalty earns.
- **Referrals** — customers bringing in customers.
- **Coupons** — discount codes.
- **Subscriptions** — recurring purchases.
- **Bundles** — packaged offers.
- **Maintenance** — housekeeping for the above.
- **Analytics** — is any of it working?

## Where it connects

Retention reads **CRM** (churn scores, preferences) and **Contacts** (segments)
to know *who* to target, and works with **Sales**, **Marketing** and **Sales
Campaigns** to deliver the offer. Praxis Insights surfaces **high churn-risk
customers** — your win-back list — which is exactly what Strategies act on.
$md$,
  'ceo', 'retention',
  ARRAY['retention','loyalty','overview'], 10
FROM shared.help_categories c WHERE c.slug = 'retention'
ON CONFLICT (slug) DO NOTHING;

-- ── 2. Loyalty & rewards ─────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retention-loyalty-and-rewards',
  'Loyalty tiers, streaks and rewards',
  'Set the tiers customers climb by buying (and by buying regularly), and the rewards those tiers unlock.',
  $md$
## Loyalty tiers

**Loyalty tiers** are the levels a customer moves up as they spend — bronze,
silver, gold and so on. Each tier can carry perks, so loyal customers feel the
benefit of staying. You define the tiers and what qualifies for each.

## Streaks

**Streak tiers** reward **consistency**, not just total spend — a customer who
buys regularly builds a streak. This targets habit, which is the real driver of
retention: someone who buys every month is worth more than an occasional big
spender.

## Rewards

**Rewards** are what loyalty and streaks unlock — discounts, gifts, perks. Tie
them to tiers so the incentive is clear: reach this level, get this. Rewards are
where loyalty stops being points and becomes something the customer actually
wants.

## The individual view

You can see a specific customer's **loyalty** and **streak** standing on their
profile, so staff can acknowledge a VIP or a loyal regular at the point of sale.
$md$,
  'ceo', 'retention',
  ARRAY['retention','loyalty','tiers','streaks','rewards'], 20
FROM shared.help_categories c WHERE c.slug = 'retention'
ON CONFLICT (slug) DO NOTHING;

-- ── 3. Coupons, subscriptions, bundles & referrals ───────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retention-incentives-and-referrals',
  'Coupons, subscriptions, bundles and referrals',
  'The incentives that pull customers back — discount codes, recurring orders, packaged deals — and referrals that turn customers into a channel.',
  $md$
## Coupons

**Coupons** are discount codes — for a campaign, a win-back, a VIP thank-you.
They're tracked, so you know which coupon drove which sale rather than guessing at
a blanket discount.

## Subscriptions

**Subscriptions** turn a one-off purchase into a recurring one — the most reliable
retention there is, because the customer keeps buying without deciding again each
time.

## Bundles

**Bundles** package items into a single offer, raising basket size and giving a
reason to buy the set rather than one piece. (They're the same catalogue bundles
Sales can sell.)

## Referrals

**Referrals** turn happy customers into a growth channel: a customer refers a
friend, the referral is **attributed**, and you can reward it. Because it's
tracked, you can see who your best advocates are and reward them specifically.
$md$,
  'ceo', 'retention',
  ARRAY['retention','coupons','subscriptions','bundles','referrals'], 30
FROM shared.help_categories c WHERE c.slug = 'retention'
ON CONFLICT (slug) DO NOTHING;

-- ── 4. Strategies & analytics ────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retention-strategies-and-analytics',
  'Win-back strategies and measuring retention',
  'Build automated retention plays in the strategy builder — targeting at-risk customers — and use analytics to see what actually keeps people.',
  $md$
## Strategies

The **strategy builder** lets you define automated retention plays — e.g. "when a
good customer hasn't bought in 60 days, send this coupon." Strategies act on the
signals from CRM (churn risk) and Contacts (segments), so your win-back runs
itself rather than depending on someone remembering.

## The win-back list

Praxis Insights flags customers whose **churn-risk is High or Critical** — your
win-back list. Strategies are how you respond at scale: target that list with the
right incentive automatically.

## Analytics

**Analytics** tells you whether any of it works — repeat rate, loyalty
engagement, coupon redemption, referral volume. Retention spend is only worth it
if it moves these numbers, and this is where you check.

## Maintenance

The **Maintenance** tab is housekeeping for the retention tools (tidying rules,
expiring old coupons) — keeping the machinery clean so the strategies and offers
stay accurate.
$md$,
  'ceo', 'retention',
  ARRAY['retention','strategies','win-back','churn','analytics'], 40
FROM shared.help_categories c WHERE c.slug = 'retention'
ON CONFLICT (slug) DO NOTHING;

-- ── 5. FAQ ───────────────────────────────────────────────
INSERT INTO shared.help_articles
  (category_id, slug, title, summary, body_markdown, audience, related_module, tags, sort_order)
SELECT c.category_id, 'retention-faq',
  'Retention FAQ',
  'Loyalty vs streaks, the win-back list, coupons vs campaigns, referral tracking, and measuring impact.',
  $md$
## "Loyalty tiers or streaks — what's the difference?"

**Tiers** reward total spend (how much). **Streaks** reward consistency (how
regularly). Together they recognise both your big spenders and your reliable
regulars.

## "Where does the win-back list come from?"

From **CRM churn scores** surfaced by Praxis Insights — customers at High/Critical
risk of leaving. **Strategies** act on that list automatically.

## "Coupon or Sales Campaign?"

A **coupon** is a discount code you can attach to retention plays. A **Sales
Campaign** is a full time-bound event (flash sale, landing page). Coupons are a
tool; campaigns are the show — and campaigns can use coupons.

## "How are referrals credited?"

A referral is **attributed** to the referring customer when the new customer buys,
so you can reward the advocate. Tracked attribution is what stops referral rewards
being guesswork.

## "How do I know retention is working?"

The **Analytics** tab — repeat rate, redemption, engagement. If the numbers don't
move, the strategy needs changing; if they do, you know the spend is paying off.
$md$,
  'ceo', 'retention',
  ARRAY['retention','faq','loyalty','churn','coupons','referrals'], 50
FROM shared.help_categories c WHERE c.slug = 'retention'
ON CONFLICT (slug) DO NOTHING;

-- ============================================================
-- Verify
--   SELECT slug FROM shared.help_articles WHERE related_module = 'retention'
--   ORDER BY sort_order;  -- expected: 5 rows
-- ============================================================
