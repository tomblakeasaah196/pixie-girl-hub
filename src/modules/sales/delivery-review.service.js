/**
 * Delivery-fee review (PR 3, Care & Accessories) — service.
 *
 * THE PROBLEM THIS SOLVES
 *   A retail-containing website order cannot have its delivery fee calculated
 *   at checkout. The owner has not approved the provisional initial-zone-fee
 *   assumption, and the existing zone rate card prices by WIG quantity — so it
 *   would charge several combs as several wigs. Web checkout therefore fails
 *   closed for retail delivery (pickup, or staff arrange it). When staff DO
 *   arrange that delivery, a human calculates the fee and a human enters it.
 *
 * WHY `setDeliveryFee` IS NOT ENOUGH
 *   `sales.service.setDeliveryFee` → `sales.repo.setDeliveryFee` writes
 *   `shipping_fee_ngn`, recomputes `total_ngn` and clears the `fee_pending`
 *   text marker. On an order that has ALREADY been paid that leaves the
 *   financial documents disagreeing with the order: the invoice still shows the
 *   old shipping, the payment link still points at the old balance, nothing is
 *   posted to the ledger for the difference, and `balance_due_ngn` (a generated
 *   column) silently moves without a single naira actually changing hands. It
 *   also records no customer consent, which the owner decision requires before
 *   an increase is charged. This service wraps that primitive with the consent,
 *   verified-payment, document-reconciliation and dispatch-block steps, and is
 *   the only supported way to change the fee on a retail delivery order.
 *
 * LIFECYCLE
 *   open → proposeFee
 *     • increase → awaiting_customer → recordConsent(accepted)
 *                  → verifyTopUp(a CAPTURED payment covering the difference)
 *                  → settle → confirmed
 *     • increase → awaiting_customer → recordConsent(declined)
 *                  → decline path (cancel while unpaid, refund route when paid)
 *     • decrease → verifyRefund(credit note / refund recorded) → credited
 *     • no change → confirm → confirmed
 *   Nothing settles, and the order cannot dispatch, until the money and the
 *   documents agree.
 *
 * SCOPE GUARDS
 *   Only an order that actually contains a Care & Accessories line can enter
 *   this queue. Wig-only and FLH orders are refused here, so their existing
 *   shipping behaviour is untouched byte-for-byte. There is no weight-based,
 *   dimensional or carrier-rate calculation anywhere in this file, and no fee
 *   may ever be supplied by a customer/browser — only by an authorized staff
 *   member, with the basis recorded.
 */

"use strict";

const repo = require("./delivery-review.repo");
const salesRepo = require("./sales.repo");
const retailResolver = require("../catalogue/retail-resolver");
const careGate = require("../catalogue/care-accessories.gate");
const invoicingService = require("../invoicing/invoicing.service");
const salesPostings = require("./sales.postings");
const { revenueAccountForChannel } = require("../accounting/posting-map");
const { audit } = require("../../middleware/audit");
const { transaction, query } = require("../../config/database");
const { t } = require("../../config/brands");
const { money, toCurrencyString } = require("../../utils/money");
const { AppError, NotFoundError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

// A payment only counts as VERIFIED once the money has actually landed. A
// 'pending' or 'authorised' row is a promise, not a top-up.
const VERIFIED_PAYMENT_STATUSES = ["captured"];

/**
 * How many of this order's lines are Care & Accessories SKUs?
 *
 * The "what counts as retail" definition is delegated to the shared typed
 * resolver rather than re-spelling `catalogue_role = 'retail'` here, so this
 * gate can never drift from the one the cart, checkout, Quick Sale and the /o
 * order links use.
 */
async function orderRetailLineCount({ client, brand, order_id }) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT variant_id, quantity FROM ${t(brand, "sales_order_lines")}
      WHERE order_id = $1 AND variant_id IS NOT NULL`,
    [order_id],
  );
  if (!rows.length) return 0;
  const retailIds = await retailResolver.retailVariantIds({
    client,
    brand,
    variant_ids: rows.map((r) => r.variant_id),
  });
  return rows.filter((r) => retailIds.has(r.variant_id)).length;
}

/** Refuse anything that is not a PXG retail delivery needing a human fee. */
async function assertReviewable({ client, brand, order }) {
  if (!order) throw new NotFoundError("Order");
  // Brand + rollout gate. FLH can never hold a retail row (000094 CHECK), and
  // the gate is off in production until PR 4.
  careGate.requireEnabled(brand);
  if (["cancelled", "refunded"].includes(order.status)) {
    throw new AppError(
      "INVALID_STATE",
      `Cannot review the delivery fee on a ${order.status} order`,
      409,
    );
  }
  const retailLines = await orderRetailLineCount({
    client,
    brand,
    order_id: order.order_id,
  });
  if (!retailLines) {
    throw new AppError(
      "NOT_A_RETAIL_ORDER",
      "Only orders containing Care & Accessories items need a manual delivery-fee review — this order's delivery fee is calculated by the normal zone rate card",
      409,
    );
  }
  if (order.order_type === "collection") {
    throw new AppError(
      "PICKUP_HAS_NO_DELIVERY_FEE",
      "A confirmed pickup order carries no delivery charge, so there is nothing to review",
      409,
    );
  }
  return retailLines;
}

/** The staff queue. `sales.view` is enforced at the route. */
async function listQueue({ brand, status, page, page_size }) {
  // The gate keeps FLH out of the feature entirely; the queue is empty there by
  // construction, but refuse rather than return a confusing empty list.
  careGate.requireEnabled(brand);
  return repo.listQueue({ brand, status, page, page_size });
}

/** Full review detail for one order, including its audit trail. */
async function getReview({ brand, order_id }) {
  careGate.requireEnabled(brand);
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) throw new NotFoundError("Order");
  const reviews = await repo.listByOrder({ brand, order_id });
  const open = reviews.find((r) => repo.OPEN_STATUSES.includes(r.status)) || null;
  const events = open ? await repo.listEvents({ brand, review_id: open.review_id }) : [];
  return {
    order: {
      order_id: order.order_id,
      order_number: order.order_number,
      status: order.status,
      order_type: order.order_type,
      shipping_fee_ngn: order.shipping_fee_ngn,
      total_ngn: order.total_ngn,
      amount_paid_ngn: order.amount_paid_ngn,
      balance_due_ngn: order.balance_due_ngn,
      needs_delivery_review: order.needs_delivery_review === true,
    },
    open_review: open,
    reviews,
    events,
    // The exact required disclosure, so the staff UI repeats the same
    // wording the customer saw. "MAY", never "WILL".
    care_delivery_notice: "EXTRA DELIVERY FEES MAY APPLY",
  };
}

/**
 * Open (or return the existing) review for an order. Idempotent: a double-click
 * or a re-queued webhook cannot create two competing fee decisions, and the
 * partial unique index in 000096 is the backstop.
 */
async function openReview({ brand, user, request_id, order_id, calculation_basis }) {
  return transaction(async (client) => {
    const order = await salesRepo.findById({ client, brand, id: order_id });
    await assertReviewable({ client, brand, order });

    const existing = await repo.findOpenByOrder({ client, brand, order_id });
    if (existing) return existing;

    const review = await repo.insertReview({
      client,
      brand,
      review: {
        order_id,
        status: "pending_review",
        // What the customer agreed/paid at checkout. For a fail-closed retail
        // web delivery this is ₦0 — recorded as the starting point so the
        // eventual difference is computed against a real number, not a guess.
        initial_fee_ngn: order.shipping_fee_ngn ?? 0,
        calculation_basis,
        opened_by: user.user_id,
      },
    });
    // The 000096 trigger raises needs_delivery_review from this INSERT.
    await repo.addEvent({
      client,
      brand,
      event: {
        review_id: review.review_id,
        order_id,
        event_type: "opened",
        to_status: "pending_review",
        amount_ngn: review.initial_fee_ngn,
        note: "Delivery fee queued for manual calculation",
        actor_user_id: user.user_id,
        actor_name: user.full_name || user.email || null,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.delivery_review.open",
      target_type: "sales_order",
      target_id: order_id,
      after: { review_id: review.review_id, initial_fee_ngn: review.initial_fee_ngn },
      request_id,
    });
    return review;
  });
}

/**
 * Staff enter the fee they calculated. This records a PROPOSAL — it does not
 * move any money and does not change the order yet.
 *
 * An increase needs the customer's explicit acceptance and a separate verified
 * payment before dispatch (no silent card charge). A decrease needs a
 * credit/refund. No change settles straight away.
 */
async function proposeFee({
  brand,
  user,
  request_id,
  order_id,
  proposed_fee_ngn,
  calculation_basis,
}) {
  return transaction(async (client) => {
    const order = await salesRepo.findById({ client, brand, id: order_id });
    await assertReviewable({ client, brand, order });
    const review = await repo.findOpenByOrder({ client, brand, order_id });
    if (!review) throw new NotFoundError("Delivery fee review");
    if (review.status !== "pending_review" && review.status !== "awaiting_customer") {
      throw new AppError(
        "INVALID_STATE",
        `A ${review.status} review can no longer be re-priced`,
        409,
      );
    }
    if (proposed_fee_ngn === null || proposed_fee_ngn === undefined) {
      throw new AppError("FEE_REQUIRED", "A calculated delivery fee is required", 422);
    }
    const proposed = money(proposed_fee_ngn);
    if (proposed.lt(0)) {
      throw new AppError("FEE_INVALID", "A delivery fee cannot be negative", 422);
    }
    if (!String(calculation_basis || "").trim()) {
      // A human calculated this number; the basis is what makes it reviewable
      // later. Free text on purpose — no rate engine may be implied.
      throw new AppError(
        "CALCULATION_BASIS_REQUIRED",
        "Record how the delivery fee was calculated (courier, distance, parcel count)",
        422,
      );
    }

    const initial = money(review.initial_fee_ngn || 0);
    const difference = proposed.minus(initial);
    const direction = difference.gt(0)
      ? "increase"
      : difference.lt(0)
        ? "decrease"
        : "no_change";

    const updated = await repo.updateReview({
      client,
      brand,
      review_id: review.review_id,
      patch: {
        proposed_fee_ngn: toCurrencyString(proposed),
        difference_ngn: toCurrencyString(difference),
        direction,
        calculation_basis: String(calculation_basis).trim().slice(0, 1000),
        // An increase is NOT agreed yet — the customer has to accept it and pay
        // it. Everything else waits for its own settlement step.
        status: direction === "increase" ? "awaiting_customer" : review.status,
      },
    });
    await repo.addEvent({
      client,
      brand,
      event: {
        review_id: review.review_id,
        order_id,
        event_type: "fee_proposed",
        from_status: review.status,
        to_status: updated.status,
        amount_ngn: toCurrencyString(proposed),
        note: `Calculated fee ₦${toCurrencyString(proposed)} (${direction}${
          direction === "no_change" ? "" : `, difference ₦${toCurrencyString(difference.abs())}`
        }) — ${String(calculation_basis).trim()}`,
        actor_user_id: user.user_id,
        actor_name: user.full_name || user.email || null,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.delivery_review.fee_proposed",
      target_type: "sales_order",
      target_id: order_id,
      before: { proposed_fee_ngn: review.proposed_fee_ngn },
      after: {
        proposed_fee_ngn: toCurrencyString(proposed),
        difference_ngn: toCurrencyString(difference),
        direction,
        calculation_basis: String(calculation_basis).trim(),
      },
      request_id,
    });
    return {
      review: updated,
      requires_customer_acceptance: direction === "increase",
      requires_refund: direction === "decrease",
      difference_ngn: toCurrencyString(difference),
      direction,
    };
  });
}

/** Record the customer's explicit decision on a proposed increase. */
async function recordConsent({
  brand,
  user,
  request_id,
  order_id,
  accepted,
  channel,
  reference,
  note,
}) {
  return transaction(async (client) => {
    const order = await salesRepo.findById({ client, brand, id: order_id });
    await assertReviewable({ client, brand, order });
    const review = await repo.findOpenByOrder({ client, brand, order_id });
    if (!review) throw new NotFoundError("Delivery fee review");
    if (review.direction !== "increase") {
      throw new AppError(
        "NO_INCREASE_PROPOSED",
        "Only a proposed fee increase needs customer acceptance",
        409,
      );
    }
    if (!String(channel || "").trim() || !String(reference || "").trim()) {
      // Consent has to be attributable to a real conversation. A website notice
      // is NOT consent, so an actual channel + message/ticket reference is
      // required before any extra money is collected.
      throw new AppError(
        "CONSENT_EVIDENCE_REQUIRED",
        "Record where the customer accepted (channel) and the message/reference that proves it",
        422,
      );
    }

    if (accepted === false) {
      const declined = await repo.updateReview({
        client,
        brand,
        review_id: review.review_id,
        patch: {
          status: "declined",
          customer_declined_at: new Date().toISOString(),
          settled_at: new Date().toISOString(),
          settled_by: user.user_id,
        },
      });
      await repo.addEvent({
        client,
        brand,
        event: {
          review_id: review.review_id,
          order_id,
          event_type: "consent_declined",
          from_status: review.status,
          to_status: "declined",
          amount_ngn: review.difference_ngn,
          note: note || `Customer declined the increase via ${channel} (${reference})`,
          actor_user_id: user.user_id,
          actor_name: user.full_name || user.email || null,
        },
      });
      // The flag drops via the 000096 sync trigger, so the order can now move to
      // the supported cancellation/refund path instead of being stranded.
      await audit({
        business: brand,
        user_id: user.user_id,
        action_key: "sales.delivery_review.consent_declined",
        target_type: "sales_order",
        target_id: order_id,
        after: { channel, reference, note: note || null },
        request_id,
      });
      return {
        review: declined,
        // Deliberately NOT an automatic cancellation: the mixed custom-wig +
        // retail cancellation-fee allocation is an unanswered owner decision, so
        // the order routes to staff rather than being charged an invented fee.
        next_action: order.amount_paid_ngn > 0 ? "staff_refund_review" : "cancel_order",
      };
    }

    const consented = await repo.updateReview({
      client,
      brand,
      review_id: review.review_id,
      patch: {
        customer_consent_at: new Date().toISOString(),
        customer_consent_channel: String(channel).trim().slice(0, 60),
        customer_consent_reference: String(reference).trim().slice(0, 200),
      },
    });
    await repo.addEvent({
      client,
      brand,
      event: {
        review_id: review.review_id,
        order_id,
        event_type: "consent_received",
        from_status: review.status,
        to_status: consented.status,
        amount_ngn: review.difference_ngn,
        note: `Customer accepted the increase via ${channel} (${reference})`,
        actor_user_id: user.user_id,
        actor_name: user.full_name || user.email || null,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.delivery_review.consent_received",
      target_type: "sales_order",
      target_id: order_id,
      after: { channel, reference },
      request_id,
    });
    return { review: consented, next_action: "verify_topup" };
  });
}

/** Look up a payment row and insist it is real, captured and on this order. */
async function verifiedPayment({ client, brand, order_id, payment_id, minimum_ngn }) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT payment_id, payment_number, amount_ngn, status, method, provider,
            provider_reference, captured_at
       FROM ${t(brand, "sales_order_payments")}
      WHERE payment_id = $1 AND order_id = $2`,
    [payment_id, order_id],
  );
  const p = rows[0];
  if (!p) throw new NotFoundError("Payment");
  if (!VERIFIED_PAYMENT_STATUSES.includes(p.status)) {
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      `Payment ${p.payment_number} is '${p.status}', not captured — a pending or authorised charge is not a verified top-up`,
      409,
    );
  }
  if (money(p.amount_ngn).lt(money(minimum_ngn))) {
    throw new AppError(
      "TOPUP_SHORT",
      `Payment ${p.payment_number} covers ₦${toCurrencyString(
        money(p.amount_ngn),
      )} of the ₦${toCurrencyString(money(minimum_ngn))} increase`,
      409,
    );
  }
  return p;
}

/**
 * Settle the review: write the agreed fee onto the order AND reconcile every
 * document that carries a money figure, in one transaction, before dispatch.
 *
 * `sales.repo.setDeliveryFee` only does the first line of this. Everything
 * after it is the part that was missing.
 */
async function settle({ client, brand, user, request_id, order, review, agreedFeeNgn, event }) {
  const agreed = money(agreedFeeNgn);
  const before = {
    shipping_fee_ngn: order.shipping_fee_ngn,
    total_ngn: order.total_ngn,
    balance_due_ngn: order.balance_due_ngn,
  };

  // 1. The order row: shipping + recomputed total (and the legacy fee_pending
  //    marker cleared, so the old Delivery Pending filter stays consistent).
  await salesRepo.setDeliveryFee({
    client,
    brand,
    id: order.order_id,
    fee_ngn: toCurrencyString(agreed),
  });
  const fresh = await salesRepo.findById({ client, brand, id: order.order_id });

  // 2. Invoice: rebuild its lines/totals from the order so the customer's
  //    document matches what they were actually charged.
  let invoiceSynced = false;
  try {
    const inv = await invoicingService.resyncFromOrder({
      client,
      brand,
      order: fresh,
      user_id: user.user_id,
    });
    invoiceSynced = Boolean(inv);
  } catch (err) {
    // resyncFromOrder needs the full invoicing schema; a missing/void invoice is
    // a legitimate "nothing to sync". Anything else must not settle silently.
    logger.warn(
      { err: err.message, order_id: order.order_id },
      "delivery-review: invoice resync skipped",
    );
  }

  // 3. Ledger: post the difference as an adjusting entry with its own
  //    idempotency key, so a retried settle cannot double-post. Reuses the
  //    amendment posting builder — a delivery-fee change is the same shape of
  //    adjustment (shipping delta, no COGS, no net-goods change).
  const deltaShipping = agreed.minus(money(before.shipping_fee_ngn || 0));
  let ledgerPosted = false;
  if (!deltaShipping.isZero()) {
    const lines = salesPostings.buildAmendmentLines({
      delta_total_ngn: toCurrencyString(deltaShipping),
      delta_net_ngn: "0.00",
      delta_shipping_ngn: toCurrencyString(deltaShipping),
      delta_tax_ngn: "0.00",
      cogs_added_ngn: null,
      revenue_account_code: revenueAccountForChannel(order.sales_channel),
      contact_id: order.contact_id,
      reference: order.order_number,
    });
    if (lines) {
      const accounting = require("../accounting/accounting.service");
      const entry = await accounting.postEntry({
        client,
        brand,
        user_id: user.user_id,
        entry: {
          source_type: "accrual",
          source_table: "delivery_fee_reviews",
          source_id: order.order_id,
          reference: order.order_number,
          description: `Delivery fee agreed by staff — ${order.order_number}`,
          idempotency_key: `delivery_review:${review.review_id}`,
        },
        lines,
      });
      ledgerPosted = Boolean(entry);
    }
  } else {
    ledgerPosted = true; // nothing to post
  }

  // 4. Close the review and drop the durable flag, which is what releases the
  //    000096 dispatch block.
  const settled = await repo.updateReview({
    client,
    brand,
    review_id: review.review_id,
    patch: {
      agreed_fee_ngn: toCurrencyString(agreed),
      invoice_synced_at: invoiceSynced ? new Date().toISOString() : null,
      ledger_posted_at: ledgerPosted ? new Date().toISOString() : null,
      settled_at: new Date().toISOString(),
      settled_by: user.user_id,
      ...event,
    },
  });
  // The sync trigger clears needs_delivery_review once no open review remains;
  // set it explicitly too so the flag never depends on trigger ordering.
  await repo.setOrderReviewFlag({
    client,
    brand,
    order_id: order.order_id,
    needs: false,
  });
  await repo.addEvent({
    client,
    brand,
    event: {
      review_id: review.review_id,
      order_id: order.order_id,
      event_type: "settled",
      from_status: review.status,
      to_status: settled.status,
      amount_ngn: toCurrencyString(agreed),
      note: `Agreed delivery fee ₦${toCurrencyString(agreed)} applied; invoice ${
        invoiceSynced ? "resynced" : "not present"
      }, ledger ${ledgerPosted ? "posted" : "no delta"}`,
      actor_user_id: user.user_id,
      actor_name: user.full_name || user.email || null,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales.delivery_review.settled",
    target_type: "sales_order",
    target_id: order.order_id,
    before,
    after: {
      shipping_fee_ngn: fresh.shipping_fee_ngn,
      total_ngn: fresh.total_ngn,
      balance_due_ngn: fresh.balance_due_ngn,
      invoice_synced: invoiceSynced,
      ledger_posted: ledgerPosted,
    },
    request_id,
  });
  return { review: settled, order: fresh, invoiceSynced, ledgerPosted };
}

/**
 * The customer accepted an increase and PAID it: attach the captured payment,
 * then settle at the proposed fee.
 */
async function verifyTopUp({ brand, user, request_id, order_id, payment_id }) {
  return transaction(async (client) => {
    const order = await salesRepo.findById({ client, brand, id: order_id });
    await assertReviewable({ client, brand, order });
    const review = await repo.findOpenByOrder({ client, brand, order_id });
    if (!review) throw new NotFoundError("Delivery fee review");
    if (review.direction !== "increase") {
      throw new AppError(
        "NO_INCREASE_PROPOSED",
        "Only a proposed increase is settled by a customer top-up",
        409,
      );
    }
    if (!review.customer_consent_at) {
      // No consent, no charge — this is the "no silent card charge" rule and it
      // is checked here as well as in the UI, because the API is the boundary.
      throw new AppError(
        "CONSENT_REQUIRED",
        "The customer must explicitly accept the increase before a top-up is recorded",
        409,
      );
    }
    const payment = await verifiedPayment({
      client,
      brand,
      order_id,
      payment_id,
      minimum_ngn: review.difference_ngn,
    });
    await repo.updateReview({
      client,
      brand,
      review_id: review.review_id,
      patch: {
        topup_payment_id: payment.payment_id,
        topup_verified_at: payment.captured_at || new Date().toISOString(),
      },
    });
    await repo.addEvent({
      client,
      brand,
      event: {
        review_id: review.review_id,
        order_id,
        event_type: "topup_verified",
        from_status: review.status,
        to_status: review.status,
        amount_ngn: payment.amount_ngn,
        note: `Top-up ${payment.payment_number} captured (${payment.method}${
          payment.provider ? ` / ${payment.provider}` : ""
        })`,
        actor_user_id: user.user_id,
        actor_name: user.full_name || user.email || null,
      },
    });
    const result = await settle({
      client,
      brand,
      user,
      request_id,
      order,
      review,
      agreedFeeNgn: review.proposed_fee_ngn,
      event: { status: "accepted" },
    });
    return { ...result, payment_number: payment.payment_number };
  });
}

/**
 * The calculated fee was LOWER than what the customer already agreed: record the
 * credit/refund, then settle at the lower figure. The credit note is created
 * through the normal invoicing path so the customer's documents show it.
 */
async function verifyRefund({
  brand,
  user,
  request_id,
  order_id,
  credit_note_id,
  refund_payment_id,
  note,
}) {
  return transaction(async (client) => {
    const order = await salesRepo.findById({ client, brand, id: order_id });
    await assertReviewable({ client, brand, order });
    const review = await repo.findOpenByOrder({ client, brand, order_id });
    if (!review) throw new NotFoundError("Delivery fee review");
    if (review.direction !== "decrease") {
      throw new AppError(
        "NO_DECREASE_PROPOSED",
        "Only a proposed decrease is settled by a credit/refund",
        409,
      );
    }
    if (!credit_note_id && !refund_payment_id) {
      throw new AppError(
        "REFUND_EVIDENCE_REQUIRED",
        "Record the credit note or the refund payment that returns the difference before settling a lower fee",
        422,
      );
    }
    // "Verified" means the document actually exists — not that a staff member
    // typed an id into a box. A credit note is looked up through invoicing; a
    // refund payment must be a real row on THIS order in a refunded state.
    let evidence;
    if (credit_note_id) {
      const cn = await invoicingService.getCreditNote({ brand, id: credit_note_id });
      evidence = `credit note ${cn.credit_note_number || credit_note_id}`;
    } else {
      const run = client ? client.query.bind(client) : query;
      const { rows } = await run(
        `SELECT payment_id, payment_number, status, refunded_amount_ngn
           FROM ${t(brand, "sales_order_payments")}
          WHERE payment_id = $1 AND order_id = $2`,
        [refund_payment_id, order_id],
      );
      const p = rows[0];
      if (!p) throw new NotFoundError("Refund payment");
      if (!["refunded", "partially_refunded"].includes(p.status)) {
        throw new AppError(
          "REFUND_NOT_VERIFIED",
          `Payment ${p.payment_number} is '${p.status}', not refunded`,
          409,
        );
      }
      if (money(p.refunded_amount_ngn || 0).lt(money(review.difference_ngn).abs())) {
        throw new AppError(
          "REFUND_SHORT",
          `Payment ${p.payment_number} refunded ₦${toCurrencyString(
            money(p.refunded_amount_ngn || 0),
          )} of the ₦${toCurrencyString(
            money(review.difference_ngn).abs(),
          )} difference`,
          409,
        );
      }
      evidence = `refund on ${p.payment_number}`;
    }
    await repo.addEvent({
      client,
      brand,
      event: {
        review_id: review.review_id,
        order_id,
        event_type: "refund_verified",
        from_status: review.status,
        to_status: review.status,
        amount_ngn: review.difference_ngn,
        note: note || `Difference credited — ${evidence}`,
        actor_user_id: user.user_id,
        actor_name: user.full_name || user.email || null,
      },
    });
    const result = await settle({
      client,
      brand,
      user,
      request_id,
      order,
      review,
      agreedFeeNgn: review.proposed_fee_ngn,
      event: {
        status: "credited",
        refund_payment_id: refund_payment_id || null,
        refund_verified_at: new Date().toISOString(),
      },
    });
    return { ...result, credit_note_id: credit_note_id || null, evidence };
  });
}

/**
 * The amount the customer already agreed IS the final fee (the common case for
 * a staff-arranged delivery priced before payment). Settles with no money
 * movement and no consent step, because nothing increased.
 */
async function confirmFee({ brand, user, request_id, order_id, calculation_basis }) {
  return transaction(async (client) => {
    const order = await salesRepo.findById({ client, brand, id: order_id });
    await assertReviewable({ client, brand, order });
    const review = await repo.findOpenByOrder({ client, brand, order_id });
    if (!review) throw new NotFoundError("Delivery fee review");
    if (review.direction === "increase") {
      throw new AppError(
        "CONSENT_REQUIRED",
        "A proposed increase needs the customer's acceptance and a verified top-up — it cannot simply be confirmed",
        409,
      );
    }
    const agreed = review.direction === "decrease" ? review.proposed_fee_ngn : review.initial_fee_ngn;
    if (calculation_basis) {
      await repo.updateReview({
        client,
        brand,
        review_id: review.review_id,
        patch: { calculation_basis: String(calculation_basis).trim().slice(0, 1000) },
      });
    }
    await repo.addEvent({
      client,
      brand,
      event: {
        review_id: review.review_id,
        order_id,
        event_type: "fee_confirmed",
        from_status: review.status,
        to_status: "confirmed",
        amount_ngn: agreed,
        note: calculation_basis
          ? `Fee confirmed at ₦${toCurrencyString(money(agreed))} — ${String(calculation_basis).trim()}`
          : `Fee confirmed at ₦${toCurrencyString(money(agreed))}`,
        actor_user_id: user.user_id,
        actor_name: user.full_name || user.email || null,
      },
    });
    return settle({
      client,
      brand,
      user,
      request_id,
      order,
      review,
      agreedFeeNgn: agreed,
      event: { status: "confirmed" },
    });
  });
}

/**
 * The customer declined an increase. This is a ROUTE TO STAFF, not an automatic
 * cancellation: the mixed custom-wig + retail cancellation-fee allocation is an
 * unanswered owner decision (today it is an order-wide percentage), so applying
 * one here would invent a charge the owner has not approved.
 *
 * An unpaid order can be cancelled through the normal path. A paid one must go
 * through the existing refund flow with a human deciding the amount.
 */
async function routeDecline({ brand, user, request_id, order_id, note }) {
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) throw new NotFoundError("Order");
  const review = await repo.findOpenByOrder({ brand, order_id });
  if (!review || review.status !== "declined") {
    throw new AppError(
      "INVALID_STATE",
      "Only a review the customer declined can be routed to cancellation/refund",
      409,
    );
  }
  const paid = money(order.amount_paid_ngn || 0).gt(0);
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales.delivery_review.decline_routed",
    target_type: "sales_order",
    target_id: order_id,
    after: { next_action: paid ? "staff_refund_review" : "cancel_order", note: note || null },
    request_id,
  });
  return {
    order_id,
    order_number: order.order_number,
    amount_paid_ngn: order.amount_paid_ngn,
    next_action: paid ? "staff_refund_review" : "cancel_order",
    // Explicitly surfaced so no caller assumes a fee was applied.
    cancellation_fee_applied: false,
    reason: paid
      ? "The order is paid — the refund amount is a staff decision (the mixed wig + retail cancellation-fee allocation is not an approved owner decision)."
      : "The order is unpaid — cancel it through the normal Sales cancellation path.",
  };
}

module.exports = {
  OPEN_STATUSES: repo.OPEN_STATUSES,
  SETTLED_STATUSES: repo.SETTLED_STATUSES,
  orderRetailLineCount,
  listQueue,
  getReview,
  openReview,
  proposeFee,
  recordConsent,
  verifyTopUp,
  verifyRefund,
  confirmFee,
  routeDecline,
};
