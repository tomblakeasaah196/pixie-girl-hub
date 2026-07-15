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
  const candidates = await salesRepo.findReconcilablePosOrders({
    brand: targetBrand,
    amount_ngn: row.amount_ngn,
    since,
    until,
  });
  return { data: candidates, recon: row };
}

// ── Actions ─────────────────────────────────────────────────

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
  await webhooksService.recordGatewayPayment({
    brand,
    order_id,
    reference: row.provider_reference || `pos-recon:${row.recon_id}`,
    amount_ngn: row.amount_ngn,
    method: "nomba_terminal",
    provider: "nomba",
    webhook_id: row.webhook_id,
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
    after: { order_id, amount_ngn: row.amount_ngn },
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
async function notifyNewPending({ recon_id, business, amount_ngn }) {
  const recipients = await repo.listNotifyRecipients({ brand: business || null });
  const amountDisplay = `₦${Number(amount_ngn).toLocaleString("en-NG", {
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
            ? "Unmatched POS payment"
            : "Unmatched POS payment — brand unknown",
          body: `${amountDisplay} came in from a terminal with no matching order. It's waiting in POS Reconciliation.`,
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
