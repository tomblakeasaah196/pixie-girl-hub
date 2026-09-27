/**
 * The currency a customer actually paid an order in — what their receipt and
 * payment messages should speak.
 *
 * A USD order paid through Nomba credits the order in Naira (at its locked
 * rate) but the customer parted with dollars; `paid_currency` / `paid_amount`
 * on each payment row keep that truth. Receipts used to print only the Naira
 * credit, so a customer who paid $249.99 got a receipt for "₦374,985.00".
 *
 * Pure: reads the order's payment rows; no DB.
 */

"use strict";

const { money, toCurrencyString } = require("../../utils/money");

// A refunded row is money that went back; a pending/failed one never arrived.
const SETTLED = new Set(["captured", "partially_refunded"]);

function capturedPayments(payments) {
  return (payments || []).filter((p) => !p.status || SETTLED.has(p.status));
}

function currencyOf(p) {
  return String((p && p.paid_currency) || "NGN").toUpperCase();
}

/**
 * Receipt figures in the paid currency — only when EVERY captured payment was
 * made in the same foreign currency with its amount on file. A mixed ₦/$
 * order, or any Naira payment, keeps a Naira receipt (null).
 *
 * @param {Array<object>} payments  the order's payment rows
 * @returns {null | { display_currency: string, display_amount: string,
 *                    fx_rate_used: string }}
 *   fx_rate_used = Naira credited ÷ foreign received (the effective rate).
 */
function paidCurrencyDisplay(payments) {
  const captured = capturedPayments(payments);
  if (!captured.length) return null;
  const ccys = new Set(captured.map(currencyOf));
  if (ccys.size !== 1) return null;
  const [ccy] = [...ccys];
  if (ccy === "NGN") return null;
  if (
    captured.some((p) => p.paid_amount === null || p.paid_amount === undefined)
  )
    return null;
  const foreign = captured.reduce((s, p) => s.plus(money(p.paid_amount)), money(0));
  const ngn = captured.reduce((s, p) => s.plus(money(p.amount_ngn || 0)), money(0));
  if (!foreign.gt(0)) return null;
  return {
    display_currency: ccy,
    display_amount: toCurrencyString(foreign),
    fx_rate_used: ngn.dividedBy(foreign).toFixed(6),
  };
}

/** "$249.99" / "₦374,985.00" / "GBP 12.00" — customer-facing copy. */
function formatMoney(amount, currency) {
  const n = money(amount || 0)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = String(currency || "NGN").toUpperCase();
  if (c === "USD") return `$${n}`;
  if (c === "NGN") return `₦${n}`;
  return `${c} ${n}`;
}

/**
 * One payment's amount as the customer paid it: "$150.00" for a USD capture,
 * "₦150,000.00" otherwise.
 */
function paymentAmountLabel(payment) {
  const ccy = currencyOf(payment);
  if (ccy !== "NGN" && payment.paid_amount !== null && payment.paid_amount !== undefined)
    return formatMoney(payment.paid_amount, ccy);
  return formatMoney(payment.amount_ngn, "NGN");
}

/**
 * The order total in the currency it was sold in: "$298.96" for an order
 * locked to USD (display_total at a captured rate — 1.0 is the "never
 * captured" column default), null for a Naira order so the caller keeps its
 * own Naira formatting.
 */
function lockedTotalLabel(order) {
  if (!order) return null;
  const ccy = String(order.display_currency || "NGN").toUpperCase();
  const rate = Number(order.fx_rate_used);
  if (
    ccy === "NGN" ||
    order.display_total === null ||
    order.display_total === undefined ||
    !(rate > 0) ||
    rate === 1
  )
    return null;
  return formatMoney(order.display_total, ccy);
}

/**
 * What the customer paid for the whole order, in the currency they paid:
 * the dollars received when every payment was USD, else the locked total,
 * else null (Naira — caller formats).
 */
function paidTotalLabel(order, payments) {
  const paid = paidCurrencyDisplay(payments);
  if (paid) return formatMoney(paid.display_amount, paid.display_currency);
  return lockedTotalLabel(order);
}

module.exports = {
  paidCurrencyDisplay,
  formatMoney,
  paymentAmountLabel,
  capturedPayments,
  lockedTotalLabel,
  paidTotalLabel,
};
