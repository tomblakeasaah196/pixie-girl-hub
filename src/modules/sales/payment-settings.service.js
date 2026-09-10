/**
 * Flexi Pay payment-plan settings (V2.2 §6.2 — owner session 2026-07-10).
 *
 * SINGLE SOURCE OF TRUTH for every partial-payment policy number and copy
 * string. Everything here is configuration, not code: the Sales → Payments
 * admin tab (PR-3) edits it, every checkout and the public pay page read it.
 * Stored in shared.business_config.installment_settings (JSONB, per brand)
 * plus the allow_staff_recorded_manual_payments column.
 *
 * Plan semantics (D1):
 *   payment_plan 'full'       — buyer pays the whole total now
 *   payment_plan 'instalment' — buyer opted into the flexible plan
 *     · minimum FIRST payment = min_first_payment_pct of the order total
 *     · top-ups ≥ min_topup_ngn (the exact balance is always allowed)
 *     · custom orders: production unlocks at custom_order_deposit_pct
 */

"use strict";

const businessConfig = require("../business_setup/business-config.repo");
const businessSetupRepo = require("../business_setup/business-setup.repo");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { AppError } = require("../../utils/errors");

// Mirrors migrations/000315_shared_flexi_pay.sql — the migration writes these
// under existing rows; this constant is the belt-and-braces fallback for any
// key an operator later deletes from the JSON.
const DEFAULTS = Object.freeze({
  plan_display_name: "Flexi Pay",
  plan_terms: [
    "Your items are reserved for you the moment you pay your first instalment.",
    "Pay at your own pace — any amount, anytime, using your personal payment link.",
    "Your order ships as soon as it is fully paid.",
    "If we receive no payment for 60 days the order is cancelled and the reservation is released.",
  ],
  min_first_payment_pct: 30,
  min_topup_ngn: 1000,
  custom_order_deposit_pct: 50,
  default_deposit_pct_for_deposit_triggered: 50,
  layaway_abandonment_days: 60,
  layaway_reminder_cadence_days: 7,
  auto_cancel_after_no_payment: true,
  abandoned_checkout_nudge_enabled: true,
  abandoned_checkout_nudge_hours: 2,
  abandoned_checkout_expiry_hours: 24,
  milestone_messages_enabled: true,
  channels: {
    storefront: true,
    public_form: true,
    whatsapp: true,
    instagram: true,
    walk_in: true,
    event: true,
    sales_campaign: true,
  },
});

/** Merge stored settings over the defaults (stored values win). */
function withDefaults(stored) {
  const s = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULTS,
    ...s,
    channels: { ...DEFAULTS.channels, ...(s.channels || {}) },
    plan_terms: Array.isArray(s.plan_terms)
      ? s.plan_terms
      : DEFAULTS.plan_terms,
  };
}

/** Full settings for a brand (admin shape — includes the manual-payment toggle). */
async function getSettings(brand) {
  const cfg = await businessConfig.findByKey(brand);
  if (!cfg)
    throw new AppError(
      "BUSINESS_CONFIG_MISSING",
      `No config for ${brand}`,
      500,
    );
  return {
    ...withDefaults(cfg.installment_settings),
    allow_staff_recorded_manual_payments:
      cfg.allow_staff_recorded_manual_payments === true,
  };
}

/**
 * Patch settings (admin PUT). Shallow-merges the patch into the stored JSON
 * (channels merged key-wise); allow_staff_recorded_manual_payments routes to
 * its own column. Audited.
 */
async function updateSettings({ brand, user, request_id, patch }) {
  const cfg = await businessConfig.findByKey(brand);
  if (!cfg)
    throw new AppError(
      "BUSINESS_CONFIG_MISSING",
      `No config for ${brand}`,
      500,
    );
  const before = await getSettings(brand);

  const { allow_staff_recorded_manual_payments, ...planPatch } = patch;
  const stored = cfg.installment_settings || {};
  const next = {
    ...stored,
    ...planPatch,
    ...(planPatch.channels
      ? { channels: { ...(stored.channels || {}), ...planPatch.channels } }
      : {}),
  };

  const repoPatch = { installment_settings: next };
  if (allow_staff_recorded_manual_payments !== undefined) {
    repoPatch.allow_staff_recorded_manual_payments =
      allow_staff_recorded_manual_payments;
  }
  await businessSetupRepo.updateConfig({ brand, patch: repoPatch });

  const after = await getSettings(brand);
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales.payment_settings.update",
    target_type: "business_config",
    target_id: cfg.config_id,
    before,
    after,
    request_id,
  });
  return after;
}

/**
 * Checkout-safe public shape for a channel: is the instalment plan offered
 * here, under what name/terms, and what are the minimums. Never exposes
 * internal toggles. `campaign` (when the channel is sales_campaign) must also
 * carry allow_instalments for the plan to show.
 *
 * Also carries `gateways` — the brand's ACTIVE NGN gateway chain, provider
 * names only (never credentials) — so public checkout pages (order-link /o
 * page, storefront) can render a "pay with" picker limited to gateways that
 * are actually configured. Order matches the server's fallback preference.
 */
async function publicConfig({ brand, channel, campaign = null }) {
  const s = await getSettings(brand);
  let enabled = s.channels[channel] !== false;
  if (channel === "sales_campaign") {
    enabled = enabled && !!(campaign && campaign.allow_instalments === true);
  }
  let gateways = [];
  try {
    const gatewaysService = require("../business_setup/payment-gateways.service");
    const chain = await gatewaysService.getActiveChain({
      brand,
      currency: "NGN",
    });
    // Buyer-pickable rails only (matches the storefront checkout + the
    // order-form's payment_gateway allowlist). Stripe stays a server-side
    // automatic last-resort, never a buyer-facing pick.
    gateways = chain
      .map((g) => g.provider)
      .filter((p) => p === "nomba" || p === "paystack");
  } catch {
    gateways = []; // picker hides; the server default (Nomba-first) applies
  }
  return {
    instalments_enabled: enabled,
    plan_display_name: s.plan_display_name,
    plan_terms: s.plan_terms,
    min_first_payment_pct: Number(s.min_first_payment_pct),
    min_topup_ngn: Number(s.min_topup_ngn),
    custom_order_deposit_pct: Number(s.custom_order_deposit_pct),
    gateways,
  };
}

/** ₦ minimum first payment for an instalment order of this total. */
function minFirstPaymentNgn(settings, totalNgn) {
  const pct = money(settings.min_first_payment_pct || 0);
  return money(totalNgn).times(pct).dividedBy(100);
}

/**
 * The minimum acceptable NEXT payment on an order, given what's already paid.
 * The exact outstanding balance is always acceptable (you can always finish).
 * Returns a Decimal.
 */
function minNextPaymentNgn(settings, order) {
  const total = money(order.total_ngn);
  const paid = money(order.amount_paid_ngn || 0);
  const outstanding = total.minus(paid);
  if (outstanding.lte(0)) return money(0);
  let floor;
  if (order.payment_plan === "instalment" && paid.lte(0)) {
    // First payment: prefer the deposit snapshot LOCKED on the order at
    // placement (required_deposit_ngn) — a later config change never moves
    // the goalposts on an existing plan. Fall back to live config for
    // legacy orders that predate the snapshot.
    floor =
      order.required_deposit_ngn !== null &&
      order.required_deposit_ngn !== undefined
        ? money(order.required_deposit_ngn)
        : minFirstPaymentNgn(settings, total);
  } else {
    floor = money(settings.min_topup_ngn || 0);
  }
  // Never demand more than what's left.
  return floor.gt(outstanding) ? outstanding : floor;
}

/**
 * Validate a requested payment amount against policy. Throws AppError with a
 * buyer-readable message when below the floor. Full-plan orders are exempt —
 * their checkout always initialises at the full balance, and any later
 * shortfall top-up is staff-driven.
 */
function assertPaymentAmountAllowed({ settings, order, amountNgn }) {
  if (order.payment_plan !== "instalment") return;
  const min = minNextPaymentNgn(settings, order);
  if (money(amountNgn).lt(min)) {
    throw new AppError(
      "PAYMENT_BELOW_MINIMUM",
      `Payment below the plan minimum (${toCurrencyString(min)})`,
      422,
      {
        user_message: `The minimum payment on this order is ₦${toCurrencyString(min)}. You can also pay the exact balance.`,
        metadata: { min_ngn: toCurrencyString(min) },
      },
    );
  }
}

module.exports = {
  DEFAULTS,
  getSettings,
  updateSettings,
  publicConfig,
  minFirstPaymentNgn,
  minNextPaymentNgn,
  assertPaymentAmountAllowed,
  withDefaults,
};
