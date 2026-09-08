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

/**
 * Order amended AFTER its sale journal was posted (§6.2 "Change Order").
 *
 * The original sale journal recognised the order as it stood; an amendment
 * moves the figures, so the books need the DIFFERENCE — never a re-post, and
 * never a reversal-and-replay (which would double the order's footprint in
 * every revenue report).
 *
 *   DR/CR Customer Deposits 2400   Δtotal
 *   CR/DR Revenue (channel)        Δnet    (subtotal − discount)
 *   CR/DR Shipping Revenue         Δshipping
 *   CR/DR VAT Output               Δtax
 *   DR    COGS  / CR Inventory FG  cost of any units ADDED
 *
 * Sign handling: each component is posted on its natural side when the figure
 * grew and on the opposite side when it shrank, so a cheaper amendment simply
 * mirrors the entry. Since Δtotal ≡ Δnet + Δshipping + Δtax by construction,
 * and the COGS pair is self-balancing, the entry always balances.
 *
 * Why 2400 rather than a receivable: policy Q7 routes every capture through
 * Customer Deposits, so the money the customer still owes for the upgrade sits
 * as a debit in 2400 until her top-up payment credits it back — and a
 * downgrade correctly leaves a credit balance there as money we hold for her.
 * That is the same account the eventual refund or the next order draws on.
 *
 * Removed units are NOT in the COGS figure: returning them to stock goes
 * through stock's `return` movement, which posts its own DR Inventory /
 * CR COGS at cost (MOVEMENT_GL in stock.service). Adding them here too would
 * relieve inventory twice.
 *
 * Returns null when nothing moved — the caller skips posting entirely rather
 * than writing an empty journal.
 */
function buildAmendmentLines({
  delta_total_ngn,
  delta_net_ngn,
  delta_shipping_ngn,
  delta_tax_ngn,
  cogs_added_ngn,
  revenue_account_code,
  contact_id,
  reference,
}) {
  // Post `amount` on `naturalSide` when positive, the other side when negative.
  const signed = (amount, account_code, naturalSide, description) => {
    const amt = money(amount || 0);
    if (amt.isZero()) return null;
    const positive = amt.gt(0);
    const value = toCurrencyString(amt.abs());
    const side =
      (naturalSide === "debit") === positive ? "debit_ngn" : "credit_ngn";
    return { account_code, [side]: value, description, contact_id: contact_id || null };
  };

  const lines = [
    signed(
      delta_total_ngn,
      ACCOUNTS.CUSTOMER_DEPOSITS,
      "debit",
      `Order amended — deposits applied (${reference})`,
    ),
    signed(
      delta_net_ngn,
      revenue_account_code,
      "credit",
      `Order amended — revenue adjustment (${reference})`,
    ),
    signed(
      delta_shipping_ngn,
      ACCOUNTS.SHIPPING_REVENUE,
      "credit",
      `Order amended — shipping adjustment (${reference})`,
    ),
    signed(
      delta_tax_ngn,
      ACCOUNTS.VAT_OUTPUT,
      "credit",
      `Order amended — VAT adjustment (${reference})`,
    ),
  ].filter(Boolean);

  const cogs = money(cogs_added_ngn || 0);
  if (cogs.gt(0)) {
    const value = toCurrencyString(cogs);
    lines.push({
      account_code: ACCOUNTS.COGS,
      debit_ngn: value,
      description: `Order amended — COGS on added items (${reference})`,
    });
    lines.push({
      account_code: ACCOUNTS.INVENTORY_FG,
      credit_ngn: value,
      description: `Order amended — inventory relief (${reference})`,
    });
  }

  // postEntry rejects a single-line journal, and a no-op amendment (delivery
  // address only) legitimately moves nothing on the books.
  return lines.length >= 2 ? lines : null;
}

/**
 * A coupon applied AFTER the sale journal already posted (order-coupon.service).
 *
 * The sale journal drew Customer Deposits 2400 down by the full order total and
 * credited revenue with it. Waiving `discount_ngn` means that draw-down was too
 * large and that much revenue was never really earned, so reverse exactly that
 * slice: DR revenue (or shipping revenue, for a free-shipping code, since that
 * is the account the fee was credited to) and CR 2400 back up.
 *
 * Nothing touches stock or COGS — the goods on the order did not change, only
 * what the customer is being charged for them.
 *
 * The ordinary case never reaches here: an order still carrying a balance has
 * no sale journal yet, and its eventual order.paid posting simply uses the
 * reduced total.
 */
function buildOrderDiscountLines({
  discount_ngn,
  is_shipping_waiver,
  revenue_account_code,
  contact_id,
  reference,
  coupon_code,
}) {
  const amt = money(discount_ngn || 0);
  if (amt.lte(0)) return null;
  const value = toCurrencyString(amt);
  const label = coupon_code ? `Coupon ${coupon_code}` : "Discount";
  return [
    {
      account_code: is_shipping_waiver
        ? ACCOUNTS.SHIPPING_REVENUE
        : revenue_account_code,
      debit_ngn: value,
      description: `${label} applied after placement — ${is_shipping_waiver ? "shipping" : "revenue"} reduced (${reference})`,
    },
    {
      account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
      credit_ngn: value,
      description: `${label} applied after placement — deposit released (${reference})`,
      contact_id: contact_id || null,
    },
  ];
}

module.exports = {
  buildCaptureLines,
  buildForfeitLines,
  buildCancellationRefundLines,
  buildAmendmentLines,
  buildOrderDiscountLines,
};
