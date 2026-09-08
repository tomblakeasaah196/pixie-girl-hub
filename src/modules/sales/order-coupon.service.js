/**
 * Post-hoc coupon application — "the discount she was owed, applied late"
 * (V2.2 §6.2 / §6.23.2).
 *
 * ── The gap this closes ─────────────────────────────────────
 * A customer was eligible for a code — a loyalty voucher, a campaign coupon,
 * an apology discount — and nobody entered it at checkout. By the time anyone
 * notices, the order is placed and a deposit has usually landed. Until now the
 * only routes were:
 *
 *   • Cancel and re-raise, which forfeits the deposit to Other Income
 *     (policy Q7), burns the order number and loses her place in the queue.
 *   • Change Order, which deliberately does NOT re-run the offer engines —
 *     it carries existing discounts forward rather than granting new ones.
 *   • Hand-editing totals, which leaves the invoice and the GL disagreeing
 *     with the order.
 *
 * So: apply the coupon in place, against the order that already exists, and
 * reconcile the invoice, the GL, the coupon ledger and the order's payment
 * state in ONE transaction. She keeps her order, her payment and her number;
 * the balance she still owes simply gets smaller.
 *
 * ── The capping rule (owner decision) ───────────────────────
 * The waiver is capped at the OUTSTANDING BALANCE. A ₦20,000 code on an order
 * with ₦15,000 left to pay waives ₦15,000 and settles it — it never drives the
 * order into credit, never triggers a refund, and never creates a liability
 * this screen has no authority to discharge. The preview says plainly when the
 * cap bit, so staff can see the coupon was worth more than the balance before
 * they commit.
 *
 * ── Which world are we in ───────────────────────────────────
 * Everything hinges on whether the sale journal has already posted, exactly as
 * it does for an amendment:
 *
 *   Not recognised (the ordinary case — a deposit is down, balance remains)
 *     No journal exists yet. Reduce the total, and if that settles the order
 *     let the normal markPaid path fire: the order.paid journal, the invoice,
 *     Studio, logistics and the coupon settlement all use the final figures.
 *
 *   Recognised (fully paid once, then a late delivery fee re-opened a balance)
 *     The sale journal is on the books at the old total. Post a DIFFERENCE
 *     journal reducing revenue and the deposit draw-down by the waived amount.
 *
 * ── What it deliberately does NOT do ────────────────────────
 *  • Touch stock, lines or prices. This is an order-level discount, recorded
 *    the same way checkout records one (sales_order_discounts with a NULL
 *    applied_to_line_id). Nothing leaves or returns to the shelf.
 *  • Stack. sales_orders.coupon_code is one column and retention's settlement
 *    subscriber joins expecting one `source='coupon'` row, so an order that
 *    already carries a code is refused by name rather than silently
 *    double-discounted.
 *  • Take or return money. A cap at the balance means there is never an
 *    overpayment to refund.
 */

"use strict";

const repo = require("./sales.repo");
const amendRepo = require("./amendment.repo");
const timelineRepo = require("./timeline.repo");
const salesPostings = require("./sales.postings");
const couponService = require("../retention/coupon.service");
const couponRepo = require("../retention/coupon.repo");
const accountingRepo = require("../accounting/accounting.repo");
const invoicingService = require("../invoicing/invoicing.service");
const { revenueAccountForChannel } = require("../accounting/posting-map");
const { audit } = require("../../middleware/audit");
const { transaction, withSavepoint } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

// A discount is a repair, not a resurrection: once the order is finished or
// written off there is no balance left to reduce and the money has moved
// somewhere this screen has no authority over.
const CLOSED_STATUSES = new Set([
  "completed",
  "cancelled",
  "refunded",
  "failed",
]);

// Fulfilment states that imply the sale journal posted. Only a fallback — the
// authority is "does a 'sales' journal exist for this order".
const SETTLED_STATUSES = new Set([
  "paid",
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
]);

// shared.coupons.discount_type → sales_order_discounts.discount_type, whose
// CHECK constraint is a different (narrower) vocabulary.
const DISCOUNT_TYPE_MAP = {
  percentage: "percentage",
  fixed_amount: "fixed",
  free_shipping: "free_shipping",
};

// Why a coupon didn't apply, in words staff can act on. The retention
// validator answers in codes; the counter needs a sentence.
const REASON_TEXT = {
  NOT_FOUND: "That code doesn't exist. Check the spelling and try again.",
  INACTIVE: "That code has been switched off.",
  NOT_YET_VALID: "That code isn't active yet.",
  EXPIRED: "That code has expired.",
  BELOW_MIN_ORDER:
    "This order is below the minimum spend that code requires.",
  USAGE_LIMIT_REACHED: "That code has been used up.",
  NOT_ASSIGNED_TO_CONTACT:
    "That code was issued to a different customer, so it can't be used on this order.",
  SINGLE_USE_CONSUMED: "That code was single-use and has already been used.",
  PER_CUSTOMER_LIMIT:
    "This customer has already used that code as many times as it allows.",
  NOT_FIRST_TIME: "That code is for first-time customers only.",
};

function assertCouponable(order) {
  if (CLOSED_STATUSES.has(order.status)) {
    throw new AppError(
      "INVALID_STATE",
      `A '${order.status}' order cannot be discounted`,
      409,
      {
        user_message:
          order.status === "completed"
            ? "This order is already completed, so a discount can no longer be applied to it. Raise a credit note or a return instead."
            : `This order is ${order.status.replace(/_/g, " ")} — a discount can no longer be applied to it.`,
      },
    );
  }
  if (order.status === "cancellation_requested") {
    throw new AppError(
      "INVALID_STATE",
      "A cancellation is pending review on this order",
      409,
      {
        user_message:
          "There's a cancellation waiting for a decision on this order. Resolve that first, then apply the code.",
      },
    );
  }
  if (order.coupon_code) {
    throw new AppError("COUPON_ALREADY_APPLIED", "Order already has a coupon", 409, {
      user_message: `This order already carries the code ${order.coupon_code}. An order can hold one coupon, so remove that one first if this is the code she should have had.`,
    });
  }
}

/** Has the sale journal been posted? The authority for which world we're in. */
async function isRevenueRecognised({ client, brand, order }) {
  const entry = await accountingRepo.findEntryBySource({
    client,
    brand,
    source_type: "sales",
    source_id: order.order_id,
  });
  if (entry) return true;
  // Belt and braces for a settled order whose journal failed to post (a locked
  // period, a missing account): the revenue is economically recognised even so.
  return !!order.fully_paid_at || SETTLED_STATUSES.has(order.status);
}

/**
 * Work out what a code is worth on THIS order, and what it would actually
 * waive once capped. Pure of side effects — `previewOrderCoupon` and
 * `applyOrderCoupon` run the identical path so the figure on screen is the
 * figure that gets committed.
 *
 * @param {object} args
 * @param {import('pg').PoolClient} [args.client] When given, the coupon row is
 *   locked FOR UPDATE — the apply path passes it, the preview path doesn't.
 */
async function resolveForOrder({ client, brand, order, code }) {
  const balanceDue = money(order.balance_due_ngn || 0);

  // Capped at the balance, so an order with nothing left to pay has nothing a
  // coupon could do. Say that rather than applying a ₦0 discount.
  if (balanceDue.lte(0)) {
    return {
      valid: false,
      reason: "NOTHING_DUE",
      message:
        "This order is fully paid, so there's no balance left for a code to reduce.",
    };
  }

  const result = await couponService.validateCoupon({
    brand,
    code,
    contact_id: order.contact_id || undefined,
    order_subtotal_ngn: order.subtotal_ngn,
    client,
  });

  if (!result.valid) {
    return {
      valid: false,
      reason: result.reason,
      message:
        REASON_TEXT[result.reason] ||
        "That code can't be used on this order.",
    };
  }

  const coupon = result.coupon;

  // buy_x_get_y needs the basket rebuilt around a free line — that is a Change
  // Order, not a discount. Refuse clearly instead of silently applying ₦0.
  if (coupon.discount_type === "buy_x_get_y") {
    return {
      valid: false,
      reason: "UNSUPPORTED_TYPE",
      message:
        "That's a buy-X-get-Y code, which adds a free item rather than reducing the price. Use Change Order to add the item instead.",
    };
  }

  // free_shipping is worth whatever shipping this order was actually charged;
  // computeDiscount deliberately returns 0 for it because at checkout the
  // shipping fee is zeroed instead of discounted.
  const raw =
    coupon.discount_type === "free_shipping"
      ? money(order.shipping_fee_ngn || 0)
      : money(result.discount_ngn);

  if (raw.lte(0)) {
    return {
      valid: false,
      reason:
        coupon.discount_type === "free_shipping"
          ? "NO_SHIPPING_FEE"
          : "ZERO_VALUE",
      message:
        coupon.discount_type === "free_shipping"
          ? "This order has no delivery fee, so a free-shipping code has nothing to waive."
          : "That code works out to nothing on this order.",
    };
  }

  // The owner's rule: never drive the order into credit.
  const capped = raw.gt(balanceDue);
  const applied = capped ? balanceDue : raw;

  const totalBefore = money(order.total_ngn || 0);
  const totalAfter = totalBefore.minus(applied);
  const balanceAfter = balanceDue.minus(applied);

  return {
    valid: true,
    coupon,
    raw,
    applied,
    capped,
    totalBefore,
    totalAfter,
    balanceBefore: balanceDue,
    balanceAfter,
    settles: balanceAfter.lte(0),
  };
}

/** The shape both the preview endpoint and the apply result report back. */
function publicQuote({ order, resolved, code }) {
  const { coupon } = resolved;
  return {
    valid: true,
    order_id: order.order_id,
    order_number: order.order_number,
    coupon_code: coupon.coupon_code || code,
    display_name: coupon.display_name,
    description: coupon.description || null,
    discount_type: coupon.discount_type,
    // What the code is worth in the abstract, before the balance cap.
    coupon_value_ngn: toCurrencyString(resolved.raw),
    // What it actually takes off this order.
    discount_ngn: toCurrencyString(resolved.applied),
    // True when the code was worth more than the balance and got trimmed.
    capped_to_balance: resolved.capped,
    capped_by_ngn: resolved.capped
      ? toCurrencyString(resolved.raw.minus(resolved.applied))
      : null,
    total_before_ngn: toCurrencyString(resolved.totalBefore),
    total_after_ngn: toCurrencyString(resolved.totalAfter),
    balance_before_ngn: toCurrencyString(resolved.balanceBefore),
    balance_after_ngn: toCurrencyString(resolved.balanceAfter),
    settles_order: resolved.settles,
  };
}

// ── Preview ─────────────────────────────────────────────────

/**
 * Read-only: what would this code do to this order? Writes nothing, so the
 * payment form can call it the moment staff finish typing a code.
 *
 * An unusable code is a 200 with `valid: false` and a sentence — not a 4xx.
 * Typing a wrong code is ordinary counter behaviour, not an error condition,
 * and the form needs to render the reason inline either way.
 */
async function previewOrderCoupon({ brand, id, code }) {
  const order = await repo.findById({ brand, id });
  if (!order) throw new NotFoundError("Order");
  assertCouponable(order);

  // Trimmed, NOT upper-cased: shared.coupons.coupon_code is matched exactly and
  // nothing normalises it on create, so a code minted as "welcome10" is only
  // findable as "welcome10". Trailing whitespace from a paste is the one thing
  // worth forgiving.
  const entered = String(code || "").trim();
  const resolved = await resolveForOrder({ brand, order, code: entered });
  if (!resolved.valid) {
    return {
      valid: false,
      coupon_code: entered,
      reason: resolved.reason,
      message: resolved.message,
    };
  }
  return publicQuote({ order, resolved, code: entered });
}

// ── Apply ───────────────────────────────────────────────────

/**
 * Commit the waiver. One transaction covering the discount row, the order
 * totals, the coupon ledger, the GL, the invoice and the order's payment
 * state — so no screen can ever catch the order half-discounted.
 */
async function applyOrderCoupon({ brand, user, request_id, id, input }) {
  // Exactly as typed (see previewOrderCoupon) — the code is matched, not
  // normalised.
  const entered = String(input.coupon_code || "").trim();

  const result = await transaction(async (client) => {
    // Same lock the amendment takes: a concurrent payment or Change Order on
    // this order queues behind us rather than racing the totals.
    await amendRepo.lockOrder({ client, brand, id });
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    assertCouponable(order);

    const resolved = await resolveForOrder({
      client,
      brand,
      order,
      code: entered,
    });
    if (!resolved.valid) {
      throw new AppError("COUPON_NOT_APPLICABLE", resolved.reason, 409, {
        user_message: resolved.message,
      });
    }

    const { coupon } = resolved;
    const appliedStr = toCurrencyString(resolved.applied);
    const isFreeShipping = coupon.discount_type === "free_shipping";
    const revenueRecognised = await isRevenueRecognised({
      client,
      brand,
      order,
    });

    // ── 1. The discount row ───────────────────────────────
    // Order-level (applied_to_line_id NULL), exactly as checkout records a
    // coupon — so the order's discount breakdown reads the same however the
    // code arrived.
    await repo.insertDiscount({
      client,
      brand,
      disc: {
        order_id: order.order_id,
        source: "coupon",
        source_reference: coupon.coupon_code,
        coupon_id: coupon.coupon_id,
        amount_ngn: appliedStr,
        discount_type: DISCOUNT_TYPE_MAP[coupon.discount_type] || "fixed",
        approved_by: user.user_id || null,
        notes: resolved.capped
          ? `Applied after the order was placed${input.reason ? ` — ${input.reason}` : ""}. Code was worth ${toCurrencyString(resolved.raw)}; capped at the ₦${toCurrencyString(resolved.balanceBefore)} outstanding balance.`
          : `Applied after the order was placed${input.reason ? ` — ${input.reason}` : ""}.`,
      },
    });

    // ── 2. Order totals ───────────────────────────────────
    // Lines, quantities and unit prices are untouched — this is an order-level
    // waiver. A free-shipping code reduces the shipping fee it was granted
    // against; every other kind reduces the discountable value of the goods.
    // Tax is left alone: it was computed and (where non-zero) charged at
    // placement, and re-deriving it would mean re-allocating across lines —
    // that is Change Order's job, not a waiver's.
    const totals = {
      subtotal_ngn: order.subtotal_ngn,
      discount_amount_ngn: toCurrencyString(
        money(order.discount_amount_ngn || 0).plus(resolved.applied),
      ),
      tax_amount_ngn: order.tax_amount_ngn,
      shipping_fee_ngn: isFreeShipping
        ? toCurrencyString(
            money(order.shipping_fee_ngn || 0).minus(resolved.applied),
          )
        : order.shipping_fee_ngn,
      total_ngn: toCurrencyString(resolved.totalAfter),
    };
    await amendRepo.setOrderTotals({ client, brand, id, totals });
    await repo.setCouponCode({
      client,
      brand,
      id,
      coupon_code: coupon.coupon_code,
    });

    // ── 3. Coupon ledger ──────────────────────────────────
    // Checkout defers the redemption to order.paid so an abandoned cart doesn't
    // burn the shopper's allowance. There is no abandonment here — staff are
    // applying a code to an order that already exists — and on an already-
    // recognised order the order.paid fan-out will never fire again. So spend
    // it now, through the same idempotent gate retention's settlement
    // subscriber uses: if that subscriber later runs for this order it finds
    // the redemption and no-ops, and the cancellation subscriber still reverses
    // it if the order is written off.
    const already = await couponRepo.redemptionExists({
      client,
      coupon_id: coupon.coupon_id,
      reference_type: "sales_order",
      reference_id: order.order_id,
    });
    if (!already) {
      await couponRepo.recordRedemption({
        client,
        redemption: {
          coupon_id: coupon.coupon_id,
          contact_id: order.contact_id || null,
          business: brand,
          reference_type: "sales_order",
          reference_id: order.order_id,
          discount_applied: appliedStr,
          display_currency: order.display_currency || null,
        },
      });
      await couponRepo.bumpUsage({
        client,
        coupon_id: coupon.coupon_id,
        discount_ngn: appliedStr,
      });
    }

    // ── 4. The GL ─────────────────────────────────────────
    // Only when revenue is already on the books. In the ordinary case (a
    // deposit down, nothing recognised) the eventual order.paid journal simply
    // uses the reduced figures — there is nothing to correct.
    let journalEntryId = null;
    if (revenueRecognised) {
      const lines = salesPostings.buildOrderDiscountLines({
        discount_ngn: appliedStr,
        is_shipping_waiver: isFreeShipping,
        revenue_account_code: revenueAccountForChannel(order.sales_channel),
        contact_id: order.contact_id,
        reference: order.order_number,
        coupon_code: coupon.coupon_code,
      });
      const accounting = require("../accounting/accounting.service");
      const entry = await accounting.postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "accrual",
          source_table: "sales_order_discounts",
          source_id: order.order_id,
          reference: order.order_number,
          description: `Coupon ${coupon.coupon_code} applied after placement — ${order.order_number}`,
          idempotency_key: `order_coupon:${order.order_id}:${coupon.coupon_id}`,
        },
        lines,
      });
      journalEntryId = entry ? entry.entry_id : null;
    }

    // ── 5. Payment state ──────────────────────────────────
    // The waiver can settle the order outright — that is the whole point of the
    // ₦15,000-balance case. When it does, run the full markPaid path so stock,
    // the order.paid fan-out (invoice, GL, Studio, logistics, comms) and the
    // coupon/points settlement all fire exactly as a final payment would.
    const afterTotals = await repo.findById({ client, brand, id });
    let statusEffect = { moved_to: afterTotals.status, unchanged: true };
    if (!revenueRecognised && resolved.settles) {
      const salesService = require("./sales.service");
      const settled = await salesService.markPaid({
        client,
        brand,
        user,
        _request_id: request_id,
        order: afterTotals,
      });
      statusEffect = {
        moved_to: settled ? settled.status : "paid",
        settled_by_coupon: true,
      };
    }

    // ── 6. Invoice ────────────────────────────────────────
    const fresh = await repo.findById({ client, brand, id });
    const invoice = await invoicingService.resyncFromOrder({
      client,
      brand,
      order: fresh,
      user_id: user.user_id,
    });

    // ── 7. Timeline ───────────────────────────────────────
    // A savepoint so a missing dictionary row can never fail the waiver.
    await withSavepoint(client, () =>
      timelineRepo.insert({
        client,
        brand,
        event: {
          sales_order_id: id,
          event_code: "discount_applied",
          label: "Discount Applied",
          source_module: "sales",
          is_customer_visible: true,
          customer_payload: {
            coupon_code: coupon.coupon_code,
            discount_ngn: appliedStr,
            new_total_ngn: toCurrencyString(resolved.totalAfter),
            balance_due_ngn: toCurrencyString(resolved.balanceAfter),
          },
          recorded_by: user.user_id || null,
        },
      }),
    ).catch((err) =>
      logger.warn(
        { err, order_id: id },
        "order-coupon: timeline event skipped",
      ),
    );

    return {
      order: fresh,
      quote: publicQuote({ order, resolved, code: entered }),
      effects: {
        gl: {
          posted: !!journalEntryId,
          entry_id: journalEntryId,
          reason: revenueRecognised
            ? undefined
            : "revenue not yet recognised — the order.paid journal will use the reduced figures",
        },
        status: statusEffect,
        invoice: invoice
          ? {
              invoice_id: invoice.invoice_id,
              invoice_number: invoice.invoice_number,
              status: invoice.status,
              total_ngn: invoice.total_ngn,
            }
          : { revised: false },
      },
    };
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales.order.coupon_applied",
    target_type: "sales_order",
    target_id: id,
    after: {
      coupon_code: result.quote.coupon_code,
      coupon_value_ngn: result.quote.coupon_value_ngn,
      discount_ngn: result.quote.discount_ngn,
      capped_to_balance: result.quote.capped_to_balance,
      total_before_ngn: result.quote.total_before_ngn,
      total_after_ngn: result.quote.total_after_ngn,
      reason: input.reason || null,
    },
    request_id,
  });

  return result;
}

module.exports = {
  previewOrderCoupon,
  applyOrderCoupon,
  // exported for unit tests
  resolveForOrder,
  assertCouponable,
};
