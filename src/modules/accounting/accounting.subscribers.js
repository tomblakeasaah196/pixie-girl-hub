/**
 * Accounting subscribers — the GL side of cross-module flows.
 *
 * On Sales `order.paid`, post the sale journal. Driven by the **transactional
 * outbox** (H-2): the dispatcher invokes this handler only AFTER the sales
 * transaction has committed, so the order row is guaranteed visible (fixes the
 * old pre-commit/clientless-read skip). Delivery is at-least-once, so the
 * handler is **idempotent** — one ('sales', order_id) journal per order,
 * guarded by a pre-check + the partial UNIQUE index (migration 000204).
 *
 *   DR Customer Deposits    total                   (captures credited 2400, Q7)
 *   DR COGS                 cost of goods           (weighted average, Q9)
 *      CR Revenue (channel) net (subtotal - discount)
 *      CR Shipping Revenue  shipping                (if any)
 *      CR VAT Output        tax                     (if any)
 *      CR Inventory (FG)    cost of goods
 *
 * COGS basis per line (policy Q9): the line's captured unit_cost_ngn, else
 * the variant's moving weighted average (variant_costing), else the
 * variant's standard cost — so a sale never silently books zero cost when a
 * basis exists.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const stockRepo = require("../stock/stock.repo");
const accountingRepo = require("./accounting.repo");
const { ACCOUNTS, revenueAccountForChannel } = require("./posting-map");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");

function lineCost(line, costBasis) {
  if (line.unit_cost_ngn !== null && line.unit_cost_ngn !== undefined)
    return money(line.unit_cost_ngn);
  const basis = costBasis && costBasis.get(line.variant_id);
  return basis !== undefined ? money(basis) : null;
}

/**
 * Build the balanced journal lines for a paid sales order. Pure — exported
 * for unit tests, which assert debits === credits across scenarios.
 *
 * @param {Object} order      sales_orders row with .lines
 * @param {Map}    costBasis  variant_id → unit cost (weighted avg fallback)
 */
function buildSaleJournalLines(order, costBasis) {
  const subtotal = money(order.subtotal_ngn);
  const discount = money(order.discount_amount_ngn);
  const shipping = money(order.shipping_fee_ngn);
  const tax = money(order.tax_amount_ngn);
  const total = money(order.total_ngn);
  const net = subtotal.minus(discount);
  const cogs = (order.lines || []).reduce((acc, l) => {
    const cost = lineCost(l, costBasis);
    return cost ? acc.plus(cost.times(l.quantity)) : acc;
  }, money(0));

  const lines = [
    {
      // Policy Q7: every capture credited Customer Deposits 2400, so the
      // sale draws the liability down — never debits cash directly. Any
      // over-payment legitimately stays in 2400 as customer credit.
      account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
      debit_ngn: toCurrencyString(total),
      description: "Customer deposits applied",
    },
    {
      account_code: revenueAccountForChannel(order.sales_channel),
      credit_ngn: toCurrencyString(net),
      description: "Sales revenue",
      contact_id: order.contact_id,
    },
  ];
  if (shipping.gt(0))
    lines.push({
      account_code: ACCOUNTS.SHIPPING_REVENUE,
      credit_ngn: toCurrencyString(shipping),
      description: "Shipping revenue",
    });
  if (tax.gt(0))
    lines.push({
      account_code: ACCOUNTS.VAT_OUTPUT,
      credit_ngn: toCurrencyString(tax),
      description: "VAT output",
    });
  if (cogs.gt(0)) {
    lines.push({
      account_code: ACCOUNTS.COGS,
      debit_ngn: toCurrencyString(cogs),
      description: "Cost of goods sold",
    });
    lines.push({
      account_code: ACCOUNTS.INVENTORY_FG,
      credit_ngn: toCurrencyString(cogs),
      description: "Inventory relief",
    });
  }
  return lines;
}

async function postSaleJournal({ brand, order_id }) {
  const accounting = require("./accounting.service");

  // Idempotency (H-3): never post a second sale journal for the same order.
  const existing = await accountingRepo.findEntryBySource({
    brand,
    source_type: "sales",
    source_id: order_id,
  });
  if (existing) return;

  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) {
    // Post-commit dispatch should always find the row; if not, let the outbox
    // retry rather than silently swallow.
    throw new Error(`order ${order_id} not found when posting sale journal`);
  }

  // Weighted-average fallback for lines that didn't capture a unit cost.
  const missingCost = (order.lines || [])
    .filter((l) => l.unit_cost_ngn === null || l.unit_cost_ngn === undefined)
    .map((l) => l.variant_id)
    .filter(Boolean);
  const costBasis = await stockRepo.getCostBasisForVariants({
    brand,
    variant_ids: [...new Set(missingCost)],
  });

  const lines = buildSaleJournalLines(order, costBasis);

  try {
    await accounting.postEntry({
      brand,
      user_id: null,
      entry: {
        source_type: "sales",
        source_table: "sales_orders",
        source_id: order_id,
        reference: order.order_number,
        description: `Sale ${order.order_number}`,
      },
      lines,
    });
  } catch (err) {
    // Lost the race to a concurrent post — the unique index rejected us. That
    // means the journal exists, so treat as success (idempotent).
    if (err && err.code === "23505") return;
    throw err;
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.paid", "accounting", postSaleJournal);
  logger.info(
    "accounting subscribers registered (outbox order.paid → GL post)",
  );
}

register();

module.exports = { register, postSaleJournal, buildSaleJournalLines };
