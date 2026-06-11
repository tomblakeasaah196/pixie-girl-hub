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
 *   DR Bank/Cash            total
 *   DR COGS                 cost of goods           (if costs known)
 *      CR Revenue (channel) net (subtotal - discount)
 *      CR Shipping Revenue  shipping                (if any)
 *      CR VAT Output        tax                     (if any)
 *      CR Inventory (FG)    cost of goods           (if costs known)
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("../sales/sales.repo");
const accountingRepo = require("./accounting.repo");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");

const REVENUE_BY_CHANNEL = {
  storefront: "4000",
  pos: "4010",
  instagram: "4020",
  whatsapp: "4030",
  wholesale: "4040",
  intercompany: "4050",
  subscription: "4060",
  public_form: "4000",
  facebook: "4020",
  tiktok: "4020",
  phone: "4000",
  event: "4010",
};

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

  const subtotal = money(order.subtotal_ngn);
  const discount = money(order.discount_amount_ngn);
  const shipping = money(order.shipping_fee_ngn);
  const tax = money(order.tax_amount_ngn);
  const total = money(order.total_ngn);
  const net = subtotal.minus(discount);
  const cogs = (order.lines || []).reduce(
    (acc, l) => acc.plus(money(l.unit_cost_ngn || 0).times(l.quantity)),
    money(0),
  );

  const revenueCode = REVENUE_BY_CHANNEL[order.sales_channel] || "4000";
  const lines = [
    {
      account_code: "1100",
      debit_ngn: toCurrencyString(total),
      description: "Cash received",
    },
    {
      account_code: revenueCode,
      credit_ngn: toCurrencyString(net),
      description: "Sales revenue",
      contact_id: order.contact_id,
    },
  ];
  if (shipping.gt(0))
    lines.push({
      account_code: "4200",
      credit_ngn: toCurrencyString(shipping),
      description: "Shipping revenue",
    });
  if (tax.gt(0))
    lines.push({
      account_code: "2100",
      credit_ngn: toCurrencyString(tax),
      description: "VAT output",
    });
  if (cogs.gt(0)) {
    lines.push({
      account_code: "5000",
      debit_ngn: toCurrencyString(cogs),
      description: "Cost of goods sold",
    });
    lines.push({
      account_code: "1300",
      credit_ngn: toCurrencyString(cogs),
      description: "Inventory relief",
    });
  }

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

module.exports = { register, postSaleJournal };
