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
const { money } = require("../../utils/money");
const brandDocs = require("../../services/pdf.brand-docs");
const docCopy = require("../../services/document-copy");
const emailRender = require("../email_campaigns/email-render");
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
    const updated = await repo.setDeliveryStatus({
      client,
      brand,
      id,
      status: "booked",
      extra: {
        booked_at: new Date().toISOString(),
        courier_tracking_ref:
          input?.courier_tracking_ref ?? delivery.courier_tracking_ref,
        courier_tracking_url:
          input?.courier_tracking_url ?? delivery.courier_tracking_url,
        expected_delivery_at:
          input?.expected_delivery_at ?? delivery.expected_delivery_at,
      },
    });
    await repo.addStateHistory({
      client,
      brand,
      h: {
        delivery_id: id,
        from_status: "queued",
        to_status: "booked",
        changed_by: user?.user_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.book",
      "delivery",
      id,
      { courier_tracking_ref: updated.courier_tracking_ref },
      request_id,
    );
    events.emit("delivery.booked", { brand, delivery_id: id });
    return updated;
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
    if (!allowed.includes(to_status))
      throw new ConflictError(
        `Cannot move a '${delivery.status}' delivery to '${to_status}'`,
      );
    const extra = {};
    if (DATE_FIELD[to_status])
      extra[DATE_FIELD[to_status]] = new Date().toISOString();
    const updated = await repo.setDeliveryStatus({
      client,
      brand,
      id,
      status: to_status,
      extra,
    });
    await repo.addStateHistory({
      client,
      brand,
      h: {
        delivery_id: id,
        from_status: delivery.status,
        to_status,
        changed_by_source: source || "user",
        changed_by: user?.user_id,
        notes,
      },
    });
    await A(
      brand,
      user?.user_id,
      "logistics.delivery.advance",
      "delivery",
      id,
      { from: delivery.status, to: to_status },
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
    const sales_order_payment_id = null;
    if (delivery && delivery.order_id) {
      await salesService.addPayment({
        brand,
        user,
        request_id,
        id: delivery.order_id,
        input: {
          method: "pay_on_delivery",
          amount_ngn:
            input.collected_amount_ngn ??
            pod.collected_amount_ngn ??
            pod.expected_amount_ngn,
          provider: "manual",
          provider_reference: input.remitted_reference,
          payment_path: "pos",
        },
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

/**
 * Render a delivery letter / waybill PDF for a delivery (X-1) and persist it via
 * the Documents gateway. Generated at packing/dispatch time; the document is
 * linked to the delivery (reference_type 'delivery').
 */
const _dDay = (v) => (v ? String(v).slice(0, 10) : "");

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
  ingestCourierEvent,
  listWebhookEvents,
  createPodCollection,
  getPodCollection,
  listPodCollections,
  markPodCollected,
  remitPodCollection,
  reconcilePodCollection,
  trackByToken,
  trackPublic,
};
