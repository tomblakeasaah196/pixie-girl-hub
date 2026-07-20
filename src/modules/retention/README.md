# Retention module

**Spec:** Customer Retention & Loyalty + Streak Stars + Hair Quiz (V2.2 §6.23)
**Permission key:** `retention`

## What this module does

Everything in the retention programme is **configured as data, not code** — the
owner can add a new strategy or economy rule without a deploy.

### Strategy engine (multi-step journeys — the no-code automation layer)

A *strategy* = a trigger + audience + declarative conditions + an ordered ladder
of steps (e.g. *win-back: day 0 email → day 4 coupon*). Adding one is just rows.

- `strategy.engine.js` — `trigger()` enrols matching active strategies (snapshotting
  customer facts); `tick()` advances due enrolments through their steps.
- `strategy.conditions.js` — declarative `{all|any|not / field,op,value}` evaluator.
- `strategy.facts.js` — the customer-facts object (spend, tier, recency, tags, …).
- `strategy.actions.js` — runs a step's action (email is the canonical channel).
- `strategy.suppression.js` — quiet hours + per-customer frequency cap.
- `strategy.catalogue.js` — self-describing registry (triggers, condition fields,
  operators, action schemas, templates) that powers the template-first builder UI.
- `strategy.templates.js` — ready-made playbooks (welcome, win-back, birthday, …).

Triggers are fed by the event spine (`retention.subscribers.js`: order.paid →
`order_placed`/`first_purchase`/`high_value_purchase`; tier/referral/quiz events)
and the daily scanner (`jobs/schedulers/retention-strategy-scan.js`: birthday,
anniversary, inactivity/win-back, reorder, renewal, points-expiring). The
per-minute `retention-strategy-tick` cron runs `engine.tick()`.

### Economy engine (config-driven)

- **Earn** (`earn.repo.js` + `retention.service.earnForOrder`/`earnForAction`):
  `shared.loyalty_earn_rules` defines how points are earned (purchase, review,
  social-share, …) — flat or per-currency, with tier multiplier + expiry.
- **Redeem** (`rewards.*`): `shared.loyalty_rewards` catalogue (order discount,
  free shipping, free product, gift); `redeemReward` deducts via the ledger.
- **Referrals** (`referral-config.repo.js` + `retention.service.redeemReferral`):
  `shared.referral_program_settings` + `referral_reward_tiers` drive the friend
  discount, tiered referrer ladder, and anti-fraud; auto-redeemed on full settlement.

### Crowns 👑 (unified loyalty + streak — `crown.*`)

The **merge** of the two legacy economies (`shared.loyalty_*` points +
`{brand}.streak_star_*` stars) into one currency for our "Pixie Queens".
Introduced by migration `000362`; the legacy tables are backfilled 1:1 into
Crowns and frozen (removed in a later cutover PR).

- **Status-only**: Crowns accumulate to drive a tier and are **never spent**, so
  there is no redemption ledger and **no GL liability accrual** — the tier
  discount is an ordinary sales discount recognised at checkout. `lifetime_earned`
  never resets; urgency lives in the *streak*, which can lapse.
- **One merged tier ladder** (The Tiara → Coronet → Diadem → Imperial). Tiers
  1–3 mint a one-time "% off next purchase" voucher on promotion
  (`crown_reward_grants`); Imperial adds a standing lifetime discount.
- **Earn** (`crown.service.awardByRule` / `awardForAction` / `earnForOrder`):
  `crown_earn_rules` defines the ways to earn, each with a `verification_mode` —
  `auto` (a system event proves it), `honor` (one-tap self-report,
  auto-approved + capped), or `manual` (proof queued in
  `crown_action_submissions` for staff approval).
- **Streaks** (`crown.streak.js`): a monthly-purchase streak and a weekly
  check-in streak run in parallel, with freezes and a daily nudge/break scanner
  (`jobs/schedulers/crown-streak-scan.js`). As seeded they mint no Crowns
  (config-toggleable). Detection emits `crown.streak_at_risk` /
  `crown.streak_frozen` / `crown.streak_broken` (email + in-app delivery lands
  with the UI PR).
- The `order.paid` spine (`retention.subscribers.js`) now also runs
  `crownService.earnForOrder` (flat purchase + per-₦ + purchase streak),
  idempotent per order.

## Endpoints (under `/api/v1/retention`)

- `GET  /strategies/catalogue` — triggers/conditions/actions/templates for the builder
- `GET/POST /strategies`, `POST /strategies/from-template`, `PATCH /strategies/:id`,
  `PATCH /strategies/:id/status`, `POST /strategies/:id/preview`,
  `POST /strategies/:id/test-send`, `GET /strategies/:id/enrollments`
- `GET/POST /rewards`, `GET /rewards/catalogue`, `PATCH /rewards/:id`, `POST /rewards/redeem`
- `GET /crowns/tiers`, `PATCH /crowns/tiers/:id`, `GET /crowns/earn-rules`,
  `PATCH /crowns/earn-rules/:id`, `GET /crowns/streak-config`,
  `GET /crowns/customers/:contactId` (wallet), `.../discount`,
  `POST .../adjust`, `POST .../check-in`, `POST .../submit`,
  `GET /crowns/submissions`, `POST /crowns/submissions/:id/review`
- plus the existing `loyalty`, `streak`, `referral`, `coupons`, `bundles`,
  `subscriptions`, and legacy single-action `workflows`.

## Backing tables

`shared`: loyalty_tiers, loyalty_ledger, customer_loyalty_state, loyalty_earn_rules,
loyalty_rewards, loyalty_reward_redemptions, referrals, referral_redemptions,
referral_program_settings, referral_reward_tiers, coupons, coupon_redemptions,
subscription_plans, subscriptions, subscription_billing_attempts.
Crowns (000362): crown_tiers, crown_earn_rules, crown_ledger,
customer_crown_state, crown_streak_config, crown_streaks, crown_reward_grants,
crown_action_submissions.

`{brand}`: bundle_offers, maintenance_plans, streak_star_*, hair_quiz_*,
retention_workflow_rules (legacy), retention_strategies, retention_strategy_steps,
retention_enrollments, retention_strategy_step_runs.
