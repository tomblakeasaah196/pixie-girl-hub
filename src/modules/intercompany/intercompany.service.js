/**
 * Inter-Company Transactions (V2.2 §5.1) — business logic.
 *
 * Records a cross-brand trade (styling / wholesale / expense recharge / asset
 * transfer) and posts the MIRRORED journals in both brand ledgers:
 *   seller brand: DR 1210 Inter-Company Receivable / CR 4050 Inter-Company Sales
 *   buyer  brand: DR 5060 Inter-Company COGS       / CR 2010 Inter-Company Payable
 * Then buyer match → settle. GL posting per brand is best-effort: a failure in
 * one brand is logged + flagged as a reconciliation discrepancy rather than
 * losing the trade record (the recon sweep / finance resolves it).
 */

"use strict";

const crypto = require("crypto");
const repo = require("./intercompany.repo");
const events = require("./intercompany.events");
const accounting = require("../accounting/accounting.service");
const { isValidBrand } = require("../../config/brands");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const IC_RECEIVABLE = "1210";
const IC_SALES = "4050";
const IC_COGS = "5060";
const IC_PAYABLE = "2010";

function list(args) {
  return repo.list(args);
}
async function getById({ id }) {
  const txn = await repo.findById({ id });
  if (!txn) throw new NotFoundError("Intercompany transaction");
  const reconciliations = await repo.listReconciliations({
    ic_transaction_id: id,
  });
  return { ...txn, reconciliations };
}

async function postBrandJournal({ brand, ic, lines }) {
  return accounting.postEntry({
    brand,
    user_id: ic.posted_by,
    entry: {
      source_type: "intercompany",
      source_table: "shared.intercompany_transactions",
      source_id: ic.ic_transaction_id,
      reference: ic.ic_number,
      description: ic.description,
    },
    lines,
  });
}

async function recordTransaction({ user, request_id, input }) {
  if (!isValidBrand(input.seller_brand) || !isValidBrand(input.buyer_brand))
    throw new AppError("INVALID_BRAND", "Unknown seller or buyer brand", 422);
  if (input.seller_brand === input.buyer_brand)
    throw new AppError(
      "SAME_BRAND",
      "seller_brand and buyer_brand must differ",
      422,
    );

  const fx = input.fx_rate_used || 1;
  const amountNgn =
    input.amount_ngn === undefined || input.amount_ngn === null
      ? money(input.amount).times(money(fx))
      : money(input.amount_ngn);
  const ic_number = `IC-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

  const ic = await repo.create({
    row: {
      ic_number,
      flow_type: input.flow_type,
      seller_brand: input.seller_brand,
      buyer_brand: input.buyer_brand,
      currency: input.currency || "NGN",
      amount: input.amount,
      amount_ngn: toCurrencyString(amountNgn),
      fx_rate_used: fx,
      min_margin_floor_pct: input.min_margin_floor_pct,
      seller_doc_type: input.seller_doc_type || "invoice",
      seller_doc_id: input.seller_doc_id,
      seller_doc_number: input.seller_doc_number,
      status: "pending_buyer",
      reference_type: input.reference_type || null,
      reference_id: input.reference_id || null,
      description: input.description,
      posted_by: user.user_id,
    },
  });

  const amt = toCurrencyString(amountNgn);
  // Mirrored GL — each brand posts in its own ledger/transaction.
  try {
    await postBrandJournal({
      brand: ic.seller_brand,
      ic,
      lines: [
        {
          account_code: IC_RECEIVABLE,
          debit_ngn: amt,
          description: `IC sale ${ic.ic_number}`,
        },
        {
          account_code: IC_SALES,
          credit_ngn: amt,
          description: `IC sale ${ic.ic_number}`,
        },
      ],
    });
  } catch (err) {
    logger.error({ err: err.message, ic_number }, "IC seller journal failed");
    await repo.createReconciliation({
      recon: {
        ic_transaction_id: ic.ic_transaction_id,
        discrepancy_type: "status_mismatch",
        notes: `Seller (${ic.seller_brand}) GL post failed: ${err.message}`,
      },
    });
  }
  try {
    await postBrandJournal({
      brand: ic.buyer_brand,
      ic,
      lines: [
        {
          account_code: IC_COGS,
          debit_ngn: amt,
          description: `IC purchase ${ic.ic_number}`,
        },
        {
          account_code: IC_PAYABLE,
          credit_ngn: amt,
          description: `IC purchase ${ic.ic_number}`,
        },
      ],
    });
  } catch (err) {
    logger.error({ err: err.message, ic_number }, "IC buyer journal failed");
    await repo.createReconciliation({
      recon: {
        ic_transaction_id: ic.ic_transaction_id,
        discrepancy_type: "status_mismatch",
        notes: `Buyer (${ic.buyer_brand}) GL post failed: ${err.message}`,
      },
    });
  }

  await audit({
    business: ic.seller_brand,
    user_id: user.user_id,
    action_key: "intercompany.record",
    target_type: "intercompany_transaction",
    target_id: ic.ic_transaction_id,
    after: { ic_number, amount_ngn: amt },
    request_id,
  });
  events.emit("recorded", {
    ic_transaction_id: ic.ic_transaction_id,
    seller_brand: ic.seller_brand,
    buyer_brand: ic.buyer_brand,
  });
  return getById({ id: ic.ic_transaction_id });
}

async function matchTransaction({ user, request_id, id }) {
  const txn = await repo.findById({ id });
  if (!txn) throw new NotFoundError("Intercompany transaction");
  if (txn.status !== "pending_buyer")
    throw new AppError(
      "INVALID_STATE",
      `Cannot match a '${txn.status}' txn`,
      409,
    );
  const updated = await repo.setStatus({
    id,
    status: "matched",
    fields: { matched_by: user.user_id },
  });
  await audit({
    business: txn.buyer_brand,
    user_id: user.user_id,
    action_key: "intercompany.match",
    target_type: "intercompany_transaction",
    target_id: id,
    request_id,
  });
  // GAP-6: when buyer matches (confirms receipt), receive stock into buyer's ledger
  if (txn.reference_type === "product_variant" && txn.reference_id) {
    try {
      const stockService = require("../stock/stock.service");
      const stockRepo = require("../stock/stock.repo");
      const loc = await stockRepo.getDefaultLocation({ brand: txn.buyer_brand });
      if (loc) {
        await stockService.receiveStock({
          client: null,
          brand: txn.buyer_brand,
          variant_id: txn.reference_id,
          location_id: loc.location_id,
          quantity: 1,
          reference_id: id,
          reference_type: "intercompany",
          unit_cost_ngn: txn.amount_ngn,
          user_id: user.user_id,
        });
      }
    } catch (err) {
      logger.warn({ err, ic_transaction_id: id }, "IC stock reception skipped");
    }
  }
  events.emit("matched", { ic_transaction_id: id });
  return updated;
}

async function settleTransaction({ user, request_id, id }) {
  const txn = await repo.findById({ id });
  if (!txn) throw new NotFoundError("Intercompany transaction");
  if (!["matched", "pending_buyer"].includes(txn.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot settle a '${txn.status}' txn`,
      409,
    );
  const updated = await repo.setStatus({ id, status: "settled" });
  await audit({
    business: txn.seller_brand,
    user_id: user.user_id,
    action_key: "intercompany.settle",
    target_type: "intercompany_transaction",
    target_id: id,
    request_id,
  });
  events.emit("settled", { ic_transaction_id: id });
  return updated;
}

async function openReconciliation({ user, request_id, id, input }) {
  const txn = await repo.findById({ id });
  if (!txn) throw new NotFoundError("Intercompany transaction");
  const recon = await repo.createReconciliation({
    recon: {
      ic_transaction_id: id,
      discrepancy_type: input.discrepancy_type,
      notes: input.notes,
    },
  });
  await audit({
    business: txn.seller_brand,
    user_id: user.user_id,
    action_key: "intercompany.reconciliation.open",
    target_type: "intercompany_transaction",
    target_id: id,
    request_id,
  });
  return recon;
}

module.exports = {
  list,
  getById,
  recordTransaction,
  matchTransaction,
  settleTransaction,
  openReconciliation,
};
