/**
 * Crowns 👑 — unified loyalty + streak economy (Module 6.23). Business logic.
 *
 * Crowns are STATUS-ONLY: they accumulate to drive a tier and are never spent,
 * so there is no redemption ledger and no loyalty-style liability accrual — the
 * tier discount is recognised as an ordinary sales discount at checkout. The
 * ledger trigger maintains balance + tier; on promotion we mint the one-time
 * "% off next purchase" / free-shipping vouchers as crown_reward_grants.
 *
 * Earn verification (crown_earn_rules.verification_mode):
 *   auto   — a system event proves it → award immediately (order.paid, DOB, …)
 *   honor  — one-tap self-report → submission auto-approved (capped)
 *   manual — proof enters the queue → staff approves → award
 */

"use strict";

const repo = require("./crown.repo");
const streak = require("./crown.streak");
const events = require("./retention.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const DEFAULT_VOUCHER_EXPIRY_DAYS = 90;

// ── Reads ──────────────────────────────────────────────────
const listTiers = ({ brand }) => repo.listTiers({ brand });
const listRules = ({ brand, action_type }) =>
  repo.listRules({ brand, action_type });
const listStreakConfig = ({ brand }) => repo.listStreakConfig({ brand });
const listAtRiskStreaks = ({ brand }) => repo.listAtRiskStreaks({ brand });

/** The full customer-facing wallet: balance, tier, progress, streaks, vouchers. */
async function getWallet({ brand, contact_id }) {
  const [state, ledger, streaks, grants, tiers] = await Promise.all([
    repo.getState({ brand, contact_id }),
    repo.listLedger({ brand, contact_id, limit: 50 }),
    repo.listStreaksForContact({ brand, contact_id }),
    repo.listActiveGrants({ brand, contact_id }),
    repo.listTiers({ brand }),
  ]);
  return { state: state || null, ledger, streaks, grants, tiers };
}

/**
 * The discount a Pixie Queen is entitled to at checkout: the standing lifetime
 * tier discount plus any one-time promotion voucher. Stacking policy is a
 * checkout concern — this returns the raw entitlements + the grant ids to burn.
 */
async function getActiveDiscount({ brand, contact_id }) {
  const [state, grants] = await Promise.all([
    repo.getState({ brand, contact_id }),
    repo.listActiveGrants({ brand, contact_id }),
  ]);
  const nextVouchers = grants.filter(
    (g) => g.grant_type === "next_purchase_discount",
  );
  const best = nextVouchers.reduce(
    (m, g) => (Number(g.discount_pct) > Number(m?.discount_pct ?? -1) ? g : m),
    null,
  );
  return {
    lifetime_discount_pct: Number(state?.lifetime_discount_pct || 0),
    next_purchase_discount_pct: Number(best?.discount_pct || 0),
    next_purchase_grant_id: best?.grant_id || null,
    free_shipping: grants.some((g) => g.grant_type === "free_shipping_next"),
    tier_name: state?.tier_name || null,
  };
}

// ── Core award ─────────────────────────────────────────────
/**
 * Award Crowns for an already-resolved rule. Enforces idempotency (per
 * reference), lifetime / monthly / yearly caps, and the optional tier
 * multiplier, then mints promotion vouchers if the earn crossed a tier.
 * Returns the ledger entry, or null when nothing was awarded.
 */
async function awardByRule({
  client,
  brand,
  contact_id,
  rule,
  reference_type,
  reference_id,
  amount_ngn,
  awarded_by,
  description,
}) {
  if (!rule || !rule.is_active) return null;

  const run = async (c) => {
    // Idempotency — same (contact, reference, action) never earns twice.
    if (reference_id) {
      const existing = await repo.ledgerForReference({
        client: c,
        brand,
        contact_id,
        reference_type,
        reference_id,
        action_type: rule.action_type,
      });
      if (existing) return existing;
    }

    // Anti-abuse caps.
    if (rule.max_awards_per_customer_lifetime) {
      const n = await repo.countAwards({
        client: c,
        brand,
        contact_id,
        rule_id: rule.rule_id,
      });
      if (n >= rule.max_awards_per_customer_lifetime) return null;
    }
    if (rule.max_awards_per_customer_per_month) {
      const n = await repo.countAwardsInWindow({
        client: c,
        brand,
        contact_id,
        rule_id: rule.rule_id,
        interval: "1 month",
      });
      if (n >= rule.max_awards_per_customer_per_month) return null;
    }
    if (rule.max_awards_per_customer_per_year) {
      const n = await repo.countAwardsInWindow({
        client: c,
        brand,
        contact_id,
        rule_id: rule.rule_id,
        interval: "1 year",
      });
      if (n >= rule.max_awards_per_customer_per_year) return null;
    }

    // Compute Crowns.
    let crowns = rule.crown_value || 0;
    if (rule.crowns_mode === "per_currency" && rule.unit_currency_per_crown) {
      if (!amount_ngn) return null;
      crowns = Math.floor(
        Number(money(amount_ngn).toFixed(2)) /
          Number(rule.unit_currency_per_crown),
      );
    }

    // Read lifetime *before* the earn so we can detect tier crossings.
    const before = await repo.getState({ client: c, brand, contact_id });
    const oldLifetime = before ? before.lifetime_earned : 0;

    let multiplier = 1;
    if (rule.apply_tier_multiplier && before && before.current_tier_id) {
      const tier = await repo.getTierById({
        client: c,
        brand,
        tier_id: before.current_tier_id,
      });
      multiplier = tier ? Number(tier.earning_multiplier) || 1 : 1;
    }
    crowns = Math.floor(crowns * multiplier);
    if (crowns <= 0) return null;

    const entry = await repo.insertLedger({
      client: c,
      brand,
      entry: {
        contact_id,
        transaction_type: "earn",
        crowns,
        earn_rule_id: rule.rule_id,
        earn_action_type: rule.action_type,
        multiplier_used: multiplier !== 1 ? multiplier : null,
        reference_type,
        reference_id,
        description: description || rule.display_name,
        awarded_by,
      },
    });

    events.emit("crown.earned", {
      brand,
      contact_id,
      crowns,
      action_type: rule.action_type,
    });

    await issuePromotionGrants({
      client: c,
      brand,
      contact_id,
      oldLifetime,
      newLifetime: oldLifetime + crowns,
    });

    return entry;
  };

  return client ? run(client) : transaction(run);
}

/** Resolve the active rule for an action (+ platform), then award. */
async function awardForAction({
  client,
  brand,
  contact_id,
  action_type,
  social_platform,
  reference_type,
  reference_id,
  amount_ngn,
  awarded_by,
  description,
}) {
  if (!contact_id) return null;
  const rules = await repo.listRules({ client, brand, action_type });
  const rule = social_platform
    ? rules.find((r) => r.social_platform === social_platform)
    : rules[0];
  if (!rule) return null;
  return awardByRule({
    client,
    brand,
    contact_id,
    rule,
    reference_type,
    reference_id,
    amount_ngn,
    awarded_by,
    description,
  });
}

/**
 * On a paid order: the flat "complete a purchase" award + the per-₦ "money
 * spent" award, then advance the monthly-purchase streak. Idempotent per order.
 */
async function earnForOrder({ brand, contact_id, order_id, total_ngn }) {
  if (!contact_id) return;
  await transaction(async (client) => {
    // Check order lines to determine eligible wig value vs retail lines
    const { rows: lines } = await client.query(
      `SELECT sol.line_total_ngn, sol.line_kind, p.catalogue_role
         FROM ${brand}.sales_order_lines sol
         LEFT JOIN ${brand}.product_variants pv ON pv.variant_id = sol.variant_id
         LEFT JOIN ${brand}.products p ON p.product_id = COALESCE(sol.product_id, pv.product_id)
        WHERE sol.order_id = $1`,
      [order_id],
    );
    const wigLines = lines.filter(
      (l) =>
        l.line_kind !== "service" && l.catalogue_role !== "retail",
    );
    if (!wigLines.length) {
      // Retail-only order: zero loyalty/crowns, no purchase streak advance
      return;
    }
    const wigTotal = wigLines.reduce(
      (s, l) => Number(s) + Number(l.line_total_ngn || 0),
      0,
    );
    const reportedTotal = Number(total_ngn);
    const eligibleAmount = Number.isFinite(reportedTotal)
      ? Math.min(wigTotal, reportedTotal)
      : wigTotal;

    await awardForAction({
      client,
      brand,
      contact_id,
      action_type: "complete_purchase",
      reference_type: "sales_order",
      reference_id: order_id,
    });
    await awardForAction({
      client,
      brand,
      contact_id,
      action_type: "money_spent",
      reference_type: "sales_order",
      reference_id: order_id,
      amount_ngn: eligibleAmount,
    });
    await streak.recordQualifyingAction({
      client,
      brand,
      contact_id,
      qualifying_action: "purchase",
      occurred_at: new Date(),
    });
  });
}

/** Mint the one-time vouchers for every tier newly crossed by an earn. */
async function issuePromotionGrants({
  client,
  brand,
  contact_id,
  oldLifetime,
  newLifetime,
}) {
  if (newLifetime <= oldLifetime) return;
  const tiers = await repo.listTiers({ client, brand });
  const crossed = tiers.filter(
    (ti) => ti.min_crowns > oldLifetime && ti.min_crowns <= newLifetime,
  );
  for (const tier of crossed) {
    const expires = new Date(
      Date.now() + DEFAULT_VOUCHER_EXPIRY_DAYS * 86400000,
    );
    if (Number(tier.next_purchase_discount_pct) > 0) {
      const dup = await repo.grantExistsForTier({
        client,
        brand,
        contact_id,
        tier_id: tier.tier_id,
        grant_type: "next_purchase_discount",
      });
      if (!dup) {
        await repo.insertGrant({
          client,
          brand,
          grant: {
            contact_id,
            source_type: "tier_promotion",
            tier_id: tier.tier_id,
            grant_type: "next_purchase_discount",
            discount_pct: tier.next_purchase_discount_pct,
            expires_at: expires,
            notes: `${tier.tier_name} promotion reward`,
          },
        });
      }
    }
    if (tier.grants_free_shipping_next) {
      const dup = await repo.grantExistsForTier({
        client,
        brand,
        contact_id,
        tier_id: tier.tier_id,
        grant_type: "free_shipping_next",
      });
      if (!dup) {
        await repo.insertGrant({
          client,
          brand,
          grant: {
            contact_id,
            source_type: "tier_promotion",
            tier_id: tier.tier_id,
            grant_type: "free_shipping_next",
            expires_at: expires,
            notes: `${tier.tier_name} free shipping`,
          },
        });
      }
    }
    events.emit("crown.tier_promoted", {
      brand,
      contact_id,
      tier_key: tier.tier_key,
      tier_name: tier.tier_name,
    });
  }
}

// ── Verification queue (honor / manual actions) ────────────
/**
 * A customer self-reports a social action. `honor` rules auto-approve and award
 * on the spot; `manual` rules queue for staff review. Enforces the rule's caps
 * against prior submissions so the honor path can't be farmed.
 */
async function submitAction({
  brand,
  contact_id,
  rule_key,
  social_handle,
  proof_url,
  media_asset_id,
  note,
}) {
  return transaction(async (client) => {
    const rule = await repo.getRuleByKey({ client, brand, rule_key });
    if (!rule || !rule.is_active) throw new NotFoundError("Crown earn rule");
    if (rule.verification_mode === "auto") {
      throw new AppError(
        "CROWN_AUTO_ACTION",
        "Auto-verified action submitted manually",
        400,
        {
          user_message:
            "This action is awarded automatically — no submission needed.",
        },
      );
    }
    if (rule.verification_mode === "manual" && !proof_url && !media_asset_id) {
      throw new AppError(
        "CROWN_PROOF_REQUIRED",
        "Manual action requires proof",
        400,
        { user_message: "Please attach a link or photo as proof." },
      );
    }

    // Cap the submission rate (covers pending + already-awarded).
    const cap =
      rule.max_awards_per_customer_lifetime ??
      rule.max_awards_per_customer_per_month ??
      rule.max_awards_per_customer_per_year ??
      null;
    if (cap) {
      const interval = rule.max_awards_per_customer_lifetime
        ? "100 years"
        : rule.max_awards_per_customer_per_month
          ? "1 month"
          : "1 year";
      const n = await repo.countSubmissionsInWindow({
        client,
        brand,
        contact_id,
        earn_rule_id: rule.rule_id,
        interval,
      });
      if (n >= cap) {
        throw new AppError(
          "CROWN_CAP_REACHED",
          "Earn cap reached for this rule",
          409,
          { user_message: "You've already claimed this reward." },
        );
      }
    }

    const autoApprove = rule.verification_mode === "honor";
    const submission = await repo.insertSubmission({
      client,
      brand,
      submission: {
        contact_id,
        earn_rule_id: rule.rule_id,
        action_type: rule.action_type,
        verification_mode: rule.verification_mode,
        social_platform: rule.social_platform,
        social_handle,
        proof_url,
        media_asset_id,
        note,
        status: autoApprove ? "auto_approved" : "pending",
      },
    });

    // Manual proof enters the queue → alert staff (in-app notification).
    if (!autoApprove) {
      events.emit("crown.submission_pending", {
        brand,
        contact_id,
        submission_id: submission.submission_id,
        action_type: rule.action_type,
      });
    }

    if (autoApprove) {
      const entry = await awardByRule({
        client,
        brand,
        contact_id,
        rule,
        reference_type: "crown_submission",
        reference_id: submission.submission_id,
      });
      await repo.reviewSubmission({
        client,
        brand,
        submission_id: submission.submission_id,
        patch: {
          status: "auto_approved",
          crowns_awarded: entry ? entry.crowns : 0,
          ledger_id: entry ? entry.ledger_id : null,
        },
      });
    }
    return submission;
  });
}

const listPendingSubmissions = ({ brand, limit, offset }) =>
  repo.listPendingSubmissions({ brand, limit, offset });

/** Staff approves / rejects a queued (manual) submission. */
async function reviewSubmission({
  brand,
  user,
  request_id,
  submission_id,
  decision,
  review_note,
}) {
  return transaction(async (client) => {
    const sub = await repo.getSubmission({ client, brand, submission_id });
    if (!sub) throw new NotFoundError("Submission");
    if (sub.status !== "pending") {
      throw new AppError(
        "CROWN_ALREADY_REVIEWED",
        "Submission already reviewed",
        409,
        { user_message: "This submission was already reviewed." },
      );
    }

    let entry = null;
    if (decision === "approve") {
      const rules = await repo.listRules({
        client,
        brand,
        action_type: sub.action_type,
      });
      const resolved =
        rules.find((r) => r.rule_id === sub.earn_rule_id) ||
        rules.find((r) => r.social_platform === sub.social_platform) ||
        rules[0];
      entry = await awardByRule({
        client,
        brand,
        contact_id: sub.contact_id,
        rule: resolved,
        reference_type: "crown_submission",
        reference_id: sub.submission_id,
        awarded_by: user.user_id,
      });
    }

    const updated = await repo.reviewSubmission({
      client,
      brand,
      submission_id,
      patch: {
        status: decision === "approve" ? "approved" : "rejected",
        reviewed_by: user.user_id,
        review_note,
        crowns_awarded: entry ? entry.crowns : 0,
        ledger_id: entry ? entry.ledger_id : null,
      },
    });

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: `retention.crown.submission_${decision}`,
      target_type: "crown_action_submission",
      target_id: submission_id,
      after: { decision, crowns: entry ? entry.crowns : 0 },
      request_id,
    });
    return updated;
  });
}

// ── Manual adjustment (staff, `approve` permission) ────────
async function adjust({
  brand,
  user,
  request_id,
  contact_id,
  crowns,
  note,
}) {
  if (!Number.isInteger(crowns) || crowns === 0) {
    throw new AppError(
      "CROWN_BAD_ADJUST",
      "Adjustment must be a non-zero integer",
      400,
      { user_message: "Adjustment must be a non-zero whole number of Crowns." },
    );
  }
  return transaction(async (client) => {
    const before = await repo.getState({ client, brand, contact_id });
    const oldLifetime = before ? before.lifetime_earned : 0;
    const entry = await repo.insertLedger({
      client,
      brand,
      entry: {
        contact_id,
        transaction_type: crowns > 0 ? "adjust_credit" : "adjust_debit",
        crowns,
        earn_action_type: "manual",
        reference_type: "manual",
        description: note || "Manual Crown adjustment",
        awarded_by: user.user_id,
      },
    });
    // A positive adjustment can promote; a debit never demotes tier standing.
    if (crowns > 0) {
      await issuePromotionGrants({
        client,
        brand,
        contact_id,
        oldLifetime,
        newLifetime: oldLifetime + crowns,
      });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "retention.crown.adjust",
      target_type: "contact",
      target_id: contact_id,
      after: { crowns, note: note || null },
      request_id,
    });
    return entry;
  });
}

// ── Tier / rule admin (thin CRUD + audit) ──────────────────
async function createTier({ brand, user, request_id, input }) {
  const tier = await repo.createTier({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.crown.tier_create",
    target_type: "crown_tier",
    target_id: tier.tier_id,
    after: { tier_key: tier.tier_key },
    request_id,
  });
  return tier;
}

async function createRule({ brand, user, request_id, input }) {
  const rule = await repo.createRule({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.crown.rule_create",
    target_type: "crown_earn_rule",
    target_id: rule.rule_id,
    after: { rule_key: rule.rule_key },
    request_id,
  });
  return rule;
}

async function updateTier({ brand, user, request_id, id, patch }) {
  const tier = await repo.updateTier({ brand, id, patch });
  if (!tier) throw new NotFoundError("Crown tier");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.crown.tier_update",
    target_type: "crown_tier",
    target_id: id,
    after: patch,
    request_id,
  });
  return tier;
}

async function updateRule({ brand, user, request_id, id, patch }) {
  const rule = await repo.updateRule({ brand, id, patch });
  if (!rule) throw new NotFoundError("Crown earn rule");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "retention.crown.rule_update",
    target_type: "crown_earn_rule",
    target_id: id,
    after: patch,
    request_id,
  });
  return rule;
}

module.exports = {
  // reads
  listTiers,
  listRules,
  listStreakConfig,
  listAtRiskStreaks,
  getWallet,
  getActiveDiscount,
  // earn
  awardByRule,
  awardForAction,
  earnForOrder,
  issuePromotionGrants,
  // verification queue
  submitAction,
  listPendingSubmissions,
  reviewSubmission,
  // adjust + admin
  adjust,
  createTier,
  updateTier,
  createRule,
  updateRule,
};
