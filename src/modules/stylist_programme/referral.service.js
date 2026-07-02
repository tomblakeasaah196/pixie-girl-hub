/**
 * Stylist Partner Programme (V2.2 §6.26) — two-way earnings, referral side (Q17).
 *
 * A partner shares a tracked link (/api/public/stylist-programme/r/:code →
 * storefront with ?ref=). Checkout / the public order form validate the code
 * and stamp sales_orders.stylist_referral_code (template 000075 — distinct
 * from the CUSTOMER referral rail's referral_code_used). On the durable
 * `order.paid` outbox event this module accrues the commission; it turns
 * payable after the same quality-hold window as service work, then rides the
 * normal payout batch as a 'referral' line.
 */

"use strict";

const crypto = require("crypto");
const repo = require("./stylist.repo");
const programmeRepo = require("./programme.repo");
const notify = require("./stylist.notify");
const events = require("./stylist.events");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

// ── Links ─────────────────────────────────────────────────
async function createLink({ stylist_id, business, input }) {
  const partner = await repo.findPartner({ id: stylist_id });
  if (!partner) throw new NotFoundError("Stylist");
  if (!["certified", "vetted"].includes(partner.status))
    throw new AppError(
      "NOT_ACTIVE",
      "Referral links are available to vetted and certified partners",
      422,
    );
  const code = `${partner.referral_code}-${crypto.randomBytes(2).toString("hex")}`;
  return programmeRepo.createReferralLink({
    l: {
      stylist_id,
      business,
      code,
      label: input.label,
      target_path: input.target_path,
    },
  });
}

async function listLinks({ stylist_id }) {
  return programmeRepo.listReferralLinks({ stylist_id });
}

/** Public redirect target for /r/:code — counts the click. */
async function resolveRedirect({ code }) {
  const hit = await programmeRepo.resolveReferralCode({ code });
  if (!hit) return null;
  if (hit.link_id)
    programmeRepo.bumpReferralClicks({ link_id: hit.link_id }).catch(() => {});
  const links = hit.link_id
    ? await programmeRepo.listReferralLinks({ stylist_id: hit.stylist_id })
    : [];
  const link = links.find((l) => l.link_id === hit.link_id);
  return {
    code: hit.link_code || code,
    target_path: (link && link.target_path) || "/",
  };
}

/** Checkout-side validation: does this code belong to an active partner? */
async function validateCode({ code }) {
  if (!code) return null;
  const hit = await programmeRepo.resolveReferralCode({ code });
  return hit ? { stylist_id: hit.stylist_id, code } : null;
}

// ── Accrual (order.paid outbox consumer body) ─────────────
async function accrueForPaidOrder({ brand, order_id }) {
  const order = await programmeRepo.findOrderReferralCode({
    brand,
    order_id,
  });
  if (!order || !order.stylist_referral_code) return null;
  const hit = await programmeRepo.resolveReferralCode({
    code: order.stylist_referral_code,
  });
  if (!hit) {
    logger.warn(
      { brand, order_id, code: order.stylist_referral_code },
      "stylist referral: paid order carries an unresolvable code",
    );
    return null;
  }
  const cfg = await programmeRepo.getConfig({ business: brand });
  const pct = money(
    hit.referral_commission_pct ?? (cfg ? cfg.referral_commission_pct : 10),
  );
  const total = money(order.total_ngn || 0);
  const commission = total.times(pct).dividedBy(100);
  const holdDays = cfg ? Number(cfg.quality_hold_days || 7) : 7;

  const attribution = await programmeRepo.createAttribution({
    a: {
      stylist_id: hit.stylist_id,
      business: brand,
      referral_code: order.stylist_referral_code,
      order_id,
      order_number: order.order_number,
      order_total_ngn: toCurrencyString(total),
      commission_pct: toCurrencyString(pct),
      commission_amount_ngn: toCurrencyString(commission),
      currency: "NGN",
      payable_at: new Date(Date.now() + holdDays * 86_400_000).toISOString(),
    },
  });
  if (!attribution) return null; // idempotent replay — already attributed

  await audit({
    business: brand,
    user_id: null,
    action_key: "stylist.referral.accrue",
    target_type: "stylist_referral_attribution",
    target_id: attribution.attribution_id,
    after: {
      order_id,
      commission_ngn: attribution.commission_amount_ngn,
    },
  });
  events.emit("referral.accrued", {
    stylist_id: hit.stylist_id,
    attribution_id: attribution.attribution_id,
    order_id,
  });
  await notify.notifyStylist({
    stylist_id: hit.stylist_id,
    type: "referral",
    title: "Referral sale attributed",
    body: `Order ${order.order_number || ""} was placed through your link — ₦${attribution.commission_amount_ngn} commission accrued.`,
    data: { attribution_id: attribution.attribution_id },
  });
  return attribution;
}

// ── Reporting ─────────────────────────────────────────────
async function listAttributions(args) {
  return programmeRepo.listAttributions(args);
}

async function summary({ stylist_id }) {
  const rows = await programmeRepo.listAttributions({ stylist_id });
  const sum = (status) =>
    toCurrencyString(
      rows
        .filter((r) => r.status === status)
        .reduce((s, r) => s.plus(money(r.commission_amount_ngn)), money(0)),
    );
  return {
    links: await programmeRepo.listReferralLinks({ stylist_id }),
    attributions: rows,
    totals: {
      pending_ngn: sum("pending"),
      payable_ngn: sum("payable"),
      paid_ngn: sum("paid"),
      orders: rows.length,
    },
  };
}

module.exports = {
  createLink,
  listLinks,
  resolveRedirect,
  validateCode,
  accrueForPaidOrder,
  listAttributions,
  summary,
};
