/**
 * POS terminal-payment reconciliation — business logic (Sales → POS
 * Reconciliation tab).
 *
 * A Nomba terminal payment that arrives with no usable order reference gets
 * parked by the webhook handler (business_setup/webhooks.service.js) instead
 * of retrying forever. This service is the staff-facing worklist: suggest
 * candidate orders, confirm a match (which pays the order through the same
 * path a gateway webhook would), or ignore a false positive/duplicate.
 */

"use strict";

const repo = require("./pos.repo");
const events = require("./pos.events");
const salesRepo = require("../sales/sales.repo");
const { audit } = require("../../middleware/audit");
const notifications = require("../../services/notifications.service");
const paidCurrency = require("../sales/paid-currency");
const { NotFoundError, AppError } = require("../../utils/errors");
const { VALID_BRANDS } = require("../../config/brands");
const { logger } = require("../../config/logger");

// Smart-suggestion window around the payment's timestamp (decision 1A).
const SUGGEST_WINDOW_HOURS = 48;

async function load(id) {
  const row = await repo.findById({ recon_id: id });
  if (!row) throw new NotFoundError("PosTerminalReconciliation");
  return row;
}

/**
 * The unresolved-brand queue (decision 2A) lets a CEO name an explicit
 * `brand` for suggestions/match independent of their ambient X-Brand-Context
 * — otherwise they could never resolve an item for the brand they aren't
 * currently viewing. But that same explicit param would let a non-CEO user
 * pass a brand their role isn't granted, bypassing the check
 * brandContextMiddleware normally does on the header. Mirror that check here.
 */
function assertBrandAccess(user, brand) {
  if (user.is_ceo) return;
  const allowed = Array.isArray(user.available_businesses)
    ? user.available_businesses
    : [];
  if (!allowed.includes(brand)) {
    throw new AppError("BRAND_ACCESS_DENIED", `No access to ${brand}`, 403);
  }
}

// ── Reads ───────────────────────────────────────────────────

function listPending({ brand, page, page_size }) {
  return repo.listPending({ brand, page, page_size });
}

/** Cross-brand queue for payments with no resolved terminal brand yet —
 * CEO-only (decision 2A: there's no cross-entity "ALL" view in the business
 * switcher today, so this gates on the CEO role directly instead). */
function listUnresolved({ user, page, page_size }) {
  if (!user.is_ceo) {
    throw new AppError("PERMISSION_DENIED", "CEO only", 403);
  }
  return repo.listUnresolved({ page, page_size });
}

async function getById({ id }) {
  return load(id);
}

/**
 * Smart-suggestion candidates: open in-store orders in the target brand with
 * the same outstanding balance, within a time window around the payment.
 * Never auto-applies (mirrors sales.repo.js's own doc comment on the
 * underlying query) — staff always confirms the match explicitly.
 */
async function suggestions({ id, brand, user }) {
  const row = await load(id);
  const targetBrand = brand || row.resolved_brand;
  if (!targetBrand || !VALID_BRANDS.has(targetBrand)) {
    throw new AppError(
      "BRAND_REQUIRED",
      "This payment's brand isn't known yet — pick a brand to search its orders",
      422,
    );
  }
  assertBrandAccess(user, targetBrand);
  let since = null;
  let until = null;
  if (row.transaction_time) {
    const ms = new Date(row.transaction_time).getTime();
    since = new Date(ms - SUGGEST_WINDOW_HOURS * 3600 * 1000).toISOString();
    until = new Date(ms + SUGGEST_WINDOW_HOURS * 3600 * 1000).toISOString();
  }
  // A USD row has no Naira figure yet — look for USD-locked orders whose
  // dollar balance is what was paid instead.
  const ccy = String(row.paid_currency || "NGN").toUpperCase();
  const foreign =
    ccy !== "NGN" && row.paid_amount !== null && row.paid_amount !== undefined;
  const candidates = await salesRepo.findReconcilablePosOrders({
    brand: targetBrand,
    amount_ngn: row.amount_ngn,
    paid_currency: foreign ? ccy : null,
    paid_amount: foreign ? row.paid_amount : null,
    since,
    until,
  });
  return { data: candidates, recon: row };
}

// ── Actions ─────────────────────────────────────────────────

/**
 * What a matched row credits. A Naira row credits its amount as an in-store
 * terminal payment (unchanged). A USD row (a Nomba dollar checkout that could
 * not be placed) is converted at the CHOSEN order's locked rate — the same
 * rule the webhook applies — and records the dollars on the payment, so it
 * lands in the USD wallet account and on a dollar receipt. Parked USD rows
 * carry amount_ngn 0 when no order was known; crediting that was rejected by
 * the payments CHECK, and crediting a guessed Naira figure lost the dollars.
 */
async function matchedPaymentFigures({ row, brand, order_id }) {
  const ccy = String(row.paid_currency || "NGN").toUpperCase();
  if (ccy === "NGN" || row.paid_amount === null || row.paid_amount === undefined)
    return { amount_ngn: row.amount_ngn, method: "nomba_terminal" };

  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) throw new NotFoundError("Order");
  const webhooksService = require("../business_setup/webhooks.service");
  const credit = await webhooksService.foreignCaptureCredit({
    brand,
    order,
    currency: ccy,
    paidAmount: row.paid_amount,
  });
  if (credit.park)
    throw new AppError("CANNOT_MATCH", credit.park, 409, {
      user_message: credit.park,
    });
  return {
    amount_ngn: credit.amount_ngn,
    method: "nomba_online",
    paid_currency: ccy,
    paid_amount: row.paid_amount,
    fx_rate_used: Number(credit.fx_rate).toFixed(6),
  };
}

/**
 * Match a pending payment to an order (decision 1A: staff picks from
 * suggestions or a manual search — both land here the same way) and
 * auto-confirm the order's payment (decision 3A) through the exact
 * idempotent, fee-aware path a gateway webhook uses.
 */
async function match({ id, brand, order_id, user, request_id }) {
  const row = await load(id);
  if (row.status !== "pending") {
    throw new AppError("INVALID_STATE", `Already ${row.status}`, 409);
  }
  if (!VALID_BRANDS.has(brand)) {
    throw new AppError("INVALID_BRAND", "Unknown brand", 422);
  }
  assertBrandAccess(user, brand);

  // Lazy require: avoids a require cycle at module load (webhooks.service.js
  // requires ./pos.repo directly for the fallback that creates these rows).
  const webhooksService = require("../business_setup/webhooks.service");
  const payment = await matchedPaymentFigures({ row, brand, order_id });
  await webhooksService.recordGatewayPayment({
    brand,
    order_id,
    reference: row.provider_reference || `pos-recon:${row.recon_id}`,
    ...payment,
    provider: "nomba",
    webhook_id: row.webhook_id,
    // A person decided this payment belongs to this order — name them on the
    // payment row, not just on the reconciliation record. Without this the
    // order's Payments ledger claimed the gateway captured it automatically,
    // hiding who actually made the call.
    recorded_by_user_id: user.user_id,
  });

  const updated = await repo.markMatched({
    recon_id: id,
    matched_brand: brand,
    matched_order_id: order_id,
    matched_by: user.user_id,
  });
  if (!updated) {
    throw new AppError(
      "INVALID_STATE",
      "Already resolved by someone else",
      409,
    );
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "pos_reconciliation.match",
    target_type: "pos_terminal_reconciliation",
    target_id: id,
    after: {
      order_id,
      amount_ngn: row.amount_ngn,
      paid_currency: row.paid_currency || null,
      paid_amount: row.paid_amount ?? null,
    },
    request_id,
  });
  events.emit("matched", {
    brand,
    recon_id: id,
    order_id,
    user_id: user.user_id,
  });
  return updated;
}

/** Ignore a false positive/duplicate — requires a short note (decision 5B). */
async function ignore({ id, note, user, request_id }) {
  const row = await load(id);
  if (row.status !== "pending") {
    throw new AppError("INVALID_STATE", `Already ${row.status}`, 409);
  }
  const updated = await repo.markIgnored({
    recon_id: id,
    note,
    ignored_by: user.user_id,
  });
  if (!updated) {
    throw new AppError(
      "INVALID_STATE",
      "Already resolved by someone else",
      409,
    );
  }

  await audit({
    business: row.resolved_brand || null,
    user_id: user.user_id,
    action_key: "pos_reconciliation.ignore",
    target_type: "pos_terminal_reconciliation",
    target_id: id,
    after: { note },
    request_id,
  });
  events.emit("ignored", {
    brand: row.resolved_brand || null,
    recon_id: id,
    user_id: user.user_id,
  });
  return updated;
}

/**
 * Active notification fan-out (decision 6B) — called by the pos.subscribers
 * "pending" handler right after a payment is parked, so staff don't have to
 * notice it in the tab on their own. Unresolved-brand items reach CEOs only
 * (repo.listNotifyRecipients narrows to is_ceo when brand is null).
 */
async function notifyNewPending({
  recon_id,
  business,
  amount_ngn,
  paid_currency = null,
  paid_amount = null,
}) {
  const recipients = await repo.listNotifyRecipients({
    brand: business || null,
  });
  // A USD row's amount_ngn is 0 or a provisional conversion — the dollars are
  // the truth, so the alert says "$249.99", not "₦0.00".
  const foreign =
    paid_currency &&
    String(paid_currency).toUpperCase() !== "NGN" &&
    paid_amount !== null &&
    paid_amount !== undefined;
  const amountDisplay = foreign
    ? paidCurrency.formatMoney(paid_amount, paid_currency)
    : `₦${Number(amount_ngn).toLocaleString("en-NG", {
        minimumFractionDigits: 2,
      })}`;
  await Promise.all(
    recipients.map((user_id) =>
      notifications
        .notify({
          user_id,
          business: business || null,
          type: "pos_reconciliation",
          priority: "high",
          title: business
            ? foreign
              ? "Unmatched Nomba payment"
              : "Unmatched POS payment"
            : foreign
              ? "Unmatched Nomba payment — brand unknown"
              : "Unmatched POS payment — brand unknown",
          body: foreign
            ? `${amountDisplay} came in through Nomba with no order it could be placed on. It's waiting in POS Reconciliation.`
            : `${amountDisplay} came in from a terminal with no matching order. It's waiting in POS Reconciliation.`,
          reference_type: "pos_terminal_reconciliation",
          reference_id: recon_id,
          action_url: "/sales?tab=pos-reconciliation",
        })
        .catch((err) =>
          logger.error(
            { err: err.message, recon_id, user_id },
            "pos_reconciliation: notify failed",
          ),
        ),
    ),
  );
}

module.exports = {
  listPending,
  listUnresolved,
  getById,
  suggestions,
  match,
  ignore,
  notifyNewPending,
};
