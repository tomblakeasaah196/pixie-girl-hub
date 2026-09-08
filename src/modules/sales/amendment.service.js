/**
 * Order amendments — "Change Order" (V2.2 §6.2).
 *
 * ── The gap this closes ─────────────────────────────────────
 * A customer pays, and only then does someone notice the order was recorded
 * against the wrong product. Until now the system had no correct answer:
 *
 *   • Cancel and re-raise forfeits the deposit to Other Income (policy Q7),
 *     burns the order number, orphans the invoice and the Studio job, and
 *     loses the customer's history on that sale.
 *   • Editing the row by hand leaves stock, the GL, the invoice, the styling
 *     job and the delivery manifest all describing different orders.
 *
 * So: amend in place, and reconcile every downstream module in ONE
 * transaction. The customer keeps her order number, her payment, her invoice
 * and her place in the queue; she just pays (or is credited) the difference.
 *
 * ── The two worlds ──────────────────────────────────────────
 * Everything hinges on whether the order's REVENUE HAS BEEN RECOGNISED —
 * i.e. whether order.paid already fired and posted the sale journal:
 *
 *   Not recognised (draft / pending_payment / partially_paid, never settled)
 *     Stock is only RESERVED, no journal exists, the invoice is a proforma.
 *     An amendment moves reservations, rewrites the proforma, and lets the
 *     eventual order.paid journal use the final figures. No GL delta at all.
 *
 *   Recognised (the order was fully paid at some point)
 *     Stock has LEFT (a 'sale' movement), the sale journal is on the books,
 *     the invoice is issued. An amendment returns the removed units to stock
 *     ('return' movements, which reverse their own COGS), deducts the added
 *     ones, posts a DIFFERENCE journal, and walks the invoice back to
 *     partially_paid when the swap costs more.
 *
 * ── What it deliberately does NOT do ────────────────────────
 *  • Re-run the checkout offer engines (campaign / coupon / points / bundle /
 *    referral). Those were resolved and, for coupons and points, SETTLED on
 *    order.paid — re-running them would double-redeem. The discounts already
 *    granted are carried forward instead (see reallocateOrderDiscounts).
 *  • Take money. An upgrade puts the order back into balance and the customer
 *    settles it through the ordinary rails (pay link / recorded payment); a
 *    downgrade leaves a credit in Customer Deposits 2400 for Finance to refund
 *    or apply, because deciding between those is not an Orders-screen call.
 *  • Retro-adjust commission or loyalty accrual. Both were accrued once, on
 *    the original settlement, and reversing an accrual is a payroll/retention
 *    concern with its own approval path. The amendment records the before and
 *    after so the adjustment is auditable if Finance wants to make one.
 */

"use strict";

const repo = require("./sales.repo");
const amendRepo = require("./amendment.repo");
const events = require("./sales.events");
const outbox = require("../../shared/outbox/outbox");
const stockService = require("../stock/stock.service");
const stockRepo = require("../stock/stock.repo");
const serviceJobsRepo = require("../service_jobs/service-jobs.repo");
const logisticsRepo = require("../logistics/logistics.repo");
const accountingRepo = require("../accounting/accounting.repo");
const invoicingService = require("../invoicing/invoicing.service");
const businessConfig = require("../business_setup/business-config.repo");
const timelineRepo = require("./timeline.repo");
const salesPostings = require("./sales.postings");
const orderReadiness = require("./order-readiness");
const { revenueAccountForChannel } = require("../accounting/posting-map");
const { channelPrice } = require("./pricing/channel-price");
const { clampToMarginFloor } = require("./pricing/margin-floor");
const { createDiscountAllocator } = require("./pricing/allocator");
const { computeTotalsAndLines } = require("./pricing/totals");
const {
  netVariantDelta,
  buildLineChanges,
  summariseChanges,
  describeLine,
  DELIVERY_FIELDS,
} = require("./pricing/amendment-diff");
const { audit } = require("../../middleware/audit");
const { transaction, withSavepoint } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

// An amendment is a repair, not a resurrection: once the order is finished or
// written off there is nothing left to change, and the money has moved
// somewhere this screen has no authority over.
const CLOSED_STATUSES = new Set(["completed", "cancelled", "refunded", "failed"]);
// Fulfilment states where the sale journal has definitely been posted. Used
// only as a fallback signal — the authoritative check is "does a 'sales'
// journal exist for this order" (findEntryBySource below).
const SETTLED_STATUSES = new Set([
  "paid",
  "assigned",
  "order_ready",
  "dispatched",
  "completed",
]);
// The courier has it. Line changes past this point are physically impossible
// to honour without a return, so they need an explicit acknowledgement.
const DELIVERY_GONE = new Set([
  "picked_up",
  "in_transit",
  "arrived_destination_city",
  "out_for_delivery",
  "delivered",
]);
// Studio work that is finished (or was never started) — the two ends of the
// spectrum the reconciler treats differently when a styling line is removed.
// Both sets come from order-readiness, which is also what gates the customer's
// "Order Ready" message: the reconciler's idea of a finished wig and the gate's
// must never drift apart.
const JOB_DONE = new Set(orderReadiness.JOB_DONE);
const JOB_CLOSED = new Set(orderReadiness.JOB_VOID);

// ── Line building ───────────────────────────────────────────

/**
 * Turn the operator's replacement cart into priced, persistable line rows.
 *
 * Two kinds of line, and the difference matters:
 *
 *   KEPT (the payload carries `line_id`) — the operator didn't touch this
 *     item, or only changed its quantity. Its unit price, VAT rate, cost
 *     snapshot and per-unit campaign discount are all carried forward from the
 *     existing row. A swap must never silently re-price the wig the customer
 *     already agreed to, and a VAT-rate change in settings must never reach
 *     back into an order placed under the old rate.
 *
 *   NEW (no `line_id`) — priced exactly as createOrder would price it: the
 *     operator's explicit price if given, else the variant's price for this
 *     order's own sales channel, with the product's live VAT and cost.
 */
async function buildLines({ client, brand, order, inputLines }) {
  const beforeById = new Map((order.lines || []).map((l) => [l.line_id, l]));

  // Normalise first. A kept line may legitimately arrive as nothing more than
  // `{ line_id, quantity }` — the modal has no reason to re-send what it isn't
  // changing — so the product identity is inherited from the existing row
  // before anything else looks at it. Skipping this wrote NULL variant_ids
  // over untouched lines.
  const normalised = inputLines.map((li) => {
    const prior = li.line_id ? beforeById.get(li.line_id) : null;
    if (li.line_id && !prior) {
      throw new AppError(
        "REFERENCE_INVALID",
        `Line ${li.line_id} is not on this order`,
        409,
        {
          user_message:
            "This order changed while you were editing it. Reopen it and try again.",
        },
      );
    }
    if (!prior) return { li, prior: null };
    return {
      prior,
      li: {
        ...li,
        variant_id: li.variant_id ?? prior.variant_id ?? undefined,
        service_offering_id:
          li.service_offering_id ?? prior.service_offering_id ?? undefined,
      },
    };
  });

  const variantCtxById = await repo.variantContexts({
    client,
    brand,
    variant_ids: normalised.map((n) => n.li.variant_id).filter(Boolean),
  });

  const built = [];
  for (const { li, prior } of normalised) {
    let ctx;
    if (!li.variant_id && li.service_offering_id) {
      ctx = await repo.serviceOfferingContext({
        client,
        brand,
        service_id: li.service_offering_id,
      });
    } else {
      const row = variantCtxById.get(li.variant_id);
      // Shallow copy — two lines of the same variant must not share one ctx.
      ctx = row ? { ...row } : null;
    }
    if (!ctx) {
      throw new AppError(
        "REFERENCE_INVALID",
        li.service_offering_id
          ? `Service ${li.service_offering_id} not found`
          : `Variant ${li.variant_id} not found`,
        409,
      );
    }

    let unit;
    let perUnitDiscount = money(0);
    if (prior) {
      unit = money(
        li.unit_price_ngn !== null && li.unit_price_ngn !== undefined
          ? li.unit_price_ngn
          : prior.unit_price_ngn,
      );
      // Freeze the line's original tax treatment. `taxable === false` makes
      // totals.js use rate 0; otherwise product_vat is the rate it applies.
      const priorRate = money(prior.tax_rate || 0);
      ctx.taxable = priorRate.gt(0);
      ctx.product_vat = prior.tax_rate;
      // Keep the historical COGS snapshot — an amendment is not a revaluation.
      ctx.cost_price_ngn = prior.unit_cost_ngn;
      // The line's own campaign discount, carried per UNIT so a quantity
      // change scales it. Order-level discounts are handled separately (they
      // are re-allocated across the whole new cart), so they must not be
      // double-counted from the stored line_discount_ngn — which is why the
      // per-line share is read from the discount ledger, not the line.
      const perLine = money(prior._per_line_discount_ngn || 0);
      const priorQty = Number(prior.quantity) || 1;
      perUnitDiscount = perLine.dividedBy(priorQty);
    } else {
      unit = money(
        li.unit_price_ngn !== null && li.unit_price_ngn !== undefined
          ? li.unit_price_ngn
          : (channelPrice(ctx, order.sales_channel) ?? 0),
      );
    }

    built.push({
      li: {
        ...li,
        // totals.js reads these off `li`; a kept line keeps its original
        // snapshot text unless the operator supplied a replacement.
        product_name_snapshot:
          li.product_name_snapshot ??
          (prior ? prior.product_name_snapshot : undefined),
        variant_label_snapshot:
          li.variant_label_snapshot ??
          (prior ? prior.variant_label_snapshot : undefined),
        sku_snapshot: li.sku_snapshot ?? (prior ? prior.sku_snapshot : undefined),
        line_kind: li.line_kind ?? (prior ? prior.line_kind : undefined),
        styled_id: li.styled_id ?? (prior ? prior.styled_id : undefined),
        service_offering_id:
          li.service_offering_id ??
          (prior ? prior.service_offering_id : undefined),
        notes: li.notes ?? (prior ? prior.notes : undefined),
      },
      ctx,
      unit,
      perUnitDiscount,
      prior,
    });
  }

  // §6.25: an order-level discount may never push a line below the variant's
  // min_price. A kept line's carried-forward discount is re-checked here too —
  // if the floor moved since the order was placed, the clamp catches it.
  clampToMarginFloor(built);
  return built;
}

/**
 * Carry the order's ORDER-LEVEL discounts (coupon, loyalty points, bundle,
 * referral, campaign deal ladder) onto the new cart.
 *
 * These were granted to the customer at checkout and, for coupons and points,
 * already SPENT against her balance on order.paid — so they cannot be
 * re-resolved and must not be dropped. They are re-allocated as a flat naira
 * total across the replacement lines.
 *
 * Floor-FREE allocation, matching the campaign-deal policy (CONFORMANCE_GAPS
 * G-1): the customer was already shown and charged this saving, so clamping it
 * to the margin floor now would quietly overcharge her on the swap.
 *
 * free_shipping rows are excluded: their value was applied by zeroing the
 * order's shipping_fee_ngn, which the amendment carries forward as-is. Adding
 * them to the line allocation would give the saving twice.
 */
async function reallocateOrderDiscounts({ client, brand, order, alloc }) {
  const rows = await amendRepo.listOrderLevelDiscounts({
    client,
    brand,
    order_id: order.order_id,
  });
  let carried = money(0);
  let freeShipping = money(0);
  for (const d of rows) {
    if (d.discount_type === "free_shipping") {
      freeShipping = freeShipping.plus(money(d.amount_ngn));
      continue;
    }
    carried = carried.plus(money(d.amount_ngn));
  }
  const applied = carried.gt(0) ? alloc.applyFloorFreeDiscount(carried) : money(0);
  return { requested: carried, applied, freeShipping, rows };
}

// ── The plan ────────────────────────────────────────────────

/**
 * Everything an amendment would do, computed without writing anything.
 *
 * Shared by the preview endpoint (which the Change Order modal calls on every
 * keystroke-settled change, so the operator sees the real difference before
 * committing) and by the commit itself — so what the modal promised and what
 * the transaction does are computed by the same code, not two drifting copies.
 */
async function buildPlan({ client, brand, order, input }) {
  const cfg = await businessConfig.findByKey(brand);
  const defaultVat = money(cfg ? cfg.vat_rate : 0);

  // Per-line campaign discount for each existing line, read from the ledger
  // rather than the line's own line_discount_ngn (which also contains the
  // line's share of order-level discounts — see reallocateOrderDiscounts).
  const allDiscounts = await repo.listDiscounts({
    client,
    brand,
    order_id: order.order_id,
  });
  const perLineDiscount = new Map();
  for (const d of allDiscounts) {
    if (!d.applied_to_line_id) continue;
    perLineDiscount.set(
      d.applied_to_line_id,
      money(perLineDiscount.get(d.applied_to_line_id) || 0).plus(
        money(d.amount_ngn),
      ),
    );
  }
  const beforeLines = (order.lines || []).map((l) => ({
    ...l,
    _per_line_discount_ngn: toCurrencyString(
      money(perLineDiscount.get(l.line_id) || 0),
    ),
  }));

  const built = await buildLines({
    client,
    brand,
    order: { ...order, lines: beforeLines },
    inputLines: input.lines,
  });

  const alloc = createDiscountAllocator(built);
  const carriedDiscounts = await reallocateOrderDiscounts({
    client,
    brand,
    order,
    alloc,
  });

  const { subtotal, discountTotal, taxTotal, lineRows } = computeTotalsAndLines({
    built,
    extraShareByIdx: alloc.extraShareByIdx,
    defaultVat,
  });

  // Shipping: the operator's new figure when they set one, else whatever the
  // order already carries (already net of any free-shipping coupon).
  const shipping =
    input.shipping_fee_ngn !== undefined && input.shipping_fee_ngn !== null
      ? money(input.shipping_fee_ngn)
      : money(order.shipping_fee_ngn || 0);
  const total = subtotal.minus(discountTotal).plus(taxTotal).plus(shipping);

  // Stitch the provenance back on: lineRows is positional, built is the same
  // order, so index alignment is exact.
  const afterLines = lineRows.map((lr, idx) => ({
    ...lr,
    _source_line_id: built[idx].prior ? built[idx].prior.line_id : null,
    _campaign_per_line_discount_ngn: toCurrencyString(
      built[idx].perUnitDiscount.times(built[idx].li.quantity),
    ),
  }));

  const lineChanges = buildLineChanges(beforeLines, afterLines);
  const stockDelta = netVariantDelta(beforeLines, afterLines);
  const removedLineIds = beforeLines
    .filter((b) => !afterLines.some((a) => a._source_line_id === b.line_id))
    .map((b) => b.line_id);

  // ── Delivery ──────────────────────────────────────────────
  const deliveryBefore = {
    order_type: order.order_type,
    shipping_fee_ngn: String(order.shipping_fee_ngn || "0"),
    address: order.delivery_address_snapshot || null,
  };
  const addressAfter = input.delivery_address
    ? { ...(order.delivery_address_snapshot || {}), ...input.delivery_address }
    : (order.delivery_address_snapshot || null);
  const deliveryAfter = {
    order_type: input.order_type || order.order_type,
    shipping_fee_ngn: toCurrencyString(shipping),
    address: addressAfter,
  };
  const addressMoved =
    !!input.delivery_address &&
    DELIVERY_FIELDS.some(
      (f) =>
        ((order.delivery_address_snapshot || {})[f] ?? null) !==
        (addressAfter ? (addressAfter[f] ?? null) : null),
    );
  const deliveryTouched =
    addressMoved ||
    deliveryBefore.order_type !== deliveryAfter.order_type ||
    !money(deliveryBefore.shipping_fee_ngn).eq(shipping);

  const before = {
    subtotal_ngn: String(order.subtotal_ngn),
    discount_amount_ngn: String(order.discount_amount_ngn),
    tax_amount_ngn: String(order.tax_amount_ngn),
    shipping_fee_ngn: String(order.shipping_fee_ngn),
    total_ngn: String(order.total_ngn),
  };
  const after = {
    subtotal_ngn: toCurrencyString(subtotal),
    discount_amount_ngn: toCurrencyString(discountTotal),
    tax_amount_ngn: toCurrencyString(taxTotal),
    shipping_fee_ngn: toCurrencyString(shipping),
    total_ngn: toCurrencyString(total),
  };
  const amountPaid = money(order.amount_paid_ngn || 0);
  const difference = total.minus(money(order.total_ngn));
  const balanceAfter = total.minus(amountPaid);

  return {
    beforeLines,
    afterLines,
    lineChanges,
    stockDelta,
    removedLineIds,
    before,
    after,
    difference,
    balanceAfter,
    amountPaid,
    deliveryBefore,
    deliveryAfter,
    deliveryTouched,
    addressMoved,
    carriedDiscounts,
    changed: lineChanges.length > 0 || deliveryTouched,
  };
}

/**
 * Everything the operator must positively acknowledge before the change lands.
 *
 * These are not errors: each one describes a real, permitted consequence of
 * amending an order this far along. The Change Order modal renders them and
 * the commit refuses without `acknowledge_warnings`, so nobody swaps a wig on
 * a parcel that is already on a bike without knowing it.
 */
async function buildWarnings({ client, brand, order, plan, revenueRecognised }) {
  const warnings = [];

  if (revenueRecognised && plan.difference.lt(0)) {
    warnings.push({
      code: "REFUND_DUE",
      message: `This change reduces the order by ${toCurrencyString(plan.difference.abs())}. That money stays as a credit on the customer's account — Finance decides whether to refund it.`,
    });
  }
  if (order.status === "dispatched") {
    warnings.push({
      code: "ORDER_DISPATCHED",
      message:
        "This order has already been dispatched. Changing the items now will not change what the courier is carrying.",
    });
  }

  const delivery = await logisticsRepo.liveDeliveryForOrder({
    client,
    brand,
    order_id: order.order_id,
  });
  if (delivery && DELIVERY_GONE.has(delivery.status)) {
    warnings.push({
      code: "DELIVERY_IN_TRANSIT",
      message: `Delivery ${delivery.delivery_number} is already ${delivery.status.replace(/_/g, " ")}. The parcel's contents will not be updated.`,
    });
  }

  if (plan.removedLineIds.length) {
    const jobs = await serviceJobsRepo.jobsForLines({
      client,
      brand,
      line_ids: plan.removedLineIds,
    });
    const live = jobs.filter((j) => !JOB_CLOSED.has(j.status));
    const finished = live.filter((j) => JOB_DONE.has(j.status));
    const started = live.filter(
      (j) => !JOB_DONE.has(j.status) && j.started_at,
    );
    if (finished.length) {
      warnings.push({
        code: "STUDIO_WORK_DONE",
        message: `${finished.length} styling job${finished.length === 1 ? " has" : "s have"} already been completed for the item${finished.length === 1 ? "" : "s"} you are removing. ${finished.length === 1 ? "It" : "They"} will be left open for the Studio to reassign, not cancelled.`,
      });
    }
    if (started.length) {
      warnings.push({
        code: "STUDIO_WORK_STARTED",
        message: `${started.length} styling job${started.length === 1 ? " is" : "s are"} already under way and will be cancelled. Let the Studio know before you save.`,
      });
    }
  }

  if (
    plan.carriedDiscounts.freeShipping.gt(0) &&
    !money(plan.after.shipping_fee_ngn).eq(money(plan.before.shipping_fee_ngn))
  ) {
    warnings.push({
      code: "FREE_SHIPPING_OVERRIDDEN",
      message:
        "This order carried a free-delivery coupon. Changing the delivery fee overrides it — check the new fee is what you mean to charge.",
    });
  }
  if (plan.carriedDiscounts.applied.lt(plan.carriedDiscounts.requested)) {
    const lost = plan.carriedDiscounts.requested.minus(
      plan.carriedDiscounts.applied,
    );
    warnings.push({
      code: "DISCOUNT_CLIPPED",
      message: `The new items cannot absorb ${toCurrencyString(lost)} of the discounts already on this order, so that much of the saving is lost. Reduce the price manually if the customer was promised it.`,
    });
  }

  // Can the added units actually be found? A read-only availability check so
  // the modal can warn before the operator commits; the reserve/deduct below
  // is still the authority.
  const loc = await stockRepo.getDefaultLocation({ client, brand });
  const short = [];
  if (loc) {
    for (const [variant_id, delta] of plan.stockDelta) {
      if (delta <= 0) continue;
      const level = await stockRepo.levelFor({
        client,
        brand,
        variant_id,
        location_id: loc.location_id,
      });
      const available = level ? Number(level.available || 0) : 0;
      if (available < delta) {
        const line = plan.afterLines.find((l) => l.variant_id === variant_id);
        short.push({
          variant_id,
          name: line ? describeLine(line) : "Item",
          wanted: delta,
          available,
        });
      }
    }
  }
  if (short.length) {
    warnings.push({
      code: "STOCK_SHORT",
      message: `${short.length === 1 ? "1 item is" : `${short.length} items are`} not in stock and will be recorded as a pre-order: ${short
        .map((s) => `${s.name} (want ${s.wanted}, have ${s.available})`)
        .join("; ")}.`,
      details: short,
    });
  }

  return { warnings, delivery };
}

// ── Preview (read-only) ─────────────────────────────────────

/**
 * What would change, and what it would cost — without writing anything.
 *
 * Runs in a transaction only so the pricing helpers get a client (and so the
 * availability read is consistent); nothing inside it writes, and the
 * transaction simply ends.
 */
async function previewAmendment({ brand, id, input }) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    assertAmendable(order);

    const plan = await buildPlan({ client, brand, order, input });
    const revenueRecognised = await isRevenueRecognised({ brand, order });
    const { warnings } = await buildWarnings({
      client,
      brand,
      order,
      plan,
      revenueRecognised,
    });

    return {
      order_id: order.order_id,
      order_number: order.order_number,
      status: order.status,
      revenue_recognised: revenueRecognised,
      changed: plan.changed,
      before: plan.before,
      after: plan.after,
      difference_ngn: toCurrencyString(plan.difference),
      amount_paid_ngn: toCurrencyString(plan.amountPaid),
      balance_after_ngn: toCurrencyString(plan.balanceAfter),
      line_changes: plan.lineChanges,
      lines_after: plan.afterLines.map(publicLine),
      delivery_before: plan.deliveryBefore,
      delivery_after: plan.deliveryAfter,
      delivery_changed: plan.deliveryTouched,
      warnings,
      summary: summariseChanges(plan.lineChanges),
    };
  });
}

/**
 * Strip the planner's bookkeeping fields before a line reaches the DB.
 *
 * buildPlan hangs `_source_line_id` and the campaign-share figure off each row
 * so the diff, the discount ledger and the persister can all read one array.
 * None of them are columns, and repo.insertLine's whitelist would drop them
 * silently — being explicit here means a future column addition can't quietly
 * start persisting a planner internal.
 */
function toDbLine(l) {
  const out = {};
  for (const [k, v] of Object.entries(l)) {
    if (k.startsWith("_")) continue;
    out[k] = v;
  }
  return out;
}

/** The line shape the Change Order modal renders — no cost, no internals. */
function publicLine(l) {
  return {
    line_id: l._source_line_id,
    product_name_snapshot: l.product_name_snapshot,
    variant_label_snapshot: l.variant_label_snapshot,
    sku_snapshot: l.sku_snapshot,
    quantity: l.quantity,
    unit_price_ngn: l.unit_price_ngn,
    line_discount_ngn: l.line_discount_ngn,
    tax_amount_ngn: l.tax_amount_ngn,
    line_total_ngn: l.line_total_ngn,
    line_kind: l.line_kind,
  };
}

function assertAmendable(order) {
  if (CLOSED_STATUSES.has(order.status)) {
    throw new AppError(
      "INVALID_STATE",
      `A '${order.status}' order cannot be changed`,
      409,
      {
        user_message:
          order.status === "completed"
            ? "This order is already completed, so it can no longer be changed. Raise a new order or a return instead."
            : `This order is ${order.status.replace(/_/g, " ")} — it can no longer be changed.`,
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
          "There's a cancellation waiting for a decision on this order. Resolve that first, then change the items.",
      },
    );
  }
}

/** Has the sale journal been posted? The authority for which world we're in. */
async function isRevenueRecognised({ brand, order }) {
  const entry = await accountingRepo.findEntryBySource({
    brand,
    source_type: "sales",
    source_id: order.order_id,
  });
  if (entry) return true;
  // Belt and braces for a settled order whose journal failed to post (a locked
  // period, a missing account): the stock has still LEFT, so the reconciler
  // must behave as though revenue was recognised or it would try to release
  // reservations that no longer exist.
  return !!order.fully_paid_at || SETTLED_STATUSES.has(order.status);
}

// ── Commit ──────────────────────────────────────────────────

async function amendOrder({ brand, user, request_id, id, input }) {
  const result = await transaction(async (client) => {
    await amendRepo.lockOrder({ client, brand, id });
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    assertAmendable(order);

    const plan = await buildPlan({ client, brand, order, input });
    if (!plan.changed) {
      throw new AppError("NO_CHANGE", "Nothing on this order changed", 422, {
        user_message:
          "Nothing changed — adjust an item or the delivery details before saving.",
      });
    }
    const revenueRecognised = await isRevenueRecognised({ brand, order });
    const { warnings, delivery } = await buildWarnings({
      client,
      brand,
      order,
      plan,
      revenueRecognised,
    });

    // Two-phase, same shape as the archive restore: the first call reports the
    // consequences and writes nothing; the operator confirms and calls again.
    if (warnings.length && input.acknowledge_warnings !== true) {
      return {
        requires_confirmation: true,
        order_number: order.order_number,
        warnings,
        difference_ngn: toCurrencyString(plan.difference),
        balance_after_ngn: toCurrencyString(plan.balanceAfter),
      };
    }

    const effects = { warnings };
    // Claimed up front because the GL delta's idempotency key is built from it
    // (the amendment row itself is written last, once every effect is known).
    const amendment_number = await amendRepo.nextAmendmentNumber({
      client,
      brand,
      order_id: id,
    });

    // ── 1. Lines ────────────────────────────────────────────
    // Kept lines are updated in place so every FK pointing at them (invoice
    // lines, Studio jobs, commission rows) survives the change.
    for (const l of plan.afterLines) {
      if (!l._source_line_id) continue;
      await amendRepo.updateLine({
        client,
        brand,
        line_id: l._source_line_id,
        patch: {
          quantity: l.quantity,
          unit_price_ngn: l.unit_price_ngn,
          line_discount_ngn: l.line_discount_ngn,
          tax_rate: l.tax_rate,
          tax_amount_ngn: l.tax_amount_ngn,
          line_total_ngn: l.line_total_ngn,
          display_order: l.display_order,
          notes: l.notes,
        },
      });
      // Keep the line's own discount ledger row in step with its new quantity;
      // the next amendment recovers the per-unit saving by dividing this by the
      // line's quantity, so a stale amount compounds.
      await amendRepo.setLineDiscountAmount({
        client,
        brand,
        line_id: l._source_line_id,
        amount_ngn: l._campaign_per_line_discount_ngn,
      });
    }
    const insertedLines = [];
    for (const l of plan.afterLines) {
      if (l._source_line_id) continue;
      insertedLines.push(
        await repo.insertLine({
          client,
          brand,
          line: { ...toDbLine(l), order_id: order.order_id },
        }),
      );
    }
    // A carried discount the new cart couldn't absorb was clipped (the operator
    // saw the DISCOUNT_CLIPPED warning). The order's discount_amount_ngn counts
    // only what actually applied, so the ledger rows have to come down with it
    // or the breakdown stops tying out to the total.
    await clipOrderDiscountRows({ client, brand, plan });
    // Studio jobs must be read (and decided on) BEFORE the lines go: the FK is
    // ON DELETE SET NULL, so once a line is gone its jobs are unattributable.
    const studio = await reconcileStudio({
      client,
      brand,
      user,
      order,
      plan,
      request_id,
    });
    effects.studio = studio;
    await amendRepo.deleteLines({
      client,
      brand,
      line_ids: plan.removedLineIds,
    });

    // ── 2. Order money ──────────────────────────────────────
    await amendRepo.setOrderTotals({
      client,
      brand,
      id,
      totals: plan.after,
    });
    if (plan.deliveryTouched || input.customer_notes !== undefined) {
      await amendRepo.setDeliveryDetails({
        client,
        brand,
        id,
        order_type: input.order_type,
        address_snapshot: plan.addressMoved ? plan.deliveryAfter.address : null,
        customer_notes: input.customer_notes,
      });
    }

    // ── 3. Stock ────────────────────────────────────────────
    const stock = await reconcileStock({
      client,
      brand,
      user,
      order,
      plan,
      revenueRecognised,
      insertedLines,
    });
    effects.stock = stock;
    await amendRepo.refreshPreorderFlag({ client, brand, id });

    // ── 4. Accounting ───────────────────────────────────────
    let journalEntryId = null;
    if (revenueRecognised) {
      journalEntryId = await postAmendmentJournal({
        client,
        brand,
        user,
        order,
        plan,
        amendment_number,
        cogsAdded: stock.cogs_added_ngn,
      });
    }
    effects.gl = {
      posted: !!journalEntryId,
      entry_id: journalEntryId,
      reason: revenueRecognised
        ? undefined
        : "revenue not yet recognised — the order.paid journal will use the final figures",
    };

    // ── 5. Order status ─────────────────────────────────────
    const updated = await repo.findById({ client, brand, id });
    effects.status = await reconcileStatus({
      client,
      brand,
      user,
      request_id,
      order: updated,
      wasRecognised: revenueRecognised,
    });

    // ── 6. Invoice ──────────────────────────────────────────
    const fresh = await repo.findById({ client, brand, id });
    const invoice = await invoicingService.resyncFromOrder({
      client,
      brand,
      order: fresh,
      user_id: user.user_id,
    });
    effects.invoice = invoice
      ? {
          invoice_id: invoice.invoice_id,
          invoice_number: invoice.invoice_number,
          status: invoice.status,
          total_ngn: invoice.total_ngn,
        }
      : { revised: false };

    // ── 7. Logistics ────────────────────────────────────────
    effects.logistics = await reconcileDelivery({
      client,
      brand,
      order: fresh,
      plan,
      delivery,
    });

    // ── 8. The audit spine ──────────────────────────────────
    const amendment = await amendRepo.insertAmendment({
      client,
      brand,
      row: {
        order_id: id,
        amendment_number,
        reason: input.reason,
        reason_category: input.reason_category || "other",
        subtotal_before_ngn: plan.before.subtotal_ngn,
        discount_before_ngn: plan.before.discount_amount_ngn,
        tax_before_ngn: plan.before.tax_amount_ngn,
        shipping_before_ngn: plan.before.shipping_fee_ngn,
        total_before_ngn: plan.before.total_ngn,
        subtotal_after_ngn: plan.after.subtotal_ngn,
        discount_after_ngn: plan.after.discount_amount_ngn,
        tax_after_ngn: plan.after.tax_amount_ngn,
        shipping_after_ngn: plan.after.shipping_fee_ngn,
        total_after_ngn: plan.after.total_ngn,
        amount_paid_ngn: toCurrencyString(plan.amountPaid),
        balance_after_ngn: toCurrencyString(plan.balanceAfter),
        lines_before: plan.beforeLines.map(publicLine_before),
        lines_after: plan.afterLines.map(publicLine),
        line_changes: plan.lineChanges,
        delivery_before: plan.deliveryTouched ? plan.deliveryBefore : null,
        delivery_after: plan.deliveryTouched ? plan.deliveryAfter : null,
        effects,
        order_status_before: order.status,
        revenue_recognised: revenueRecognised,
        journal_entry_id: journalEntryId,
        amended_by: user.user_id || null,
        amended_by_name: user.display_name || user.email || null,
      },
    });
    await amendRepo.bumpAmendmentCounters({ client, brand, id });

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.amend",
      target_type: "sales_order",
      target_id: id,
      before: { ...plan.before, lines: plan.beforeLines.length },
      after: { ...plan.after, lines: plan.afterLines.length },
      request_id,
      metadata: {
        amendment_id: amendment.amendment_id,
        amendment_number,
        reason: input.reason,
        reason_category: input.reason_category || "other",
        difference_ngn: toCurrencyString(plan.difference),
        revenue_recognised: revenueRecognised,
      },
    });

    // Customer-facing tracker entry, written on THIS client so it commits with
    // the change (timelineService.record opens its own transaction, which would
    // leave an orphan entry behind if the amendment later rolled back).
    //
    // Best-effort inside a savepoint: order_timeline_events.event_code is a
    // hard FK into shared.timeline_event_codes, seeded by migration 000379 — a
    // deployment where the shared migration hasn't run yet must not lose the
    // amendment over a missing dictionary row.
    await withSavepoint(client, () =>
      timelineRepo.insert({
        client,
        brand,
        event: {
          sales_order_id: id,
          event_code: "order_amended",
          label: "Order Updated",
          source_module: "sales",
          is_customer_visible: true,
          customer_payload: {
            summary: summariseChanges(plan.lineChanges),
            new_total_ngn: plan.after.total_ngn,
            balance_due_ngn: toCurrencyString(plan.balanceAfter),
          },
          internal_payload: {
            amendment_id: amendment.amendment_id,
            reason: input.reason,
            amended_by: user.display_name || user.user_id || null,
          },
          recorded_by: user.user_id || null,
        },
      }),
    ).catch((err) =>
      logger.warn(
        { err: err.message, order_id: id },
        "amendment timeline entry skipped",
      ),
    );

    // Post-commit fan-out (H-2): the customer's letter, the re-rendered
    // invoice PDF, and any Studio job the new items need. Deduped per
    // AMENDMENT, so a second change to the same order sends a second letter —
    // which is correct.
    await outbox.enqueue(client, {
      business: brand,
      event_type: "order.amended",
      payload: {
        brand,
        order_id: id,
        amendment_id: amendment.amendment_id,
        contact_id: order.contact_id,
        notify_customer: input.notify_customer !== false,
        summary: summariseChanges(plan.lineChanges),
        difference_ngn: toCurrencyString(plan.difference),
        balance_after_ngn: toCurrencyString(plan.balanceAfter),
        total_ngn: plan.after.total_ngn,
        revenue_recognised: revenueRecognised,
      },
      dedup_key: `order.amended:${amendment.amendment_id}`,
    });
    events.emit("order.updated", { brand, order_id: id });

    return {
      requires_confirmation: false,
      order: await repo.findById({ client, brand, id }),
      amendment,
      warnings,
      difference_ngn: toCurrencyString(plan.difference),
      balance_after_ngn: toCurrencyString(plan.balanceAfter),
    };
  });
  return result;
}

/** The before-snapshot shape stored on the amendment (mirrors publicLine). */
function publicLine_before(l) {
  return {
    line_id: l.line_id,
    product_name_snapshot: l.product_name_snapshot,
    variant_label_snapshot: l.variant_label_snapshot,
    sku_snapshot: l.sku_snapshot,
    quantity: l.quantity,
    unit_price_ngn: l.unit_price_ngn,
    line_discount_ngn: l.line_discount_ngn,
    tax_amount_ngn: l.tax_amount_ngn,
    line_total_ngn: l.line_total_ngn,
    line_kind: l.line_kind,
  };
}

// ── Reconcilers ─────────────────────────────────────────────

/**
 * Bring the order-level discount ledger down to what the new cart could
 * actually absorb.
 *
 * Only runs when the allocator clipped the carried total (a much cheaper
 * replacement cart than the one the discount was granted against). Rows are
 * reduced largest-first so a single big coupon takes the whole hit rather than
 * every row being shaved by a fraction, and a row that reaches zero is deleted
 * — the CHECK on the table requires a positive amount. free_shipping rows are
 * never touched: their value lives in shipping_fee_ngn, not in the allocation.
 */
async function clipOrderDiscountRows({ client, brand, plan }) {
  const { requested, applied, rows } = plan.carriedDiscounts;
  if (!requested.gt(0) || applied.gte(requested)) return;

  const targets = rows
    .filter((d) => d.discount_type !== "free_shipping")
    .sort((a, b) => Number(b.amount_ngn) - Number(a.amount_ngn));
  let left = applied;
  for (const d of targets) {
    const own = money(d.amount_ngn);
    const keep = left.gte(own) ? own : left;
    left = left.minus(keep);
    if (keep.eq(own)) continue; // untouched
    await amendRepo.setDiscountAmount({
      client,
      brand,
      discount_id: d.discount_id,
      amount_ngn: toCurrencyString(keep),
    });
  }
}

/**
 * Move the physical stock to match the new order.
 *
 * Works from the NET per-variant delta, never per line. Swapping "Medium" for
 * "Large" of the same base is one release and one reserve of different
 * variants; bumping the same variant from 1 to 3 is a single +2. Doing it per
 * line would release and immediately re-reserve identical units — and fail the
 * second half when it was the last one on the shelf.
 *
 * Which ledger it works in depends on whether revenue was recognised:
 *   • not recognised — the order only HOLDS units: release / reserve.
 *   • recognised     — the units have LEFT: return / deduct. Returns post
 *     their own DR Inventory / CR COGS; the deduction's COGS is summed here
 *     and folded into the amendment journal.
 *
 * Nothing here may fail the amendment. A unit that cannot be found becomes a
 * pre-order line (exactly as it would at checkout) and a warning on the
 * record — the customer's order must not be lost because a shelf was empty.
 */
async function reconcileStock({
  client,
  brand,
  user,
  order,
  plan,
  revenueRecognised,
  insertedLines,
}) {
  const out = {
    returned: [],
    released: [],
    reserved: [],
    deducted: [],
    preorder: [],
    cogs_added_ngn: "0.00",
  };
  const loc = await stockRepo.getDefaultLocation({ client, brand });
  if (!loc) {
    out.skipped = "no active stock location";
    return out;
  }

  // Cost basis for the units being added, taken from the line snapshots the
  // re-pricer just built (a kept line carries its original cost; a new line
  // the variant's current one) — the same basis deductForSale would use.
  const costByVariant = new Map();
  for (const l of plan.afterLines) {
    if (l.variant_id && l.unit_cost_ngn !== null && l.unit_cost_ngn !== undefined) {
      costByVariant.set(l.variant_id, l.unit_cost_ngn);
    }
  }
  let cogsAdded = money(0);

  for (const [variant_id, delta] of plan.stockDelta) {
    if (delta < 0) {
      let toGiveBack = Math.abs(delta);
      if (revenueRecognised) {
        // Only ever give back what THIS order actually took. A line that went
        // in as a pre-order was never deducted, so it has nothing to return —
        // its hold (if any) is released below instead.
        const sold = await stockRepo.netSoldForOrder({
          client,
          brand,
          variant_id,
          location_id: loc.location_id,
          reference_id: order.order_id,
        });
        const returnQty = Math.min(toGiveBack, sold);
        if (returnQty > 0) {
          const before = plan.beforeLines.find(
            (l) => l.variant_id === variant_id,
          );
          await stockService.returnFromSale({
            client,
            brand,
            variant_id,
            location_id: loc.location_id,
            quantity: returnQty,
            reference_id: order.order_id,
            unit_cost_ngn: before ? before.unit_cost_ngn : null,
            user_id: user.user_id,
            reason: `Order amended — ${order.order_number}`,
          });
          out.returned.push({ variant_id, quantity: returnQty });
          toGiveBack -= returnQty;
        }
      }
      if (toGiveBack > 0) {
        const released = await stockService.releaseOrderReservation({
          client,
          brand,
          variant_id,
          location_id: loc.location_id,
          quantity: toGiveBack,
          reference_id: order.order_id,
          user_id: user.user_id,
          reason: `Order amended — ${order.order_number}`,
        });
        if (released) out.released.push({ variant_id, quantity: toGiveBack });
      }
      continue;
    }

    // delta > 0 — the order now needs more of this variant.
    const qty = delta;
    const unitCost = costByVariant.get(variant_id) ?? null;
    let failure = null;
    try {
      await withSavepoint(client, async () => {
        if (revenueRecognised) {
          await stockService.deductForSale({
            client,
            brand,
            variant_id,
            location_id: loc.location_id,
            quantity: qty,
            reference_id: order.order_id,
            sales_channel: order.sales_channel,
            unit_cost_ngn: unitCost,
            user_id: user.user_id,
          });
        } else {
          await stockService.reserveForOrder({
            client,
            brand,
            variant_id,
            location_id: loc.location_id,
            quantity: qty,
            reference_id: order.order_id,
            user_id: user.user_id,
          });
        }
      });
    } catch (err) {
      failure = err;
    }
    if (!failure) {
      if (revenueRecognised) {
        out.deducted.push({ variant_id, quantity: qty });
        if (unitCost) cogsAdded = cogsAdded.plus(money(unitCost).times(qty));
      } else {
        out.reserved.push({ variant_id, quantity: qty });
      }
      continue;
    }

    // Short. Record the added line(s) for this variant as a pre-order — the
    // same outcome checkout produces, so the customer is told a production
    // window rather than losing the item.
    const shortLines = insertedLines.filter((l) => l.variant_id === variant_id);
    if (shortLines.length) {
      await repo.markLinesPreorder({
        client,
        brand,
        line_ids: shortLines.map((l) => l.line_id),
      });
    }
    out.preorder.push({
      variant_id,
      quantity: qty,
      reason: failure.message,
    });
    logger.info(
      {
        err: failure.message,
        order_id: order.order_id,
        variant_id,
        quantity: qty,
        revenue_recognised: revenueRecognised,
      },
      "amendment: stock short — added units recorded as pre-order",
    );
  }

  if (out.preorder.length) {
    const policy = await repo.getPreorderPolicy({ client, brand });
    const weeks = policy.max_weeks || policy.min_weeks || 0;
    await repo.markOrderPreorder({
      client,
      brand,
      order_id: order.order_id,
      ready_by: weeks
        ? new Date(Date.now() + weeks * 7 * 86_400_000).toISOString().slice(0, 10)
        : null,
      min_weeks: policy.min_weeks,
      max_weeks: policy.max_weeks,
    });
  }

  out.cogs_added_ngn = toCurrencyString(cogsAdded);
  return out;
}

/**
 * What happens to the styling work when its line leaves the order.
 *
 * Not-yet-finished jobs are cancelled: nobody should keep styling a wig the
 * customer is no longer buying. Finished ones are deliberately LEFT ALONE —
 * the labour happened, the stylist's scorecard and any agreed cost are real,
 * and cancelling a completed job would quietly erase both. The Studio sees it
 * as an unattached finished job (the line FK nulls itself on delete) and can
 * reassign the unit to stock or to another order.
 *
 * Jobs for ADDED lines are opened post-commit by the amendment subscriber, and
 * only when the order is far enough along to warrant production — createForOrder
 * is idempotent per line, so it opens exactly the shortfall.
 */
async function reconcileStudio({ client, brand, user, order, plan, request_id }) {
  const out = { cancelled_job_ids: [], left_open_job_ids: [] };
  if (!plan.removedLineIds.length) return out;

  const jobs = await serviceJobsRepo.jobsForLines({
    client,
    brand,
    line_ids: plan.removedLineIds,
  });
  for (const job of jobs) {
    if (JOB_CLOSED.has(job.status)) continue;
    if (JOB_DONE.has(job.status)) {
      out.left_open_job_ids.push(job.job_id);
      continue;
    }
    await serviceJobsRepo.setServiceJobStatus({
      client,
      brand,
      id: job.job_id,
      status: "cancelled",
      fields: { cancelled_at: new Date().toISOString() },
    });
    out.cancelled_job_ids.push(job.job_id);
    await audit({
      business: brand,
      user_id: user.user_id,
      user_name: user.display_name || user.email || "system",
      action_key: "service_jobs.cancelled_by_order_amendment",
      target_type: "service_job",
      target_id: job.job_id,
      after: {
        from: job.status,
        to: "cancelled",
        order_number: order.order_number,
      },
      request_id,
    });
  }
  return out;
}

/**
 * Keep the parcel honest.
 *
 * The manifest is re-derived from the order's new lines while the delivery is
 * still ours to change (queued or booked but not yet collected), and the
 * address follows the order's. Once a courier has it, we touch nothing and say
 * so — the operator was already warned before committing.
 */
async function reconcileDelivery({ client, brand, order, plan, delivery }) {
  if (!delivery) return { delivery_id: null, resynced: false };
  if (DELIVERY_GONE.has(delivery.status)) {
    return {
      delivery_id: delivery.delivery_id,
      resynced: false,
      reason: `delivery already ${delivery.status}`,
    };
  }
  const items = (order.lines || [])
    .filter((l) => l.variant_id)
    .map((l) => ({
      source_type: "sales_order_line",
      source_id: l.line_id,
      variant_id: l.variant_id,
      description:
        [l.product_name_snapshot, l.variant_label_snapshot]
          .filter(Boolean)
          .join(" — ") ||
        l.product_name_snapshot ||
        "Item",
      quantity: l.quantity,
    }));
  await logisticsRepo.replaceDeliveryItems({
    client,
    brand,
    delivery_id: delivery.delivery_id,
    items,
  });
  let addressUpdated = false;
  if (plan.addressMoved && plan.deliveryAfter.address) {
    await logisticsRepo.setDeliveryAddress({
      client,
      brand,
      delivery_id: delivery.delivery_id,
      address_snapshot: plan.deliveryAfter.address,
      recipient_name: plan.deliveryAfter.address.recipient_name,
      recipient_phone: plan.deliveryAfter.address.recipient_phone,
    });
    addressUpdated = true;
  }
  return {
    delivery_id: delivery.delivery_id,
    delivery_number: delivery.delivery_number,
    status: delivery.status,
    resynced: true,
    item_count: items.length,
    address_updated: addressUpdated,
  };
}

/**
 * The GL difference — see sales.postings.buildAmendmentLines for the shape.
 *
 * Posted as source_type 'accrual', NOT 'sales'. Migration 000204 puts a partial
 * UNIQUE index on journal_entries(source_id) WHERE source_type='sales' — there
 * is exactly one sale journal per order, and that is the invariant the whole
 * order.paid idempotency rests on. An amendment is an adjusting entry against
 * that recognised sale, so it carries its own source_table
 * ('sales_order_amendments'), and `idempotency_key` keyed on the order plus the
 * amendment sequence gives it the same "post exactly once" guarantee via the
 * generalised index from 000226.
 */
async function postAmendmentJournal({
  client,
  brand,
  user,
  order,
  plan,
  amendment_number,
  cogsAdded,
}) {
  const netBefore = money(plan.before.subtotal_ngn).minus(
    money(plan.before.discount_amount_ngn),
  );
  const netAfter = money(plan.after.subtotal_ngn).minus(
    money(plan.after.discount_amount_ngn),
  );
  const lines = salesPostings.buildAmendmentLines({
    delta_total_ngn: toCurrencyString(plan.difference),
    delta_net_ngn: toCurrencyString(netAfter.minus(netBefore)),
    delta_shipping_ngn: toCurrencyString(
      money(plan.after.shipping_fee_ngn).minus(
        money(plan.before.shipping_fee_ngn),
      ),
    ),
    delta_tax_ngn: toCurrencyString(
      money(plan.after.tax_amount_ngn).minus(money(plan.before.tax_amount_ngn)),
    ),
    cogs_added_ngn: cogsAdded,
    revenue_account_code: revenueAccountForChannel(order.sales_channel),
    contact_id: order.contact_id,
    reference: order.order_number,
  });
  if (!lines) return null;

  const accounting = require("../accounting/accounting.service");
  const entry = await accounting.postEntry({
    client,
    brand,
    user_id: user.user_id,
    entry: {
      source_type: "accrual",
      source_table: "sales_order_amendments",
      source_id: order.order_id,
      reference: order.order_number,
      description: `Order amended (change #${amendment_number}) — ${order.order_number}`,
      idempotency_key: `order_amend:${order.order_id}:${amendment_number}`,
    },
    lines,
  });
  return entry ? entry.entry_id : null;
}

/**
 * Put the order's status back in step with its money.
 *
 * Only the PAYMENT states are touched. A wig that is already 'assigned' or
 * 'order_ready' stays there even when the swap re-opens a balance — the same
 * rule markPaid follows, because fulfilment progress is a physical fact and
 * settling money must never rewind it. The outstanding balance is expressed by
 * balance_due_ngn, which every screen already reads.
 *
 * The interesting case is the other direction: an amendment that makes the
 * order CHEAPER than what has already been paid settles it. That runs the full
 * markPaid path (stock draw, order.paid fan-out — invoice, GL, Studio,
 * logistics, comms) exactly as a final payment would, because from the
 * business's point of view the order just became fully paid.
 */
async function reconcileStatus({ client, brand, user, request_id, order, wasRecognised }) {
  const paid = money(order.amount_paid_ngn || 0);
  const total = money(order.total_ngn || 0);

  if (!wasRecognised && total.gt(0) && paid.gte(total)) {
    const salesService = require("./sales.service");
    const settled = await salesService.markPaid({
      client,
      brand,
      user,
      _request_id: request_id,
      order,
    });
    return { moved_to: settled ? settled.status : "paid", settled_by_amendment: true };
  }

  if (order.status === "paid" && paid.lt(total)) {
    const flipped = await repo.setStatus({
      client,
      brand,
      id: order.order_id,
      status: paid.gt(0) ? "partially_paid" : "pending_payment",
    });
    return { moved_to: flipped ? flipped.status : order.status };
  }

  return { moved_to: order.status, unchanged: true };
}

// ── History ─────────────────────────────────────────────────

async function listAmendments({ brand, id }) {
  const order = await repo.findById({ brand, id });
  if (!order) throw new NotFoundError("Order");
  return amendRepo.listAmendments({ brand, order_id: id });
}

module.exports = {
  previewAmendment,
  amendOrder,
  listAmendments,
  // Exported for unit tests.
  buildPlan,
  isRevenueRecognised,
  CLOSED_STATUSES,
  DELIVERY_GONE,
};
