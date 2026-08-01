/**
 * Logistics & Delivery (V2.2 §6.10) — service.
 *
 * Couriers are admin config (rate cards). A DELIVERY tracks fulfilment of a
 * dispatched order through a courier state machine; it does NOT move stock
 * (stock leaves at order payment, on the sales spine). Attempts, proofs, and a
 * hash-free append-only state history feed the customer tracking page. For
 * pay-on-delivery, the courier collects cash and remits it; the remittance
 * records a sales payment through Sales (which then marks the order paid →
 * stock + GL). Courier webhooks are ingested and mapped onto the state machine.
 */

"use strict";

const crypto = require("crypto");
const { transaction, query } = require("../../config/database");
const { audit } = require("../../middleware/audit");
const { money, toCurrencyString } = require("../../utils/money");
const { formatDate, formatDateTime } = require("../../utils/dates");
const accounting = require("../accounting/accounting.service");
const { ACCOUNTS } = require("../accounting/posting-map");
const brandDocs = require("../../services/pdf.brand-docs");
const docCopy = require("../../services/document-copy");
const emailRender = require("../email_campaigns/email-render");
const emailService = require("../../services/email.service");
const { logger } = require("../../config/logger");
const repo = require("./logistics.repo");
const events = require("./logistics.events");
const salesService = require("../sales/sales.service");
const {
  NotFoundError,
  ConflictError,
  ValidationError,
} = require("../../utils/errors");

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  metadata,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    metadata,
    request_id,
  });

// Allowed delivery state transitions.
const FLOW = {
  queued: ["booked", "cancelled"],
  booked: ["picked_up", "cancelled"],
  picked_up: ["in_transit", "cancelled"],
  in_transit: [
    "arrived_destination_city",
    "out_for_delivery",
    "attempted_failed",
    "lost",
    "damaged",
  ],
  arrived_destination_city: ["out_for_delivery", "attempted_failed"],
  out_for_delivery: ["delivered", "attempted_failed", "returned_to_sender"],
  attempted_failed: ["out_for_delivery", "returned_to_sender", "cancelled"],
};
const DATE_FIELD = {
  booked: "booked_at",
  picked_up: "picked_up_at",
  delivered: "delivered_at",
  returned_to_sender: "returned_at",
  cancelled: "cancelled_at",
};
// States a delivery can no longer move out of. A completion shortcut is
// refused from these — "delivered" after "cancelled" is a mistake, not a
// shortcut.
const TERMINAL = new Set([
  "delivered",
  "returned_to_sender",
  "cancelled",
  "lost",
  "damaged",
]);
// The happy path, in order. Used to synthesise the states a direct
// "mark delivered" jumped over.
const HAPPY_PATH = [
  "queued",
  "booked",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
];
/**
 * States between `from` and `to` on the happy path, exclusive of both. Returns
 * [] when `from` is off the happy path (e.g. 'attempted_failed') — nothing
 * sensible can be inferred there, so nothing is invented.
 */
function skippedStatesTo(from, to) {
  const a = HAPPY_PATH.indexOf(from);
  const b = HAPPY_PATH.indexOf(to);
  if (a < 0 || b < 0 || b <= a + 1) return [];
  return HAPPY_PATH.slice(a + 1, b);
}
/**
 * Whether "mark delivered" from `from` is a legitimate shortcut rather than a
 * normal transition. True only when delivered isn't already a legal next step
 * and the delivery is still live — completing a cancelled or lost delivery is
 * a mistake, not a shortcut.
 */
function canShortcutToDelivered(from) {
  const allowed = FLOW[from] || [];
  return !allowed.includes("delivered") && !TERMINAL.has(from);
}

// ── couriers ─────────────────────────────────────────────
async function createCourier({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const courier = await repo.createCourier({ client, brand, row: input });
    await A(
      brand,
      user?.user_id,
      "logistics.courier.create",
      "courier",
      courier.courier_id,
      { courier_key: courier.courier_key },
      request_id,
    );
    return courier;
  });
}
async function getCourier({ brand, id }) {
  const courier = await repo.getCourier({ client: null, brand, id });
  if (!courier) throw new NotFoundError("Courier not found");
  return courier;
}
const listCouriers = ({ brand, is_active }) =>
  repo.listCouriers({ client: null, brand, is_active });
async function updateCourier({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getCourier({ client, brand, id });
    if (!existing) throw new NotFoundError("Courier not found");
    const courier = await repo.updateCourier({
      client,
      brand,
      id,
      patch: input,
    });
    await A(
      brand,
      user?.user_id,
      "logistics.courier.update",
      "courier",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return courier;
  });
}

// ── deliveries ───────────────────────────────────────────
async function createDelivery({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const courier = await repo.getCourier({
      client,
      brand,
      id: input.courier_id,
    });
    if (!courier) throw new NotFoundError("Courier not found");
    const delivery_number = await repo.nextNumber({
      client,
      brand,
      type: "delivery",
    });
    const token =
      input.public_tracking_token ||
      crypto.randomBytes(16).toString("base64url");
    const delivery = await repo.createDelivery({
      client,
      brand,
      row: {
        ...input,
        delivery_number,
        public_tracking_token: token,
        created_by: user?.user_id,
      },
    });
    let order = 0;
    for (const it of input.items || []) {
      await repo.addDeliveryItem({
        client,
        brand,
        item: {
          ...it,
          delivery_id: delivery.delivery_id,
          display_order: order++,
        },
      });
    }
    await repo.addStateHistory({
      client,
      brand,
      h: {
        delivery_id: delivery.delivery_id,
        from_status: null,
        to_status: "queued",
        changed_by: user?.user_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.create",
      "delivery",
      delivery.delivery_id,
      { delivery_number, order_id: input.order_id },
      request_id,
    );
    events.emit("delivery.created", {
      brand,
      delivery_id: delivery.delivery_id,
    });
    return repo.getDelivery({ client, brand, id: delivery.delivery_id });
  });
}
/**
 * G-2: auto-create a delivery for a paid dispatch order. Idempotent per order;
 * needs a delivery address snapshot and at least one active courier (used as
 * the default — a real courier is chosen at booking). No-ops for non-dispatch
 * orders or when prerequisites are missing.
 */
async function createForOrder({ brand, order }) {
  if (!order || order.order_type !== "dispatch") return null;
  if (!order.delivery_address_snapshot) return null;
  if (await repo.findDeliveryByOrder({ brand, order_id: order.order_id }))
    return null;
  const courier = await repo.getDefaultCourier({ brand });
  if (!courier) return null;

  const items = (order.lines || [])
    .filter((l) => l.variant_id)
    .map((l) => ({
      source_type: "sales_order_line",
      variant_id: l.variant_id,
      description:
        [l.product_name_snapshot, l.variant_label_snapshot]
          .filter(Boolean)
          .join(" — ") ||
        l.product_name_snapshot ||
        "Item",
      quantity: l.quantity,
    }));

  return createDelivery({
    brand,
    user: { user_id: null },
    request_id: null,
    input: {
      courier_id: courier.courier_id,
      order_id: order.order_id,
      delivery_type: "sales_order",
      recipient_contact_id: order.contact_id,
      delivery_address_snapshot: order.delivery_address_snapshot,
      items,
    },
  });
}

async function getDelivery({ brand, id }) {
  const delivery = await repo.getDelivery({ client: null, brand, id });
  if (!delivery) throw new NotFoundError("Delivery not found");
  return delivery;
}
const listDeliveries = ({ brand, filters, page, page_size }) =>
  repo.listDeliveries({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

async function bookDelivery({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");
    if (delivery.status !== "queued")
      throw new ConflictError(`Cannot book a '${delivery.status}' delivery`);
    // Readiness is advisory, not a gate: booking a courier for tomorrow while
    // the wig finishes tonight is a legitimate workflow. But an unready
    // booking must be a deliberate act, so the client has to pass
    // `acknowledge_not_ready` and the reason lands in the state history.
    const notReady = delivery.readiness && delivery.readiness !== "ready";
    if (notReady && !input?.acknowledge_not_ready)
      throw new ConflictError(
        `This delivery is not ready to dispatch (${delivery.readiness.replace(/_/g, " ")}). Confirm to book anyway.`,
      );
    if (input?.courier_id && input.courier_id !== delivery.courier_id) {
      const courier = await repo.getCourier({
        client,
        brand,
        id: input.courier_id,
      });
      if (!courier) throw new NotFoundError("Courier not found");
    }
    const updated = await repo.setDeliveryStatus({
      client,
      brand,
      id,
      status: "booked",
      extra: {
        booked_at: new Date().toISOString(),
        courier_id: input?.courier_id ?? delivery.courier_id,
        // `courier_fee_ngn` is deliberately NOT set here — it is the maintained
        // total of the delivery's cost rows. The fee agreed at booking is
        // recorded as an 'outbound' cost below so there is one source of truth.
        courier_tracking_ref:
          input?.courier_tracking_ref ?? delivery.courier_tracking_ref,
        courier_tracking_url:
          input?.courier_tracking_url ?? delivery.courier_tracking_url,
        expected_delivery_at:
          input?.expected_delivery_at ?? delivery.expected_delivery_at,
        driver_name: input?.driver_name ?? delivery.driver_name,
        driver_phone: input?.driver_phone ?? delivery.driver_phone,
        scheduled_pickup_at:
          input?.scheduled_pickup_at ?? delivery.scheduled_pickup_at,
      },
    });
    // The fee agreed with the courier at booking is the first cost on this
    // delivery. Recording it here (rather than writing the column directly)
    // means the loss check runs at booking time too — an agency quoting more
    // than the customer paid is flagged before the parcel even moves.
    const agreedFee = Number(input?.courier_fee_ngn ?? 0);
    if (agreedFee > 0) {
      const existing = await repo.listDeliveryCosts({
        client,
        brand,
        delivery_id: id,
      });
      if (existing.length === 0) {
        const courier_id = input?.courier_id ?? delivery.courier_id;
        const courier = courier_id
          ? await repo.getCourier({ client, brand, id: courier_id })
          : null;
        await repo.addDeliveryCost({
          client,
          brand,
          cost: {
            delivery_id: id,
            cost_type: "outbound",
            amount_ngn: agreedFee,
            courier_id,
            settlement_mode: courier?.settlement_mode || "invoice",
            notes: "Fee agreed at booking",
            recorded_by: user?.user_id,
          },
        });
        await repo.recomputeDeliveryCostTotals({
          client,
          brand,
          id,
          user_id: user?.user_id,
        });
      }
    }
    await repo.addStateHistory({
      client,
      brand,
      h: {
        delivery_id: id,
        from_status: "queued",
        to_status: "booked",
        changed_by: user?.user_id,
        notes: notReady
          ? `Booked before ready (${delivery.readiness})${
              input?.not_ready_reason ? ` — ${input.not_ready_reason}` : ""
            }`
          : null,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.book",
      "delivery",
      id,
      {
        courier_tracking_ref: updated.courier_tracking_ref,
        ...(notReady
          ? {
              booked_not_ready: true,
              readiness: delivery.readiness,
              not_ready_reason: input?.not_ready_reason || null,
            }
          : {}),
      },
      request_id,
    );
    events.emit("delivery.booked", { brand, delivery_id: id });
    // Re-read: the agreed fee above recomputes the cost totals, so `updated`
    // (captured before that) would report a stale courier_fee_ngn.
    return repo.getDelivery({ client, brand, id });
  });
}
async function advanceDelivery({
  brand,
  user,
  request_id,
  id,
  to_status,
  notes,
  source,
}) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");
    const allowed = FLOW[delivery.status] || [];
    // "Mark delivered" is always offered, from any live state. Riders phone in
    // "delivered" without anyone having clicked through picked_up →
    // in_transit → out_for_delivery, and refusing the update just leaves the
    // delivery stranded in an intermediate state forever. The skip is recorded
    // rather than prevented — see the synthesised history rows below.
    const isCompletionShortcut =
      to_status === "delivered" && canShortcutToDelivered(delivery.status);
    if (!allowed.includes(to_status) && !isCompletionShortcut)
      throw new ConflictError(
        `Cannot move a '${delivery.status}' delivery to '${to_status}'`,
      );
    // Completing a delivery REQUIRES knowing what it cost us. Completion is
    // the only moment the figure is actually available — the dispatcher is on
    // the phone with the rider, and once the delivery leaves the actionable
    // queue nobody opens it again. An uncosted delivery is worse than a blank:
    // it reports as ₦0 paid, i.e. 100% margin, silently inflating the P&L and
    // burying the real losses. A deliberate fee waiver satisfies the gate.
    //
    // Only enforced for staff-driven completions — a courier webhook must
    // still be able to close a delivery, and those surface in the
    // "cost not recorded" Issues list instead.
    if (to_status === "delivered" && (source || "user") === "user") {
      const costs = await repo.listDeliveryCosts({
        client,
        brand,
        delivery_id: id,
      });
      if (costs.length === 0 && !delivery.fee_waiver_reason)
        throw new ValidationError(
          "Record what this delivery cost (agency + amount) before marking it delivered.",
        );
    }
    const extra = {};
    if (DATE_FIELD[to_status])
      extra[DATE_FIELD[to_status]] = new Date().toISOString();
    // Completion attribution — denormalised so "who delivered this, when" is a
    // column rather than a per-row subquery into state history.
    if (to_status === "delivered") {
      extra.completed_by = user?.user_id ?? null;
      extra.completed_at = new Date().toISOString();
    }
    const updated = await repo.setDeliveryStatus({
      client,
      brand,
      id,
      status: to_status,
      extra,
    });
    // A skipped-ahead completion writes the states it jumped over as
    // system-sourced rows, so "time in transit" analytics and the customer
    // timeline stay coherent instead of showing a hole.
    if (isCompletionShortcut) {
      let prev = delivery.status;
      for (const skipped of skippedStatesTo(delivery.status, "delivered")) {
        await repo.addStateHistory({
          client,
          brand,
          h: {
            delivery_id: id,
            from_status: prev,
            to_status: skipped,
            changed_by_source: "system",
            changed_by: user?.user_id,
            notes: "Inferred — staff marked delivered directly",
          },
        });
        prev = skipped;
      }
    }
    await repo.addStateHistory({
      client,
      brand,
      h: {
        delivery_id: id,
        from_status: isCompletionShortcut ? "out_for_delivery" : delivery.status,
        to_status,
        changed_by_source: source || "user",
        changed_by: user?.user_id,
        notes: isCompletionShortcut
          ? [notes, `Marked delivered directly from '${delivery.status}'`]
              .filter(Boolean)
              .join(" — ")
          : notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.advance",
      "delivery",
      id,
      {
        from: delivery.status,
        to: to_status,
        ...(isCompletionShortcut ? { skipped_states: true } : {}),
      },
      request_id,
    );
    events.emit("delivery.status", {
      brand,
      delivery_id: id,
      status: to_status,
    });
    return updated;
  });
}
async function cancelDelivery({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");
    if (
      ["delivered", "returned_to_sender", "cancelled"].includes(delivery.status)
    )
      throw new ConflictError(`Cannot cancel a '${delivery.status}' delivery`);
    const updated = await repo.setDeliveryStatus({
      client,
      brand,
      id,
      status: "cancelled",
      extra: {
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      },
    });
    await repo.addStateHistory({
      client,
      brand,
      h: {
        delivery_id: id,
        from_status: delivery.status,
        to_status: "cancelled",
        changed_by: user?.user_id,
        notes: reason,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.cancel",
      "delivery",
      id,
      { reason },
      request_id,
    );
    return updated;
  });
}

// ── attempts + proofs ────────────────────────────────────
async function recordAttempt({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");
    const attempt_number = await repo.incrementAttemptCount({
      client,
      brand,
      id,
    });
    const attempt = await repo.addAttempt({
      client,
      brand,
      attempt: {
        ...input,
        delivery_id: id,
        attempt_number,
        recorded_by: user?.user_id,
      },
    });
    const newStatus =
      input.outcome === "delivered"
        ? "delivered"
        : input.outcome === "rescheduled"
          ? "attempted_failed"
          : "attempted_failed";
    const extra =
      input.outcome === "delivered"
        ? { delivered_at: new Date().toISOString() }
        : {};
    if (delivery.status !== newStatus) {
      await repo.setDeliveryStatus({
        client,
        brand,
        id,
        status: newStatus,
        extra,
      });
      await repo.addStateHistory({
        client,
        brand,
        h: {
          delivery_id: id,
          from_status: delivery.status,
          to_status: newStatus,
          changed_by_source: "courier_portal",
          changed_by: user?.user_id,
          notes: input.outcome_notes,
        },
      });
    }
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.attempt",
      "delivery",
      id,
      { attempt_number, outcome: input.outcome },
      request_id,
    );
    return attempt;
  });
}
async function recordProof({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");
    const proof = await repo.addProof({
      client,
      brand,
      proof: { ...input, delivery_id: id, captured_by: user?.user_id },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.proof",
      "delivery",
      id,
      { proof_type: input.proof_type },
      request_id,
    );
    return proof;
  });
}

// ── delivery costs + loss ────────────────────────────────
/**
 * Record what a delivery actually cost us.
 *
 * The rule the business asked for: the amount paid out should be at or below
 * what the customer was charged for shipping. When it is not, we do NOT
 * block the save — the money was genuinely spent, and refusing the entry only
 * teaches staff to key in a number that fits. Instead the shortfall is
 * computed, flagged on the delivery, and returned to the caller so the UI can
 * show it at the moment of entry.
 *
 * Several costs per delivery are expected: a failed attempt means a real
 * second courier fee against the same one-time revenue, and that is exactly
 * where losses accumulate.
 */
async function addDeliveryCost({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");

    // Default the paying courier and the settlement route from the delivery's
    // courier: agencies (DHL, GIGL) bill periodically, per-drop riders are
    // paid at pickup.
    const courier_id = input.courier_id || delivery.courier_id;
    let settlement_mode = input.settlement_mode;
    if (!settlement_mode && courier_id) {
      const courier = await repo.getCourier({ client, brand, id: courier_id });
      settlement_mode = courier?.settlement_mode || "invoice";
    }

    const cost = await repo.addDeliveryCost({
      client,
      brand,
      cost: {
        ...input,
        delivery_id: id,
        courier_id,
        settlement_mode: settlement_mode || "invoice",
        recorded_by: user?.user_id,
      },
    });
    const updated = await repo.recomputeDeliveryCostTotals({
      client,
      brand,
      id,
      user_id: user?.user_id,
    });

    const revenue = money(delivery.order_shipping_fee_ngn || 0);
    const cost_total = money(updated.courier_fee_ngn || 0);
    const loss = money(updated.delivery_loss_ngn || 0);

    await A(
      brand,
      user?.user_id,
      "logistics.delivery.cost_add",
      "delivery",
      id,
      {
        cost_id: cost.cost_id,
        cost_type: cost.cost_type,
        amount_ngn: toCurrencyString(money(cost.amount_ngn)),
        cost_total_ngn: toCurrencyString(cost_total),
        revenue_ngn: toCurrencyString(revenue),
        loss_ngn: toCurrencyString(loss),
        over_collected: updated.has_delivery_loss,
      },
      request_id,
    );
    if (updated.has_delivery_loss) {
      events.emit("delivery.loss", {
        brand,
        delivery_id: id,
        loss_ngn: toCurrencyString(loss),
      });
    }
    return {
      cost,
      delivery: await repo.getDelivery({ client, brand, id }),
      // Surfaced so the client can flag the overspend inline rather than
      // having to recompute the comparison itself.
      loss: {
        revenue_ngn: toCurrencyString(revenue),
        cost_ngn: toCurrencyString(cost_total),
        loss_ngn: toCurrencyString(loss),
        has_loss: updated.has_delivery_loss,
      },
    };
  });
}

async function removeDeliveryCost({ brand, user, request_id, id, cost_id }) {
  return transaction(async (client) => {
    const cost = await repo.getDeliveryCost({ client, brand, id: cost_id });
    if (!cost || cost.delivery_id !== id)
      throw new NotFoundError("Delivery cost not found");
    // A settled cost has already been carried into an expense or a cash
    // request; unpicking it here would silently desync finance.
    if (cost.settled_at)
      throw new ConflictError(
        "This cost has already been settled and cannot be removed",
      );
    await repo.deleteDeliveryCost({ client, brand, id: cost_id });
    await repo.recomputeDeliveryCostTotals({
      client,
      brand,
      id,
      user_id: user?.user_id,
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.cost_remove",
      "delivery",
      id,
      { cost_id, amount_ngn: cost.amount_ngn },
      request_id,
    );
    return repo.getDelivery({ client, brand, id });
  });
}

/**
 * Record why a delivery was deliberately not charged for (promo, remake,
 * apology reship). Without this every free delivery reads as a 100% loss and
 * buries the genuine overspends in the report.
 */
async function setFeeWaiver({ brand, user, request_id, id, reason }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({ client, brand, id });
    if (!delivery) throw new NotFoundError("Delivery not found");
    const updated = await repo.setDeliveryStatus({
      client,
      brand,
      id,
      status: delivery.status,
      extra: { fee_waiver_reason: reason || null },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.fee_waiver",
      "delivery",
      id,
      { reason: reason || null },
      request_id,
    );
    return updated;
  });
}

const deliveryReconciliation = ({ brand, from, to }) =>
  repo.deliveryReconciliation({ client: null, brand, from, to });

const listUnsettledCosts = ({ brand, courier_id, to }) =>
  repo.listUnsettledCosts({ client: null, brand, courier_id, to });

// ── courier webhook ingest ───────────────────────────────
async function ingestCourierEvent({ brand, input }) {
  return transaction(async (client) => {
    const event = await repo.addWebhookEvent({
      client,
      brand,
      event: {
        ...input,
        processed: !!input.mapped_to_status && !!input.delivery_id,
        processed_at: input.mapped_to_status ? new Date().toISOString() : null,
      },
    });
    // If the courier event maps onto a legal transition, advance the delivery.
    if (input.delivery_id && input.mapped_to_status) {
      const delivery = await repo.getDelivery({
        client,
        brand,
        id: input.delivery_id,
      });
      if (
        delivery &&
        (FLOW[delivery.status] || []).includes(input.mapped_to_status)
      ) {
        const extra = DATE_FIELD[input.mapped_to_status]
          ? { [DATE_FIELD[input.mapped_to_status]]: new Date().toISOString() }
          : {};
        await repo.setDeliveryStatus({
          client,
          brand,
          id: input.delivery_id,
          status: input.mapped_to_status,
          extra,
        });
        await repo.addStateHistory({
          client,
          brand,
          h: {
            delivery_id: input.delivery_id,
            from_status: delivery.status,
            to_status: input.mapped_to_status,
            changed_by_source: "webhook",
            webhook_event_id: event.event_id,
            notes: input.external_event_type,
          },
        });
      }
    }
    return event;
  });
}
const listWebhookEvents = ({ brand, delivery_id }) =>
  repo.listWebhookEvents({ client: null, brand, delivery_id });

// ── pay-on-delivery collections ──────────────────────────
async function createPodCollection({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const delivery = await repo.getDelivery({
      client,
      brand,
      id: input.delivery_id,
    });
    if (!delivery) throw new NotFoundError("Delivery not found");
    if (!delivery.is_pay_on_delivery)
      throw new ValidationError("This delivery is not marked pay-on-delivery");
    const courier = await repo.getCourier({
      client,
      brand,
      id: delivery.courier_id,
    });
    const expected =
      input.expected_amount_ngn ?? delivery.pod_amount_expected_ngn;
    if (expected === null || expected === undefined)
      throw new ValidationError("No POD amount expected on this delivery");
    const fee =
      input.courier_fee_ngn ??
      (courier && courier.pod_fee_pct
        ? money(expected).times(money(courier.pod_fee_pct)).div(100).toFixed(2)
        : 0);
    const collection_number = await repo.nextNumber({
      client,
      brand,
      type: "pay_on_delivery_collection",
    });
    const pod = await repo.createPodCollection({
      client,
      brand,
      row: {
        collection_number,
        delivery_id: input.delivery_id,
        courier_id: delivery.courier_id,
        expected_amount_ngn: expected,
        courier_fee_ngn: fee,
        notes: input.notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.pod.create",
      "pay_on_delivery_collection",
      pod.collection_id,
      { collection_number, expected_amount_ngn: expected },
      request_id,
    );
    return pod;
  });
}
const getPodCollection = async ({ brand, id }) => {
  const pod = await repo.getPodCollection({ client: null, brand, id });
  if (!pod) throw new NotFoundError("POD collection not found");
  return pod;
};
const listPodCollections = ({ brand, filters, page, page_size }) =>
  repo.listPodCollections({
    client: null,
    brand,
    filters,
    page,
    page_size,
    offset: (page - 1) * page_size,
  });

async function markPodCollected({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const pod = await repo.getPodCollection({ client, brand, id });
    if (!pod) throw new NotFoundError("POD collection not found");
    if (pod.status !== "pending")
      throw new ConflictError(`POD is already '${pod.status}'`);
    const updated = await repo.setPodStatus({
      client,
      brand,
      id,
      status: "collected_by_courier",
      extra: {
        collected_amount_ngn: input.collected_amount_ngn,
        collected_at: new Date().toISOString(),
      },
    });
    // Policy Q10: the courier now holds our cash — book it as COD-in-transit
    // against the customer-deposit liability until remittance clears it.
    const collected = money(input.collected_amount_ngn || 0);
    if (collected.gt(0)) {
      const amt = toCurrencyString(collected);
      await accounting.postEntry({
        client,
        brand,
        user_id: user?.user_id,
        entry: {
          source_type: "payment",
          source_table: `${brand}.pay_on_delivery_collections`,
          source_id: id,
          reference: pod.collection_number,
          description: `COD collected by courier — ${pod.collection_number}`,
          idempotency_key: `pod_collect:${id}`,
        },
        lines: [
          {
            account_code: ACCOUNTS.COD_IN_TRANSIT,
            debit_ngn: amt,
            description: `COD held by courier — ${pod.collection_number}`,
          },
          {
            account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
            credit_ngn: amt,
            description: `COD customer payment — ${pod.collection_number}`,
          },
        ],
      });
    }
    await A(
      brand,
      user?.user_id,
      "logistics.pod.collected",
      "pay_on_delivery_collection",
      id,
      { collected_amount_ngn: input.collected_amount_ngn },
      request_id,
    );
    return updated;
  });
}
/** Courier remits POD cash → record the sales payment (drives order.paid → stock + GL). */
async function remitPodCollection({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const pod = await repo.getPodCollection({ client, brand, id });
    if (!pod) throw new NotFoundError("POD collection not found");
    if (!["collected_by_courier", "pending"].includes(pod.status))
      throw new ConflictError(`Cannot remit a '${pod.status}' POD`);
    const delivery = await repo.getDelivery({
      client,
      brand,
      id: pod.delivery_id,
    });
    const collectedNgn = money(
      input.collected_amount_ngn ??
        pod.collected_amount_ngn ??
        pod.expected_amount_ngn ??
        0,
    );
    const sales_order_payment_id = null;
    if (delivery && delivery.order_id) {
      // Records the sales payment (drives order.paid → stock + sale journal).
      // _internal_pod_remit bypasses the gateway-only guard for this one
      // server-side path AND skips the generic capture journal — the COD
      // clearing journals below own the money movement.
      await salesService.addPayment({
        brand,
        user,
        request_id,
        id: delivery.order_id,
        input: {
          method: "pay_on_delivery",
          amount_ngn: toCurrencyString(collectedNgn),
          provider: "manual",
          provider_reference: input.remitted_reference,
          payment_path: "pos",
          _internal_pod_remit: true,
        },
      });
    }
    // Policy Q10 clearing journals. The collect leg (DR 1610 / CR 2400) is
    // idempotency-keyed, so a remit straight from 'pending' (courier never
    // marked collected) still books it exactly once; then the remit leg
    // moves the money to bank, netting the courier's POD fee to Logistics.
    if (collectedNgn.gt(0)) {
      const amt = toCurrencyString(collectedNgn);
      await accounting.postEntry({
        client,
        brand,
        user_id: user?.user_id,
        entry: {
          source_type: "payment",
          source_table: `${brand}.pay_on_delivery_collections`,
          source_id: id,
          reference: pod.collection_number,
          description: `COD collected by courier — ${pod.collection_number}`,
          idempotency_key: `pod_collect:${id}`,
        },
        lines: [
          {
            account_code: ACCOUNTS.COD_IN_TRANSIT,
            debit_ngn: amt,
            description: `COD held by courier — ${pod.collection_number}`,
          },
          {
            account_code: ACCOUNTS.CUSTOMER_DEPOSITS,
            credit_ngn: amt,
            description: `COD customer payment — ${pod.collection_number}`,
          },
        ],
      });
      const feeRaw = money(pod.courier_fee_ngn || 0);
      const fee = feeRaw.gt(collectedNgn) ? collectedNgn : feeRaw;
      const remitLines = [
        {
          account_code: ACCOUNTS.BANK_MAIN,
          debit_ngn: toCurrencyString(collectedNgn.minus(fee)),
          description: `COD remitted — ${pod.collection_number}`,
        },
      ];
      if (fee.gt(0))
        remitLines.push({
          account_code: ACCOUNTS.LOGISTICS_LOCAL,
          debit_ngn: toCurrencyString(fee),
          description: `Courier POD fee — ${pod.collection_number}`,
        });
      remitLines.push({
        account_code: ACCOUNTS.COD_IN_TRANSIT,
        credit_ngn: amt,
        description: `COD transit cleared — ${pod.collection_number}`,
      });
      await accounting.postEntry({
        client,
        brand,
        user_id: user?.user_id,
        entry: {
          source_type: "payment",
          source_table: `${brand}.pay_on_delivery_collections`,
          source_id: id,
          reference: pod.collection_number,
          description: `COD remittance — ${pod.collection_number}`,
          idempotency_key: `pod_remit:${id}`,
        },
        lines: remitLines,
      });
    }
    const updated = await repo.setPodStatus({
      client,
      brand,
      id,
      status: "remitted",
      extra: {
        remitted_at: new Date().toISOString(),
        remitted_reference: input.remitted_reference || null,
        collected_amount_ngn:
          input.collected_amount_ngn ?? pod.collected_amount_ngn,
        sales_order_payment_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.pod.remit",
      "pay_on_delivery_collection",
      id,
      { remitted_reference: input.remitted_reference },
      request_id,
    );
    events.emit("pod.remitted", { brand, collection_id: id });
    return updated;
  });
}
async function reconcilePodCollection({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const pod = await repo.getPodCollection({ client, brand, id });
    if (!pod) throw new NotFoundError("POD collection not found");
    if (pod.status !== "remitted")
      throw new ConflictError(
        `Only a remitted POD can be reconciled (is '${pod.status}')`,
      );
    const status =
      input?.status === "disputed" ||
      input?.status === "short_paid" ||
      input?.status === "written_off"
        ? input.status
        : "reconciled";
    const updated = await repo.setPodStatus({
      client,
      brand,
      id,
      status,
      extra: {
        reconciled_at: new Date().toISOString(),
        reconciled_by: user?.user_id,
        notes: input?.notes ?? pod.notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.pod.reconcile",
      "pay_on_delivery_collection",
      id,
      { status },
      request_id,
    );
    return updated;
  });
}

// ── public tracking (no auth) ────────────────────────────
async function trackByToken({ brand, token }) {
  const result = await repo.getDeliveryByToken({ client: null, brand, token });
  if (!result) throw new NotFoundError("Tracking reference not found");
  return result;
}
// Public endpoint has only the token (no brand context); search both brands.
async function trackPublic({ token }) {
  for (const brand of ["pixiegirl", "faitlynhair"]) {
    const result = await repo.getDeliveryByToken({
      client: null,
      brand,
      token,
    });
    if (result) return result;
  }
  throw new NotFoundError("Tracking reference not found");
}


function deliveredEmailHtml({ firstName, orderNumber, deliveredAtText }) {
  return `
  <div style="font-family:Montserrat,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#1c1c1c;">
    <h2 style="font-family:Georgia,'Playfair Display',serif;color:#690909;margin:0 0 16px;">Delivered!</h2>
    <p style="font-size:15px;line-height:1.6;">Hi ${firstName}, your order <strong>${orderNumber}</strong> was delivered on ${deliveredAtText}.</p>
    <p style="font-size:15px;line-height:1.6;">If you did not receive this order, please reply to this email right away so we can look into it.</p>
  </div>`;
}

/**
 * Best-effort delivered-confirmation email to the customer. Used both by the
 * auto-send subscriber (fires on every 'delivered' transition, staff- or
 * driver-confirmed alike) and by the manual "send now" action staff can
 * trigger from the delivery detail screen. Never throws — a notification
 * failure must not block or reverse the delivery itself.
 */
async function sendDeliveredEmail({ brand, delivery_id }) {
  try {
    const delivery = await repo.getDelivery({ client: null, brand, id: delivery_id });
    if (!delivery || !delivery.order_id)
      return { sent: false, reason: "no_linked_order" };
    const order = await repo.getOrderForEmail({
      client: null,
      brand,
      order_id: delivery.order_id,
    });
    if (!order || !order.contact_email)
      return { sent: false, reason: "no_customer_email" };
    const firstName =
      String(order.contact_name || "").trim().split(/\s+/)[0] || "there";
    const deliveredAtText = formatDateTime(delivery.delivered_at, "just now");
    await emailService.send({
      to: order.contact_email,
      subject: `Delivered: order ${order.order_number}`,
      html: deliveredEmailHtml({
        firstName,
        orderNumber: order.order_number,
        deliveredAtText,
      }),
      brand,
    });
    return { sent: true };
  } catch (err) {
    logger.error(
      { err: err.message, brand, delivery_id },
      "logistics: delivered-confirmation email failed",
    );
    return { sent: false, reason: "send_failed" };
  }
}

/** Manual "send now" — staff-triggered resend of the delivered-confirmation email. */
async function notifyDelivered({ brand, user, request_id, id }) {
  const delivery = await repo.getDelivery({ client: null, brand, id });
  if (!delivery) throw new NotFoundError("Delivery not found");
  if (delivery.status !== "delivered")
    throw new ConflictError("Delivery is not yet marked delivered");
  const result = await sendDeliveredEmail({ brand, delivery_id: id });
  await A(
    brand,
    user?.user_id,
    "logistics.delivery.notify_delivered",
    "delivery",
    id,
    result,
    request_id,
  );
  return result;
}

/**
 * Render a delivery letter / waybill PDF for a delivery (X-1) and persist it via
 * the Documents gateway. Generated at packing/dispatch time; the document is
 * linked to the delivery (reference_type 'delivery').
 */
// Human-facing day label on the delivery-note PDF → DD/MM/YYYY.
const _dDay = (v) => formatDate(v);

/** Map a delivery (+ items + address snapshot) → the brand-doc renderer shape
 *  in delivery-note mode (no money; Item/Qty + signature panel). */
function buildDeliveryDoc({ delivery, brandObj, copy, courierName, orderNumber }) {
  const addr = delivery.delivery_address_snapshot || {};
  const first = String(delivery.recipient_name_snapshot || "").trim().split(/\s+/)[0] || "";
  const tokens = {
    first_name: first,
    brand_name: brandObj.brand_name,
    order_number: orderNumber || "",
  };
  const c = (copy.delivery_note && copy.delivery_note.pdf) || {};

  return {
    from: {
      name: brandObj.brand_legal_name || brandObj.brand_name,
      address: brandObj.brand_address,
      phone: brandObj.brand_phone,
      email: brandObj.support_email,
    },
    ship_to: {
      name: delivery.recipient_name_snapshot,
      address: [addr.line1, addr.line2].filter(Boolean).join(", "),
      cityline: [addr.city, addr.state, addr.country].filter(Boolean).join(", "),
      phone: delivery.recipient_phone_snapshot,
    },
    meta: [
      ["Delivery #", delivery.delivery_number],
      ...(orderNumber ? [["Order #", orderNumber]] : []),
      ["Date", _dDay(delivery.dispatched_at || delivery.created_at)],
      ...(courierName ? [["Courier", courierName]] : []),
      ...(delivery.courier_tracking_ref
        ? [["Tracking", delivery.courier_tracking_ref]]
        : []),
    ],
    lines: (delivery.items || []).map((it) => ({
      description: it.description || "Item",
      quantity: it.quantity,
    })),
    cod_amount_ngn: delivery.cod_amount_ngn || 0,
    notes_label: c.note_label,
    notes: docCopy.fillTokens(c.note, tokens),
    thanks: docCopy.fillTokens(c.message, tokens),
  };
}

async function deliveryLetterPdf({ brand, user, id }) {
  const delivery = await repo.getDelivery({ client: null, brand, id });
  if (!delivery) throw new NotFoundError("Delivery not found");
  const pdf = require("../../services/pdf.service");
  const [tokens, copy, courierName, orderNumber] = await Promise.all([
    emailRender.resolveBrandTokens(brand),
    docCopy.resolveCopy(brand),
    delivery.courier_id
      ? query(
          `SELECT display_name FROM ${brand}.couriers WHERE courier_id = $1`,
          [delivery.courier_id],
        )
          .then((r) => (r.rows[0] ? r.rows[0].display_name : null))
          .catch(() => null)
      : Promise.resolve(null),
    delivery.order_id
      ? query(
          `SELECT order_number FROM ${brand}.sales_orders WHERE order_id = $1`,
          [delivery.order_id],
        )
          .then((r) => (r.rows[0] ? r.rows[0].order_number : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const brandObj = brandDocs.brandFromTokens(tokens);
  const html = brandDocs.deliveryNoteHtml(
    brandObj,
    buildDeliveryDoc({ delivery, brandObj, copy, courierName, orderNumber }),
  );
  const doc = await pdf.renderAndStore({
    brand,
    user_id: user ? user.user_id : null,
    html,
    title: `Delivery Note ${delivery.delivery_number || delivery.courier_tracking_ref || id}`,
    document_type: "delivery_note",
    reference_type: "delivery",
    reference_id: id,
    pdfOptions: brandDocs.PDF_OPTIONS,
  });
  return { document_id: doc.document_id, url: doc.url };
}

module.exports = {
  createCourier,
  getCourier,
  listCouriers,
  updateCourier,
  createDelivery,
  createForOrder,
  getDelivery,
  deliveryLetterPdf,
  listDeliveries,
  bookDelivery,
  advanceDelivery,
  cancelDelivery,
  recordAttempt,
  recordProof,
  addDeliveryCost,
  removeDeliveryCost,
  setFeeWaiver,
  deliveryReconciliation,
  listUnsettledCosts,
  ingestCourierEvent,
  listWebhookEvents,
  // Pure state-machine helpers, exported for unit tests.
  _internals: { FLOW, TERMINAL, HAPPY_PATH, skippedStatesTo, canShortcutToDelivered },
  createPodCollection,
  getPodCollection,
  listPodCollections,
  markPodCollected,
  remitPodCollection,
  reconcilePodCollection,
  trackByToken,
  trackPublic,
  sendDeliveredEmail,
  notifyDelivered,
};
