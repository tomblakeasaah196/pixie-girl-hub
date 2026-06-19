/**
 * Inter-Company Transactions (V2.2 §5.1) — business logic.
 *
 * Records a cross-brand trade (styling / wholesale / expense recharge / asset
 * transfer), gated behind the 'intercompany:create' CEO-approval workflow
 * (src/workflows/default-definitions.js) — record() only validates + opens
 * the approval instance; approve() does the actual mirrored posting:
 *   seller brand: DR 1210 Inter-Company Receivable / CR 4050 Inter-Company Sales
 *   buyer  brand: DR 5060 Inter-Company COGS       / CR 2010 Inter-Company Payable
 *   + (wholesale, stock-backed) seller-side stock deducted, buyer-side
 *     received on match.
 * Then buyer match → settle. GL/stock posting per brand is best-effort: a
 * failure in one brand is logged + flagged as a reconciliation discrepancy
 * rather than losing the trade record (the recon sweep / finance resolves it).
 *
 * Two integrity checks run at record() time, before a row is even created:
 *   - the seller_doc must be a REAL invoice in the seller brand's schema
 *     (previously any UUID was accepted with no existence check);
 *   - for stock-backed wholesale trades, the effective margin (sale price
 *     vs the cost-vault's true landed cost) must clear min_margin_floor_pct
 *     (previously the floor was stored but never compared against anything).
 */

"use strict";

const crypto = require("crypto");
const repo = require("./intercompany.repo");
const events = require("./intercompany.events");
const accounting = require("../accounting/accounting.service");
const invoicingRepo = require("../invoicing/invoicing.repo");
const stockService = require("../stock/stock.service");
const stockRepo = require("../stock/stock.repo");
const costVaultRepo = require("../catalogue/cost_vault.repo");
const encryption = require("../../services/encryption.service");
const { marginPct } = require("../pricing/pricing.service");
const wf = require("../../workflows/engine");
const { transaction } = require("../../config/database");
const { isValidBrand } = require("../../config/brands");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

const IC_RECEIVABLE = "1210";
const IC_SALES = "4050";
const IC_COGS = "5060";
const IC_PAYABLE = "2010";
const REFERENCE_TABLE = "intercompany_transactions";

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

async function postBrandJournal({ client, brand, ic, lines }) {
  return accounting.postEntry({
    client,
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

/** The seller_doc must reference a REAL invoice in the seller's own schema. */
async function verifySellerDoc({ seller_brand, seller_doc_type, seller_doc_id }) {
  if (seller_doc_type !== "invoice") return; // only 'invoice' is used today (DDL note)
  const inv = await invoicingRepo.findById({
    brand: seller_brand,
    id: seller_doc_id,
  });
  if (!inv) {
    throw new AppError(
      "SELLER_DOC_NOT_FOUND",
      `seller_doc_id does not match a real invoice in ${seller_brand}`,
      422,
    );
  }
  return inv;
}

/**
 * Stock-backed wholesale trades carry a real margin: sale price (amount_ngn)
 * vs the cost-vault's true landed cost for the referenced variant. Reads the
 * vault directly (bypassing the user-facing cost_vault.service permission
 * gate — this is a server-side integrity check, the decrypted figure is never
 * returned to the caller) and rejects the trade if margin < the caller's own
 * declared floor. Returns the computed margin pct, or null when there is no
 * per-unit cost basis to check against (non-variant trades).
 */
async function computeEffectiveMargin({
  seller_brand,
  flow_type,
  reference_type,
  reference_id,
  amount_ngn,
  min_margin_floor_pct,
}) {
  if (
    flow_type !== "wholesale" ||
    reference_type !== "product_variant" ||
    !reference_id
  ) {
    return null;
  }
  const vault = await costVaultRepo.getVault({
    brand: seller_brand,
    variant_id: reference_id,
  });
  if (!vault || !vault.cost_ngn_enc) {
    logger.warn(
      { seller_brand, variant_id: reference_id },
      "IC margin check skipped — no cost on file for variant",
    );
    return null;
  }
  const cost = Number(encryption.decrypt(vault.cost_ngn_enc));
  const pct = marginPct(amount_ngn, cost);
  const effective = Number(pct.toFixed(2));
  if (effective < Number(min_margin_floor_pct)) {
    throw new AppError(
      "MARGIN_FLOOR_VIOLATION",
      `Effective margin ${effective}% is below the required floor of ${min_margin_floor_pct}%`,
      409,
    );
  }
  return effective;
}

/**
 * Validate + open the CEO-approval workflow instance. Nothing financial
 * happens here — no GL, no stock, no invoice mutation — only on approve()
 * are the mirrored journals posted and stock moved (V2.2 §5.1: "requires
 * CEO approval before the invoice pair is raised").
 */
async function recordTransaction({ user, request_id, input }) {
  if (!isValidBrand(input.seller_brand) || !isValidBrand(input.buyer_brand))
    throw new AppError("INVALID_BRAND", "Unknown seller or buyer brand", 422);
  if (input.seller_brand === input.buyer_brand)
    throw new AppError(
      "SAME_BRAND",
      "seller_brand and buyer_brand must differ",
      422,
    );

  const seller_doc_type = input.seller_doc_type || "invoice";
  await verifySellerDoc({
    seller_brand: input.seller_brand,
    seller_doc_type,
    seller_doc_id: input.seller_doc_id,
  });

  const fx = input.fx_rate_used || 1;
  const amountNgn =
    input.amount_ngn === undefined || input.amount_ngn === null
      ? money(input.amount).times(money(fx))
      : money(input.amount_ngn);
  const amt = toCurrencyString(amountNgn);

  const effective_margin_pct = await computeEffectiveMargin({
    seller_brand: input.seller_brand,
    flow_type: input.flow_type,
    reference_type: input.reference_type,
    reference_id: input.reference_id,
    amount_ngn: amt,
    min_margin_floor_pct: input.min_margin_floor_pct,
  });

  const ic_number = `IC-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

  const ic = await transaction(async (client) => {
    const row = await repo.create({
      client,
      row: {
        ic_number,
        flow_type: input.flow_type,
        seller_brand: input.seller_brand,
        buyer_brand: input.buyer_brand,
        currency: input.currency || "NGN",
        amount: input.amount,
        amount_ngn: amt,
        fx_rate_used: fx,
        min_margin_floor_pct: input.min_margin_floor_pct,
        effective_margin_pct,
        seller_doc_type,
        seller_doc_id: input.seller_doc_id,
        seller_doc_number: input.seller_doc_number,
        status: "pending_approval",
        reference_type: input.reference_type || null,
        reference_id: input.reference_id || null,
        description: input.description,
        posted_by: user.user_id,
      },
    });
    await wf.openInstance({
      client,
      business: row.seller_brand,
      trigger_module: "intercompany",
      trigger_action: "create",
      reference_table: REFERENCE_TABLE,
      reference_id: row.ic_transaction_id,
      opened_by: user.user_id,
      context: { ic_number, amount_ngn: amt },
    });
    return row;
  });

  await audit({
    business: ic.seller_brand,
    user_id: user.user_id,
    action_key: "intercompany.record",
    target_type: "intercompany_transaction",
    target_id: ic.ic_transaction_id,
    after: { ic_number, amount_ngn: amt, status: ic.status },
    request_id,
  });
  events.emit("recorded", {
    ic_transaction_id: ic.ic_transaction_id,
    seller_brand: ic.seller_brand,
    buyer_brand: ic.buyer_brand,
  });
  return getById({ id: ic.ic_transaction_id });
}

/**
 * CEO approves the pending trade → mirrored GL posts in both brands, and
 * (stock-backed wholesale only) the seller's stock is decremented. Each
 * side effect is independently best-effort: a failure is logged + flagged
 * as a reconciliation discrepancy rather than losing the trade record.
 */
async function approveTransaction({ user, request_id, id, notes }) {
  const txn = await repo.findById({ id });
  if (!txn) throw new NotFoundError("Intercompany transaction");
  if (txn.status !== "pending_approval")
    throw new AppError(
      "INVALID_STATE",
      `Cannot approve a '${txn.status}' txn`,
      409,
    );

  const instance = await wf.findOpenInstance({
    business: txn.seller_brand,
    reference_table: REFERENCE_TABLE,
    reference_id: id,
  });
  if (instance) {
    await wf.act({ instance_id: instance.instance_id, user, action: "approve", notes });
  }

  const amt = txn.amount_ngn;
  try {
    await postBrandJournal({
      brand: txn.seller_brand,
      ic: txn,
      lines: [
        {
          account_code: IC_RECEIVABLE,
          debit_ngn: amt,
          description: `IC sale ${txn.ic_number}`,
        },
        {
          account_code: IC_SALES,
          credit_ngn: amt,
          description: `IC sale ${txn.ic_number}`,
        },
      ],
    });
  } catch (err) {
    logger.error({ err: err.message, ic_number: txn.ic_number }, "IC seller journal failed");
    await repo.createReconciliation({
      recon: {
        ic_transaction_id: txn.ic_transaction_id,
        discrepancy_type: "status_mismatch",
        notes: `Seller (${txn.seller_brand}) GL post failed: ${err.message}`,
      },
    });
  }
  try {
    await postBrandJournal({
      brand: txn.buyer_brand,
      ic: txn,
      lines: [
        {
          account_code: IC_COGS,
          debit_ngn: amt,
          description: `IC purchase ${txn.ic_number}`,
        },
        {
          account_code: IC_PAYABLE,
          credit_ngn: amt,
          description: `IC purchase ${txn.ic_number}`,
        },
      ],
    });
  } catch (err) {
    logger.error({ err: err.message, ic_number: txn.ic_number }, "IC buyer journal failed");
    await repo.createReconciliation({
      recon: {
        ic_transaction_id: txn.ic_transaction_id,
        discrepancy_type: "status_mismatch",
        notes: `Buyer (${txn.buyer_brand}) GL post failed: ${err.message}`,
      },
    });
  }

  // Wholesale + stock-backed: the physical unit leaves the seller's
  // warehouse now (the buyer receives it later, on match — GAP-6 below).
  if (
    txn.flow_type === "wholesale" &&
    txn.reference_type === "product_variant" &&
    txn.reference_id
  ) {
    try {
      const loc = await stockRepo.getDefaultLocation({ brand: txn.seller_brand });
      if (loc) {
        await stockService.deductForSale({
          client: null,
          brand: txn.seller_brand,
          variant_id: txn.reference_id,
          location_id: loc.location_id,
          quantity: 1,
          reference_id: id,
          sales_channel: "wholesale",
          unit_cost_ngn: txn.amount_ngn,
          user_id: user.user_id,
        });
      }
    } catch (err) {
      logger.warn({ err, ic_transaction_id: id }, "IC seller stock deduction skipped");
      await repo.createReconciliation({
        recon: {
          ic_transaction_id: id,
          discrepancy_type: "status_mismatch",
          notes: `Seller (${txn.seller_brand}) stock deduction failed: ${err.message}`,
        },
      });
    }
  }

  const updated = await repo.setStatus({ id, status: "pending_buyer" });
  await audit({
    business: txn.seller_brand,
    user_id: user.user_id,
    action_key: "intercompany.approve",
    target_type: "intercompany_transaction",
    target_id: id,
    request_id,
  });
  events.emit("approved", { ic_transaction_id: id });
  return updated;
}

async function rejectTransaction({ user, request_id, id, reason }) {
  const txn = await repo.findById({ id });
  if (!txn) throw new NotFoundError("Intercompany transaction");
  if (txn.status !== "pending_approval")
    throw new AppError(
      "INVALID_STATE",
      `Cannot reject a '${txn.status}' txn`,
      409,
    );

  const instance = await wf.findOpenInstance({
    business: txn.seller_brand,
    reference_table: REFERENCE_TABLE,
    reference_id: id,
  });
  if (instance) {
    await wf.act({
      instance_id: instance.instance_id,
      user,
      action: "reject",
      notes: reason,
    });
  }

  const updated = await repo.setStatus({
    id,
    status: "rejected",
    fields: { rejection_reason: reason || null },
  });
  await audit({
    business: txn.seller_brand,
    user_id: user.user_id,
    action_key: "intercompany.reject",
    target_type: "intercompany_transaction",
    target_id: id,
    after: { reason: reason || null },
    request_id,
  });
  events.emit("rejected", { ic_transaction_id: id });
  return updated;
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
  approveTransaction,
  rejectTransaction,
  matchTransaction,
  settleTransaction,
  openReconciliation,
};
