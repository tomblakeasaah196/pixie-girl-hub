/**
 * Sales (V2.2 §6.2) — order lifecycle + cross-module wiring.
 *
 * createOrder:  builds line snapshots, applies the campaign discount via the
 *   Sales-Campaigns discount engine (single source of truth), clamps every
 *   line to the variant's min_price (the §6.25 margin floor), computes VAT
 *   and totals, persists order + lines + discount rows.
 * addPayment → markPaid:  when paid in full, deducts stock through the Stock
 *   SSOT (negative 'sale' movement), records campaign usage, and emits
 *   `order.paid` for Invoicing + Accounting to consume.
 */

"use strict";

const repo = require("./sales.repo");
const events = require("./sales.events");
const outbox = require("../../shared/outbox/outbox");
const discount = require("../sales_campaigns/campaigns.discount.service");
const stockService = require("../stock/stock.service");
const stockRepo = require("../stock/stock.repo");
const businessConfig = require("../business_setup/business-config.repo");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const PAID_STATES = new Set(["paid", "awaiting_dispatch", "completed"]);

function channelPrice(ctx, channel) {
  if (channel === "pos") return ctx.price_pos_ngn ?? ctx.price_storefront_ngn;
  if (channel === "wholesale" || channel === "intercompany")
    return ctx.price_wholesale_ngn ?? ctx.price_storefront_ngn;
  if (channel === "partner" || channel === "stylist_routed")
    return ctx.price_partner_ngn ?? ctx.price_storefront_ngn;
  return ctx.price_storefront_ngn ?? ctx.price_pos_ngn;
}

async function createOrder({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const cfg = await businessConfig.findByKey(brand);
    const defaultVat =
      cfg && cfg.vat_rate !== null ? money(cfg.vat_rate) : money("0.075");

    // 1. Resolve line pricing context + base unit prices.
    const built = [];
    for (const li of input.lines) {
      const ctx = await repo.variantContext({
        client,
        brand,
        variant_id: li.variant_id,
      });
      if (!ctx)
        throw new AppError(
          "REFERENCE_INVALID",
          `Variant ${li.variant_id} not found`,
          409,
        );
      const unit = money(
        li.unit_price_ngn !== null
          ? li.unit_price_ngn
          : (channelPrice(ctx, input.sales_channel) ?? 0),
      );
      built.push({ li, ctx, unit, perUnitDiscount: money(0) });
    }

    // 2. Campaign discount (engine = single source of truth), if attached.
    let campaign = null;
    const campaignRef = input.sales_campaign_id
      ? { campaign_id: input.sales_campaign_id }
      : input.campaign_slug
        ? { slug: input.campaign_slug }
        : null;
    if (campaignRef) {
      const res = await discount.resolveDiscount({
        brand,
        campaignRef,
        cart: {
          items: built.map((b) => ({
            product_id: b.ctx.product_id,
            unit_price_ngn: toCurrencyString(b.unit),
            quantity: b.li.quantity,
          })),
        },
        contact: { is_first_time: false, segment_ids: [] },
        allowStacking: false,
      });
      if (res.eligible) {
        campaign = res;
        const perUnitByProduct = new Map();
        for (const rl of res.lines) {
          perUnitByProduct.set(
            rl.product_id,
            money(rl.unit_price_ngn).minus(money(rl.discounted_unit_price_ngn)),
          );
        }
        for (const b of built) {
          const pu = perUnitByProduct.get(b.ctx.product_id);
          if (pu) b.perUnitDiscount = pu;
        }
      }
    }

    // 3. Margin-floor clamp (§6.25): never below the variant's min_price.
    for (const b of built) {
      if (b.ctx.min_price_ngn !== null) {
        const floor = money(b.ctx.min_price_ngn);
        const maxDiscount = b.unit.minus(floor);
        if (b.perUnitDiscount.gt(maxDiscount))
          b.perUnitDiscount = maxDiscount.lt(0) ? money(0) : maxDiscount;
      }
    }

    // 4. Totals + VAT.
    let subtotal = money(0),
      discountTotal = money(0),
      taxTotal = money(0);
    const lineRows = [];
    built.forEach((b, idx) => {
      const qty = b.li.quantity;
      const gross = b.unit.times(qty);
      const lineDiscount = b.perUnitDiscount.times(qty);
      const taxable = b.ctx.taxable !== false;
      const rate = taxable
        ? b.ctx.product_vat !== null
          ? money(b.ctx.product_vat)
          : defaultVat
        : money(0);
      const taxableBase = gross.minus(lineDiscount);
      const tax = taxableBase.times(rate);
      const lineTotal = taxableBase.plus(tax);
      subtotal = subtotal.plus(gross);
      discountTotal = discountTotal.plus(lineDiscount);
      taxTotal = taxTotal.plus(tax);
      lineRows.push({
        product_id: b.ctx.product_id,
        variant_id: b.li.variant_id,
        product_name_snapshot: b.ctx.product_name,
        variant_label_snapshot: b.ctx.variant_name,
        sku_snapshot: b.ctx.sku,
        quantity: qty,
        unit_price_ngn: toCurrencyString(b.unit),
        unit_cost_ngn: b.ctx.cost_price_ngn,
        line_discount_ngn: toCurrencyString(lineDiscount),
        tax_rate: rate.toFixed(4),
        tax_amount_ngn: toCurrencyString(tax),
        line_total_ngn: toCurrencyString(lineTotal),
        display_order: idx,
        notes: b.li.notes,
      });
    });
    const shipping = money(input.shipping_fee_ngn || 0);
    const total = subtotal.minus(discountTotal).plus(taxTotal).plus(shipping);

    // 4b. Payment model + deposit policy (V2.2 §6.2). The order inherits its
    // model from the first line's variant/product; deposit_triggered orders
    // snapshot the required deposit so fulfilment can unlock at the threshold.
    const paymentModel = built[0].ctx.payment_model || "layaway";
    const settings = (cfg && cfg.installment_settings) || {};
    let requiredDepositPct = null;
    let requiredDepositNgn = null;
    if (paymentModel === "deposit_triggered") {
      requiredDepositPct = money(
        input.required_deposit_pct ??
          settings.default_deposit_pct_for_deposit_triggered ??
          50,
      );
      requiredDepositNgn = total.times(requiredDepositPct).dividedBy(100);
    }

    // 5. Persist.
    const order_number = await repo.nextNumber({
      client,
      brand,
      type: "sales_order",
    });
    const order = await repo.createOrder({
      client,
      brand,
      order: {
        order_number,
        contact_id: input.contact_id,
        sales_channel: input.sales_channel,
        order_type: input.order_type || "dispatch",
        is_custom_order: input.is_custom_order || false,
        sales_campaign_id:
          input.sales_campaign_id || (campaign ? campaign.campaign_id : null),
        utm_source: input.utm_source,
        utm_medium: input.utm_medium,
        utm_campaign: input.utm_campaign || (campaign ? campaign.slug : null),
        status: "pending_payment",
        subtotal_ngn: toCurrencyString(subtotal),
        discount_amount_ngn: toCurrencyString(discountTotal),
        tax_amount_ngn: toCurrencyString(taxTotal),
        shipping_fee_ngn: toCurrencyString(shipping),
        total_ngn: toCurrencyString(total),
        payment_model: paymentModel,
        required_deposit_pct:
          requiredDepositPct !== null ? requiredDepositPct.toFixed(2) : null,
        required_deposit_ngn:
          requiredDepositNgn !== null
            ? toCurrencyString(requiredDepositNgn)
            : null,
      },
    });

    for (const lr of lineRows) {
      const line = await repo.insertLine({
        client,
        brand,
        line: { ...lr, order_id: order.order_id },
      });
      if (campaign && money(lr.line_discount_ngn).gt(0)) {
        await repo.insertDiscount({
          client,
          brand,
          disc: {
            order_id: order.order_id,
            source: "campaign",
            source_reference: campaign.slug,
            sales_campaign_id: campaign.campaign_id,
            applied_to_line_id: line.line_id,
            amount_ngn: lr.line_discount_ngn,
            discount_type:
              campaign.discount_type === "percentage"
                ? "percentage"
                : campaign.discount_type === "free_shipping"
                  ? "free_shipping"
                  : "fixed",
          },
        });
      }
    }

    // 5b. Layaway reserves stock at placement (V2.2 §6.2): the unit is held
    // but no work begins until paid in full. Best-effort — a reservation
    // hiccup must not roll back the order (storefront already gates on stock).
    if (paymentModel === "layaway") {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      if (loc) {
        for (const lr of lineRows) {
          if (!lr.variant_id) continue;
          try {
            await stockService.reserveForOrder({
              client,
              brand,
              variant_id: lr.variant_id,
              location_id: loc.location_id,
              quantity: lr.quantity,
              reference_id: order.order_id,
              user_id: user.user_id,
            });
          } catch (err) {
            logger.warn(
              { err, order_id: order.order_id, variant_id: lr.variant_id },
              "layaway reservation skipped",
            );
          }
        }
      }
    }

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.create",
      target_type: "sales_order",
      target_id: order.order_id,
      after: { order_number, total_ngn: toCurrencyString(total) },
      request_id,
    });
    events.emit("order.created", {
      brand,
      order_id: order.order_id,
      contact_id: order.contact_id,
    });
    return repo.findById({ client, brand, id: order.order_id });
  });
}

function listOrders({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listOrders({ brand, filters, page, page_size, offset });
}
async function getById({ brand, id }) {
  const o = await repo.findById({ brand, id });
  if (!o) throw new NotFoundError("Order");
  o.payments = await repo.listPayments({ brand, order_id: id });
  o.discounts = await repo.listDiscounts({ brand, order_id: id });
  return o;
}

// Edit an order while it is still editable (draft / pending_payment): header
// fields only — line edits go through dedicated add/remove-line endpoints.
async function updateOrder({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("Order");
    if (!["draft", "pending_payment"].includes(before.status)) {
      throw new AppError(
        "INVALID_STATE",
        `A '${before.status}' order cannot be edited`,
        409,
      );
    }
    const updated = await repo.updateOrderHeader({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.update",
      target_type: "sales_order",
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    events.emit("order.updated", { brand, order_id: id });
    return updated;
  });
}

async function addPayment({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    if (["cancelled", "refunded"].includes(order.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot pay a ${order.status} order`,
        409,
      );

    const payment_number = await repo.nextNumber({
      client,
      brand,
      type: "sales_order_payment",
    });
    await repo.addPayment({
      client,
      brand,
      payment: {
        payment_number,
        order_id: id,
        method: input.method,
        provider: input.provider,
        provider_reference: input.provider_reference,
        amount_ngn: input.amount_ngn,
        paid_currency: input.paid_currency || null,
        paid_amount: input.paid_amount || null,
        fx_rate_used: input.fx_rate_used || null,
        fee_ngn: input.fee_ngn || 0,
        payment_path: input.payment_path,
        client_idempotency_key: input.client_idempotency_key,
        status: "captured",
        captured_at: new Date().toISOString(),
      },
    });

    // Realised FX gain/loss (V2.2 §6.6): if the customer settled in a foreign
    // currency, the NGN actually received differs from the amount the order
    // booked at its captured rate. Post the variance to the realised FX
    // account, atomic with the payment.
    if (
      input.paid_currency &&
      input.paid_currency !== "NGN" &&
      input.paid_amount &&
      order.fx_rate_used
    ) {
      const accounting = require("../accounting/accounting.service");
      const bookedNgn = money(input.paid_amount).times(
        money(order.fx_rate_used),
      );
      const deltaNgn = money(input.amount_ngn).minus(bookedNgn);
      await accounting.postFxGainLoss({
        client,
        brand,
        delta_ngn: toCurrencyString(deltaNgn),
        reference: order.order_number,
        description: `Realised FX on ${order.order_number} (${input.paid_currency})`,
        source_id: order.order_id,
        user_id: user.user_id,
      });
    }

    // Trigger recomputed amount_paid_ngn; re-read.
    const updated = await repo.findById({ client, brand, id });
    let result = updated;
    if (
      !PAID_STATES.has(updated.status) &&
      money(updated.amount_paid_ngn).gte(money(updated.total_ngn))
    ) {
      result = await markPaid({
        client,
        brand,
        user,
        request_id,
        order: updated,
      });
    } else if (
      updated.payment_model === "deposit_triggered" &&
      !updated.deposit_met_at &&
      updated.required_deposit_ngn !== null &&
      money(updated.amount_paid_ngn).gte(money(updated.required_deposit_ngn))
    ) {
      // Deposit cleared (V2.2 §6.2): unlock production now; the balance is
      // collected before dispatch via the normal full-payment path.
      const flipped = await repo.markDepositMet({ client, brand, id });
      if (flipped) {
        result = flipped;
        events.emit("order.deposit_met", {
          brand,
          order_id: id,
          contact_id: flipped.contact_id,
          required_deposit_ngn: flipped.required_deposit_ngn,
          amount_paid_ngn: flipped.amount_paid_ngn,
        });
      }
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.payment",
      target_type: "sales_order",
      target_id: id,
      after: { amount_ngn: input.amount_ngn, status: result.status },
      request_id,
    });
    events.emit("order.payment", {
      brand,
      order_id: id,
      status: result.status,
    });
    return result;
  });
}

async function markPaid({ client, brand, user, _request_id, order }) {
  const loc = await stockRepo.getDefaultLocation({ client, brand });
  if (!loc)
    throw new AppError(
      "NO_STOCK_LOCATION",
      "No active stock location to fulfil from",
      409,
    );

  for (const line of order.lines) {
    if (line.variant_id) {
      // Layaway held the unit on placement — release the reservation first
      // so the 'sale' deduction keeps reserved <= on_hand valid.
      if (order.payment_model === "layaway") {
        try {
          await stockService.releaseReservation({
            client,
            brand,
            variant_id: line.variant_id,
            location_id: loc.location_id,
            quantity: line.quantity,
            reference_id: order.order_id,
            user_id: user.user_id,
            reason: "layaway paid in full",
          });
        } catch (err) {
          logger.warn(
            { err, order_id: order.order_id, variant_id: line.variant_id },
            "layaway release on markPaid skipped",
          );
        }
      }
      await stockService.deductForSale({
        client,
        brand,
        variant_id: line.variant_id,
        location_id: loc.location_id,
        quantity: line.quantity,
        reference_id: order.order_id,
        sales_channel: order.sales_channel,
        unit_cost_ngn: line.unit_cost_ngn,
        user_id: user.user_id,
      });
    }
  }
  if (order.sales_campaign_id) {
    await discount.recordUsage({
      client,
      brand,
      campaign_id: order.sales_campaign_id,
      revenue_ngn: order.total_ngn,
      discount_ngn: order.discount_amount_ngn,
    });
  }
  const paid = await repo.setStatus({
    client,
    brand,
    id: order.order_id,
    status: "paid",
  });
  // Cross-module fan-out (H-2): enqueue `order.paid` to the transactional
  // outbox atomically with this transaction. After COMMIT the worker's
  // dispatcher invokes every registered consumer (accounting GL, invoicing,
  // commission, logistics dispatch, retention loyalty/stars, notifications)
  // post-commit, idempotently, with retry. No pre-commit emit — consumers must
  // never act on an uncommitted order.
  await outbox.enqueue(client, {
    business: brand,
    event_type: "order.paid",
    payload: {
      brand,
      order_id: order.order_id,
      contact_id: order.contact_id,
      total_ngn: order.total_ngn,
      tax_amount_ngn: order.tax_amount_ngn,
      sales_campaign_id: order.sales_campaign_id,
    },
    dedup_key: `order.paid:${order.order_id}`,
  });
  return paid;
}

async function cancelOrder({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id });
    if (!order) throw new NotFoundError("Order");
    if (PAID_STATES.has(order.status))
      throw new AppError(
        "INVALID_STATE",
        "Paid orders cannot be cancelled here (use refund)",
        409,
      );
    // Release any layaway hold so the units return to available stock.
    if (order.payment_model === "layaway") {
      const loc = await stockRepo.getDefaultLocation({ client, brand });
      if (loc) {
        for (const line of order.lines || []) {
          if (!line.variant_id) continue;
          try {
            await stockService.releaseReservation({
              client,
              brand,
              variant_id: line.variant_id,
              location_id: loc.location_id,
              quantity: line.quantity,
              reference_id: order.order_id,
              user_id: user.user_id,
              reason: "order cancelled",
            });
          } catch (err) {
            logger.warn(
              { err, order_id: id, variant_id: line.variant_id },
              "layaway release on cancel skipped",
            );
          }
        }
      }
    }
    const o = await repo.setStatus({ client, brand, id, status: "cancelled" });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.order.cancel",
      target_type: "sales_order",
      target_id: id,
      request_id,
    });
    events.emit("order.cancelled", { brand, order_id: id });
    return o;
  });
}

// ── Quotations ───────────────────────────────────────────
async function buildQuotationLines({
  client,
  brand,
  lines,
  channel = "storefront",
}) {
  const cfg = await businessConfig.findByKey(brand);
  const defaultVat =
    cfg && cfg.vat_rate !== null ? money(cfg.vat_rate) : money("0.075");
  let subtotal = money(0),
    discountTotal = money(0),
    taxTotal = money(0);
  const out = [];
  for (const [idx, li] of lines.entries()) {
    const ctx = await repo.variantContext({
      client,
      brand,
      variant_id: li.variant_id,
    });
    if (!ctx)
      throw new AppError(
        "REFERENCE_INVALID",
        `Variant ${li.variant_id} not found`,
        409,
      );
    const unit = money(
      li.unit_price_ngn !== undefined
        ? li.unit_price_ngn
        : (channelPrice(ctx, channel) ?? 0),
    );
    const lineDiscount = money(li.line_discount_ngn || 0);
    const taxable = ctx.taxable !== false;
    const rate = taxable
      ? ctx.product_vat !== null
        ? money(ctx.product_vat)
        : defaultVat
      : money(0);
    const base = unit.times(li.quantity).minus(lineDiscount);
    const tax = base.times(rate);
    subtotal = subtotal.plus(unit.times(li.quantity));
    discountTotal = discountTotal.plus(lineDiscount);
    taxTotal = taxTotal.plus(tax);
    out.push({
      product_id: ctx.product_id,
      variant_id: li.variant_id,
      product_name_snapshot: ctx.product_name,
      variant_label_snapshot: ctx.variant_name,
      sku_snapshot: ctx.sku,
      quantity: li.quantity,
      unit_price_ngn: toCurrencyString(unit),
      line_discount_ngn: toCurrencyString(lineDiscount),
      tax_rate: rate.toFixed(4),
      line_total_ngn: toCurrencyString(base.plus(tax)),
      display_order: idx,
      notes: li.notes,
    });
  }
  return { lines: out, subtotal, discountTotal, taxTotal };
}

function listQuotations({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listQuotations({ brand, filters, page, page_size, offset });
}
async function getQuotation({ brand, id }) {
  const q = await repo.findQuotationById({ brand, id });
  if (!q) throw new NotFoundError("Quotation");
  return q;
}
async function createQuotation({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const built = await buildQuotationLines({
      client,
      brand,
      lines: input.lines,
      channel: input.delivery_type,
    });
    const shipping = money(input.shipping_fee_ngn || 0);
    const total = built.subtotal
      .minus(built.discountTotal)
      .plus(built.taxTotal)
      .plus(shipping);
    const quotation_number = await repo.nextNumber({
      client,
      brand,
      type: "quotation",
    });
    const q = await repo.createQuotation({
      client,
      brand,
      user_id: user.user_id,
      quote: {
        quotation_number,
        deal_id: input.deal_id,
        contact_id: input.contact_id,
        status: "draft",
        subtotal_ngn: toCurrencyString(built.subtotal),
        discount_amount_ngn: toCurrencyString(built.discountTotal),
        tax_amount_ngn: toCurrencyString(built.taxTotal),
        shipping_fee_ngn: toCurrencyString(shipping),
        total_ngn: toCurrencyString(total),
        valid_until: input.valid_until,
        payment_terms: input.payment_terms,
        notes: input.notes,
        internal_notes: input.internal_notes,
        delivery_type: input.delivery_type,
        coupon_code: input.coupon_code,
      },
    });
    for (const lr of built.lines)
      await repo.insertQuotationLine({
        client,
        brand,
        line: { ...lr, quotation_id: q.quotation_id },
      });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.quotation.create",
      target_type: "quotation",
      target_id: q.quotation_id,
      after: { quotation_number },
      request_id,
    });
    events.emit("quotation.created", { brand, quotation_id: q.quotation_id });
    return repo.findQuotationById({ client, brand, id: q.quotation_id });
  });
}
async function sendQuotation({ brand, user, request_id, id, input = {} }) {
  return transaction(async (client) => {
    const q = await repo.findQuotationById({ client, brand, id });
    if (!q) throw new NotFoundError("Quotation");
    if (!["draft", "sent"].includes(q.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot send a '${q.status}' quotation`,
        409,
      );
    const updated = await repo.setQuotationStatus({
      client,
      brand,
      id,
      status: "sent",
      extra: {
        sent_via: input.sent_via || "email",
        sent_at: new Date().toISOString(),
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.quotation.send",
      target_type: "quotation",
      target_id: id,
      after: { sent_via: input.sent_via },
      request_id,
    });
    events.emit("quotation.sent", { brand, quotation_id: id });
    return updated;
  });
}
async function decideQuotation({
  brand,
  user,
  request_id,
  id,
  decision,
  reason,
}) {
  const status = decision === "accept" ? "accepted" : "rejected";
  const extra =
    decision === "accept"
      ? { accepted_at: new Date().toISOString() }
      : {
          rejected_at: new Date().toISOString(),
          rejection_reason: reason || null,
        };
  const updated = await repo.setQuotationStatus({ brand, id, status, extra });
  if (!updated) throw new NotFoundError("Quotation");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `sales.quotation.${decision}`,
    target_type: "quotation",
    target_id: id,
    after: { status },
    request_id,
  });
  return updated;
}
async function convertQuotation({ brand, user, request_id, id, input = {} }) {
  const q = await repo.findQuotationById({ brand, id });
  if (!q) throw new NotFoundError("Quotation");
  if (q.status === "converted")
    throw new AppError("INVALID_STATE", "Quotation already converted", 409);
  // Build a sales order from the quotation's lines.
  const order = await createOrder({
    brand,
    user,
    request_id,
    input: {
      contact_id: q.contact_id,
      sales_channel: input.sales_channel || "phone",
      order_type: q.delivery_type || "dispatch",
      lines: q.lines
        .filter((l) => l.variant_id)
        .map((l) => ({
          variant_id: l.variant_id,
          quantity: l.quantity,
          unit_price_ngn: l.unit_price_ngn,
        })),
      shipping_fee_ngn: q.shipping_fee_ngn,
    },
  });
  await repo.setQuotationStatus({
    brand,
    id,
    status: "converted",
    extra: { converted_sales_order_id: order.order_id },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales.quotation.convert",
    target_type: "quotation",
    target_id: id,
    after: { order_id: order.order_id },
    request_id,
  });
  events.emit("quotation.converted", {
    brand,
    quotation_id: id,
    order_id: order.order_id,
  });
  return order;
}

// ── Cancellation requests (§6.4 cancellation timer) ──────
function listCancellations({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listCancellations({ brand, filters, page, page_size, offset });
}
async function getCancellation({ brand, id }) {
  const c = await repo.findCancellationById({ brand, id });
  if (!c) throw new NotFoundError("Cancellation request");
  return c;
}
async function requestCancellation({
  brand,
  user,
  request_id,
  order_id,
  input,
}) {
  return transaction(async (client) => {
    const order = await repo.findById({ client, brand, id: order_id });
    if (!order) throw new NotFoundError("Order");
    if (
      ["cancelled", "refunded", "delivered", "completed"].includes(order.status)
    ) {
      throw new AppError(
        "INVALID_STATE",
        `Cannot cancel a '${order.status}' order`,
        409,
      );
    }
    const cfg = await businessConfig.findByKey(brand);
    const cs = (cfg && cfg.cancellation_settings) || {};
    const freeHours = Number(cs.free_window_hours ?? 3);
    const restockPct = Number(cs.restocking_fee_pct ?? 10);
    const customPct = Number(cs.custom_order_non_refundable_pct ?? 50);
    const freeUntil = new Date(
      new Date(order.created_at).getTime() + freeHours * 3600_000,
    );
    const withinFree = new Date() < freeUntil;
    const isCustom = order.is_custom_order === true;
    const feePct = withinFree ? 0 : isCustom ? customPct : restockPct;
    const total = money(order.total_ngn);
    const fee = total.times(money(feePct).dividedBy(100));
    const refund = total.minus(fee);
    const request_number = await repo.nextNumber({
      client,
      brand,
      type: "cancellation_request",
    });
    const cr = await repo.createCancellation({
      client,
      brand,
      row: {
        request_number,
        order_id,
        requested_by_contact_id: input.requested_by_contact_id,
        requested_by_user_id: user.user_id,
        reason: input.reason,
        reason_category: input.reason_category,
        within_free_window: withinFree,
        order_total_ngn: toCurrencyString(total),
        is_custom_order: isCustom,
        applicable_fee_pct: feePct,
        fee_amount_ngn: toCurrencyString(fee),
        refund_amount_ngn: toCurrencyString(refund),
      },
    });
    await repo.setStatus({
      client,
      brand,
      id: order_id,
      status: "cancellation_requested",
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales.cancellation.request",
      target_type: "cancellation_request",
      target_id: cr.request_id,
      after: { fee_pct: feePct, refund: toCurrencyString(refund) },
      request_id,
    });
    events.emit("cancellation.requested", {
      brand,
      order_id,
      request_id: cr.request_id,
    });
    return cr;
  });
}
async function reviewCancellation({
  brand,
  user,
  request_id,
  id,
  decision,
  notes,
}) {
  return transaction(async (client) => {
    const cr = await repo.findCancellationById({ client, brand, id });
    if (!cr) throw new NotFoundError("Cancellation request");
    if (cr.status !== "pending_review")
      throw new AppError("INVALID_STATE", `Already ${cr.status}`, 409);
    const status = decision === "approve" ? "approved" : "rejected";
    const updated = await repo.setCancellationStatus({
      client,
      brand,
      id,
      status,
      reviewer: user.user_id,
      notes,
    });
    if (decision === "approve") {
      await repo.setStatus({
        client,
        brand,
        id: cr.order_id,
        status: "cancelled",
      });
    } else {
      // Reverting: put the order back to pending_payment so it can proceed.
      await repo.setStatus({
        client,
        brand,
        id: cr.order_id,
        status: "pending_payment",
      });
    }
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: `sales.cancellation.${decision}`,
      target_type: "cancellation_request",
      target_id: id,
      after: { status },
      request_id,
    });
    events.emit("cancellation.reviewed", { brand, request_id: id, status });
    return updated;
  });
}

module.exports = {
  listOrders,
  getById,
  createOrder,
  updateOrder,
  addPayment,
  cancelOrder, // orders are cancelled (the 'archive' equivalent), never hard-deleted
  listQuotations,
  getQuotation,
  createQuotation,
  sendQuotation,
  decideQuotation,
  convertQuotation,
  listCancellations,
  getCancellation,
  requestCancellation,
  reviewCancellation,
};
