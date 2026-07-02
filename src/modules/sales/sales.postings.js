/**
 * Sales GL posting builders (ratified accounting policy Q4/Q7/Q8).
 *
 * Pure functions — sales.service posts these through accounting.postEntry
 * inside its own transactions; unit tests pin the debits === credits
 * invariant and account selection without any DB.
 *
 * The deposits model (Q7): every captured payment credits Customer
 * Deposits 2400 (debiting the gateway's settlement float, Q4). When the
 * order is fully paid the sale journal draws 2400 down by the order total,
 * so partial payments, layaway instalments and multi-gateway orders all
 * reconcile — and an unfulfilled order's cash is visible as the liability
 * it really is. Refunds and forfeitures then settle out of 2400 (Q8).
 */

"use strict";

const {
  ACCOUNTS,
  settlementAccountForProvider,
} = require("../accounting/posting-map");
const { money, toCurrencyString } = require("../../utils/money");

/**
 * Payment captured → DR gateway settlement / CR Customer Deposits.
 * POD payments are excluded by the caller — logistics owns COD money
 * movement (collect → 1610, remit → bank).
 */
function buildCaptureLines({ amount_ngn, provider, contact_id, reference }) {
  const amt = toCurrencyString(money(amount_ngn));
  return [
    {
      account_code: settlementAccountForProvider(provider),
      debit_ngn: amt,
      description: `${provider || "direct"} capture — ${reference}`,
    },
    {
      account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
      credit_ngn: amt,
      description: `Customer deposit — ${reference}`,
      contact_id: contact_id || null,
    },
  ];
}

/**
 * Order cancelled while holding deposits (layaway abandonment, unpaid
 * cancellation): the retained deposit becomes income.
 */
function buildForfeitLines({ amount_paid_ngn, contact_id, reference }) {
  const amt = toCurrencyString(money(amount_paid_ngn));
  return [
    {
      account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
      debit_ngn: amt,
      description: `Deposit forfeited — ${reference}`,
      contact_id: contact_id || null,
    },
    {
      account_code: ACCOUNTS.OTHER_INCOME,
      credit_ngn: amt,
      description: `Forfeited deposit — ${reference}`,
    },
  ];
}

/**
 * Approved cancellation refund. Two shapes depending on whether the sale
 * journal has already recognised revenue:
 *
 * Deposits held (order never reached paid — 2400 still carries the money):
 *   DR Customer Deposits (all money held)
 *      CR Bank            cash actually returned
 *      CR Other Income    cancellation fee retained
 * Fee/refund are recomputed from the money ACTUALLY held (amount_paid), not
 * the request's total-based figures — a 30%-deposit layaway can only refund
 * what it holds.
 *
 * Revenue recognised (sale journal posted — 2400 already drawn down):
 *   DR Sales Returns 4090  net refund (contra revenue)
 *   DR VAT Output          VAT share of the refund
 *      CR Bank             cash returned
 * The retained fee simply stays in revenue — no extra line needed.
 */
function buildCancellationRefundLines({
  order,
  fee_amount_ngn,
  refund_amount_ngn,
  revenueRecognised,
  reference,
}) {
  if (!revenueRecognised) {
    const held = money(order.amount_paid_ngn || 0);
    if (held.lte(0)) return null;
    const fee = money(fee_amount_ngn || 0);
    const feeRetained = fee.gt(held) ? held : fee;
    const cashBack = held.minus(feeRetained);
    const lines = [
      {
        account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
        debit_ngn: toCurrencyString(held),
        description: `Cancellation — ${reference}`,
        contact_id: order.contact_id || null,
      },
    ];
    if (cashBack.gt(0))
      lines.push({
        account_code: ACCOUNTS.BANK_MAIN,
        credit_ngn: toCurrencyString(cashBack),
        description: `Refund paid — ${reference}`,
      });
    if (feeRetained.gt(0))
      lines.push({
        account_code: ACCOUNTS.OTHER_INCOME,
        credit_ngn: toCurrencyString(feeRetained),
        description: `Cancellation fee retained — ${reference}`,
      });
    return lines;
  }

  const refund = money(refund_amount_ngn || 0);
  if (refund.lte(0)) return null;
  // VAT share of the refund, pro-rated off the order's own VAT ratio.
  const total = money(order.total_ngn || 0);
  const vatShare = total.gt(0)
    ? money(order.tax_amount_ngn || 0).times(refund).div(total)
    : money(0);
  const vatStr = toCurrencyString(vatShare);
  const netRefund = refund.minus(money(vatStr));
  const lines = [
    {
      account_code: ACCOUNTS.SALES_RETURNS,
      debit_ngn: toCurrencyString(netRefund),
      description: `Sales return — ${reference}`,
      contact_id: order.contact_id || null,
    },
  ];
  if (money(vatStr).gt(0))
    lines.push({
      account_code: ACCOUNTS.VAT_OUTPUT,
      debit_ngn: vatStr,
      description: `VAT reversal — ${reference}`,
    });
  lines.push({
    account_code: ACCOUNTS.BANK_MAIN,
    credit_ngn: toCurrencyString(refund),
    description: `Refund paid — ${reference}`,
  });
  return lines;
}

module.exports = {
  buildCaptureLines,
  buildForfeitLines,
  buildCancellationRefundLines,
};
