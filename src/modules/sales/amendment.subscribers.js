/**
 * Order-amendment subscriber — everything that has to happen AFTER a Change
 * Order commits (V2.2 §6.2).
 *
 * Three jobs, all post-commit via the transactional outbox (H-2) so they run
 * against a committed order, at-least-once, with retry:
 *
 *   1. Tell the customer. The `order_amended` Communications Studio automation
 *      (seeded by migration 000380) — what changed, the new total, and the pay
 *      link when the swap costs more. Honours the CEO's Messaging toggles like
 *      every other stage message; an automation switched Off simply doesn't
 *      send.
 *   2. Re-render the invoice PDF. The archived document now describes an order
 *      that no longer exists, and it is what the customer downloads from her
 *      invoice link.
 *   3. Open Studio jobs for any styling the new items need — but ONLY when the
 *      order is far enough along that production is warranted (fully paid, or
 *      a deposit-triggered order past its deposit). createForOrder is
 *      idempotent per line, so it opens exactly the shortfall and re-delivery
 *      is safe.
 *
 * Every step is individually best-effort: a Comms hiccup must not stop the PDF
 * from re-rendering, and neither must cost the Studio its job. The amendment
 * itself is already committed and is the record of what happened.
 */

"use strict";

const outbox = require("../../shared/outbox/outbox");
const salesRepo = require("./sales.repo");
const amendRepo = require("./amendment.repo");
const brandUrls = require("../../utils/brand-urls");
const commsStudio = require("../comms_studio/comms-studio.service");
const invoicingService = require("../invoicing/invoicing.service");
const invoiceDelivery = require("../invoicing/invoice-delivery.service");
const serviceJobsService = require("../service_jobs/service-jobs.service");
const { money } = require("../../utils/money");
const { logger } = require("../../config/logger");

const ngn = (v) =>
  `₦${Number(v || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * The two sentences the letter needs, worded here rather than in the template
 * so an operator can restructure the copy without the backend having to know
 * which half to hide.
 */
function moneyCopy({ difference, balance }) {
  const diff = money(difference || 0);
  const bal = money(balance || 0);

  let difference_label = "The total is unchanged.";
  if (diff.gt(0)) difference_label = `That is ${ngn(diff)} more than before.`;
  else if (diff.lt(0))
    difference_label = `That is ${ngn(diff.abs())} less than before.`;

  let balance_line;
  if (bal.gt(0)) {
    balance_line = `${ngn(bal)} is still outstanding — please complete it with the secure link below.`;
  } else if (bal.lt(0)) {
    balance_line = `You have ${ngn(bal.abs())} in credit with us from this change. We'll be in touch about returning it or holding it against your next order.`;
  } else {
    balance_line = "Nothing further is owed — your order is fully paid.";
  }
  return { difference_label, balance_line };
}

// Production is only warranted once the customer has actually committed —
// the same gate the Studio's own order.paid / order.deposit_met subscribers
// use, so an amendment can never open a job an ordinary checkout wouldn't.
//
// deposit_met_at (000393, owner directive 2026-09-29) now stamps on ANY
// payment landing, for every payment_model — not only a deposit_triggered
// custom order past its required_deposit_ngn — so a part-paid regular order
// amended with more styling units is just as "committed" as one that's paid
// in full.
function committedToProduction(order) {
  if (!order) return false;
  if (order.fully_paid_at) return true;
  return !!order.deposit_met_at;
}

async function onOrderAmended(payload) {
  const {
    brand,
    order_id,
    amendment_id,
    notify_customer,
    summary,
    difference_ngn,
    balance_after_ngn,
  } = payload || {};
  if (!brand || !order_id) return;
  const order = await salesRepo.findById({ brand, id: order_id });
  if (!order) return;

  // ── 1. The customer's letter ──────────────────────────────
  let notified = false;
  if (notify_customer !== false && order.contact_id) {
    try {
      let invoiceUrl = "";
      try {
        const invoice = await invoicingService.findByOrderId({
          brand,
          order_id,
        });
        if (invoice)
          invoiceUrl = invoiceDelivery.publicViewUrl(brand, invoice.invoice_id);
      } catch (err) {
        logger.warn(
          { err: err.message, brand, order_id },
          "order-amended: invoice lookup failed",
        );
      }
      const payUrl = await brandUrls.payLinkUrl(
        brand,
        await salesRepo.ensurePublicTrackingToken({ brand, id: order_id }),
      );
      const { difference_label, balance_line } = moneyCopy({
        difference: difference_ngn,
        balance: balance_after_ngn,
      });
      await commsStudio.dispatch({
        brand,
        event_key: "order_amended",
        contact_id: order.contact_id,
        reference_type: "sales_order",
        reference_id: order_id,
        // Per AMENDMENT, not per order: a second change to the same order is a
        // second thing the customer needs to be told about.
        dedup_key: `order_amended:${amendment_id}`,
        variables: {
          order_number: order.order_number,
          change_summary:
            summary || "Your order details have been updated.",
          total: ngn(order.total_ngn),
          difference_label,
          balance_line,
          pay_url: payUrl,
          invoice_url: invoiceUrl || payUrl,
        },
      });
      notified = true;
    } catch (err) {
      logger.error(
        { err: err.message, brand, order_id, amendment_id },
        "order-amended: customer notification failed",
      );
    }
  }

  // ── 2. Refresh the archived invoice PDF ───────────────────
  try {
    const invoice = await invoicingService.findByOrderId({ brand, order_id });
    if (invoice && !["void", "refunded"].includes(invoice.status)) {
      await invoicingService.invoicePdf({
        brand,
        user: null,
        id: invoice.invoice_id,
      });
    }
  } catch (err) {
    logger.warn(
      { err: err.message, brand, order_id },
      "order-amended: invoice PDF re-render failed — check PDF_ENABLED / Chromium",
    );
  }

  // ── 3. Studio jobs for any new styling work ───────────────
  try {
    if (committedToProduction(order)) {
      await serviceJobsService.createForOrder({ brand, order });
    }
  } catch (err) {
    logger.error(
      { err: err.message, brand, order_id },
      "order-amended: opening the Studio job for the new item failed",
    );
  }

  // Record what the customer was actually told, on the amendment itself.
  if (notified && amendment_id) {
    try {
      await amendRepo.finaliseAmendment({
        brand,
        amendment_id,
        patch: { customer_notified: true },
      });
    } catch (err) {
      logger.warn(
        { err: err.message, brand, amendment_id },
        "order-amended: could not stamp customer_notified",
      );
    }
  }
}

let registered = false;

function register() {
  if (registered) return;
  registered = true;
  outbox.register("order.amended", "order-amendment", onOrderAmended);
  logger.info(
    "sales amendment subscriber registered (outbox order.amended → customer letter + invoice PDF + Studio job)",
  );
}

register();

module.exports = { register, onOrderAmended, moneyCopy };
