/**
 * Stock (V2.2 §6.9 — SSOT) — business logic.
 * `deductForSale` is the function Sales/POS call to remove stock on an order
 * (signed: a 'sale' movement with negative quantity → trigger lowers on_hand;
 * the CHECK on_hand>=0 surfaces oversell as 409). `seedVariant` is the
 * catalogue→stock SSOT seed.
 */

"use strict";

require("./stock.subscribers"); // side-effect: register catalogue listener

const repo = require("./stock.repo");
const events = require("./stock.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

// Locations
const listLocations = ({ brand }) => repo.listLocations({ brand });
async function createLocation({ brand, user, request_id, input }) {
  const loc = await repo.createLocation({ brand, input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "stock.location.create",
    target_type: "stock_location",
    target_id: loc.location_id,
    after: loc,
    request_id,
  });
  return loc;
}
async function updateLocation({ brand, user, request_id, id, patch }) {
  const loc = await repo.updateLocation({ brand, id, patch });
  if (!loc) throw new NotFoundError("Location");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "stock.location.update",
    target_type: "stock_location",
    target_id: id,
    after: loc,
    request_id,
  });
  return loc;
}

// Inventory valuation — on_hand × variant standard cost (cost_price_ngn).
function valuation({ brand, location_id, variant_id, product_id }) {
  return repo.valuation({
    brand,
    filters: { location_id, variant_id, product_id },
  });
}

// Levels
function listLevels({ brand, variant_id, location_id, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listLevels({
    brand,
    variant_id,
    location_id,
    page,
    page_size,
    offset,
  });
}
const variantStock = ({ brand, variant_id }) =>
  repo.levelsForVariant({ brand, variant_id });

// Movements
function listMovements({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listMovements({ brand, filters, page, page_size, offset });
}
async function recordMovement({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const m = await repo.recordMovement({
      client,
      brand,
      input,
      user_id: user.user_id,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "stock.movement.create",
      target_type: "stock_movement",
      target_id: m.movement_id,
      after: m,
      request_id,
    });
    events.emit("moved", {
      brand,
      variant_id: m.variant_id,
      location_id: m.location_id,
      movement_type: m.movement_type,
      quantity: m.quantity,
    });
    return m;
  });
}

/**
 * Deduct stock for a sale. Call inside the order transaction (pass client).
 * quantity is the POSITIVE units sold; recorded as a negative 'sale' movement.
 */
async function deductForSale({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  sales_channel,
  unit_cost_ngn,
  user_id,
}) {
  const want = Math.abs(quantity);
  // Race-safe oversell pre-check: lock the level row, compare against what is
  // physically on hand. The DB CHECK (on_hand >= 0) is the hard backstop; this
  // turns it into a clean 409 with the actual count instead of a raw 23514.
  const level = await repo.lockLevel({
    client,
    brand,
    variant_id,
    location_id,
  });
  const onHand = level ? level.on_hand : 0;
  if (onHand < want) {
    throw new AppError(
      "INSUFFICIENT_STOCK",
      `Oversell blocked: ${want} requested but only ${onHand} on hand`,
      409,
      {
        user_message: `Only ${onHand} in stock — please reduce the quantity.`,
        metadata: { variant_id, location_id, requested: want, on_hand: onHand },
      },
    );
  }
  const m = await repo.recordMovement({
    client,
    brand,
    user_id,
    input: {
      variant_id,
      location_id,
      quantity: -Math.abs(quantity),
      movement_type: "sale",
      sales_channel,
      reference_type: "sales_order",
      reference_id,
      unit_cost_ngn,
    },
  });
  events.emit("moved", {
    brand,
    variant_id,
    location_id,
    movement_type: "sale",
    quantity: -Math.abs(quantity),
  });
  await audit({
    business: brand,
    user_id,
    action_key: "stock.movement.sale",
    target_type: "stock_movement",
    target_id: m.movement_id,
    after: { variant_id, quantity: -Math.abs(quantity), reference_id },
    request_id: null,
  });
  return m;
}

/**
 * Add stock for a goods receipt. Call inside the GRN transaction (pass client).
 * quantity is the POSITIVE units received; recorded as a positive 'receive'
 * movement so the SSOT trigger lifts stock_levels.on_hand.
 */
async function receiveStock({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  reference_type,
  unit_cost_ngn,
  user_id,
}) {
  const m = await repo.recordMovement({
    client,
    brand,
    user_id,
    input: {
      variant_id,
      location_id,
      quantity: Math.abs(quantity),
      movement_type: "receive",
      reference_type: reference_type || "goods_received_note",
      reference_id,
      unit_cost_ngn,
    },
  });
  events.emit("moved", {
    brand,
    variant_id,
    location_id,
    movement_type: "receive",
    quantity: Math.abs(quantity),
  });
  await audit({
    business: brand,
    user_id,
    action_key: "stock.movement.receive",
    target_type: "stock_movement",
    target_id: m.movement_id,
    after: { variant_id, quantity: Math.abs(quantity), reference_id },
    request_id: null,
  });
  return m;
}

async function seedVariant({ brand, variant_id }) {
  const loc = await repo.getDefaultLocation({ brand });
  if (loc)
    await repo.seedLevel({ brand, variant_id, location_id: loc.location_id });
}

/**
 * Soft-lock stock for an order (V2.2 §6.2 layaway). Records a 'reserve'
 * movement; the SSOT trigger lifts stock_levels.reserved (available drops).
 * Call inside the order transaction (pass client). Positive quantity.
 */
async function reserveForOrder({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  user_id,
}) {
  const m = await repo.recordMovement({
    client,
    brand,
    user_id,
    input: {
      variant_id,
      location_id,
      quantity: Math.abs(quantity),
      movement_type: "reserve",
      reference_type: "sales_order",
      reference_id,
    },
  });
  events.emit("moved", {
    brand,
    variant_id,
    location_id,
    movement_type: "reserve",
    quantity: Math.abs(quantity),
  });
  return m;
}

/**
 * Release a previously-held reservation (layaway paid / cancelled /
 * abandoned). Records a 'release_reserve' movement; the trigger lowers
 * stock_levels.reserved (available recovers). Call before deductForSale so
 * the reserved <= on_hand invariant always holds.
 */
async function releaseReservation({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  user_id,
  reason,
}) {
  const m = await repo.recordMovement({
    client,
    brand,
    user_id,
    input: {
      variant_id,
      location_id,
      quantity: Math.abs(quantity),
      movement_type: "release_reserve",
      reference_type: "sales_order",
      reference_id,
      notes: reason || null,
    },
  });
  events.emit("moved", {
    brand,
    variant_id,
    location_id,
    movement_type: "release_reserve",
    quantity: Math.abs(quantity),
  });
  return m;
}

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// ── Adjustments (post → adjustment_in/out movements) ─────
function listAdjustments({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listAdjustments({ brand, filters, page, page_size, offset });
}
async function getAdjustment({ brand, id }) {
  const a = await repo.getAdjustment({ brand, id });
  if (!a) throw new NotFoundError("Adjustment");
  return a;
}
async function createAdjustment({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const adj = await repo.createAdjustment({
      client,
      brand,
      header: input,
      user_id: user.user_id,
    });
    for (const line of input.lines)
      await repo.addAdjustmentLine({
        client,
        brand,
        adjustment_id: adj.adjustment_id,
        line,
      });
    await A(
      brand,
      user.user_id,
      "stock.adjustment.create",
      "stock_adjustment",
      adj.adjustment_id,
      adj,
      request_id,
    );
    events.emit("adjustment.created", { brand, id: adj.adjustment_id });
    return repo.getAdjustment({ client, brand, id: adj.adjustment_id });
  });
}
async function postAdjustment({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const adj = await repo.getAdjustment({ client, brand, id });
    if (!adj) throw new NotFoundError("Adjustment");
    if (!["draft", "submitted", "approved"].includes(adj.status)) {
      throw new AppError(
        "INVALID_STATE",
        `Cannot post a '${adj.status}' adjustment`,
        409,
      );
    }
    for (const line of adj.lines) {
      const delta = line.physical_count - line.system_count;
      if (delta === 0) continue;
      await repo.recordMovement({
        client,
        brand,
        user_id: user.user_id,
        input: {
          variant_id: line.variant_id,
          location_id: adj.location_id,
          quantity: delta,
          movement_type: delta > 0 ? "adjustment_in" : "adjustment_out",
          reference_type: "adjustment",
          reference_id: id,
          unit_cost_ngn: line.unit_cost_ngn,
        },
      });
    }
    const posted = await repo.setAdjustmentStatus({
      client,
      brand,
      id,
      status: "posted",
    });
    await A(
      brand,
      user.user_id,
      "stock.adjustment.post",
      "stock_adjustment",
      id,
      { status: "posted" },
      request_id,
    );
    events.emit("adjustment.posted", { brand, id });
    return posted;
  });
}

// ── Transfers (dispatch → transfer_out, receive → transfer_in) ──
function listTransfers({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listTransfers({ brand, filters, page, page_size, offset });
}
async function getTransfer({ brand, id }) {
  const tr = await repo.getTransfer({ brand, id });
  if (!tr) throw new NotFoundError("Transfer");
  return tr;
}
async function createTransfer({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const tr = await repo.createTransfer({
      client,
      brand,
      header: input,
      user_id: user.user_id,
    });
    for (const line of input.lines)
      await repo.addTransferLine({
        client,
        brand,
        transfer_id: tr.transfer_id,
        line,
      });
    await A(
      brand,
      user.user_id,
      "stock.transfer.create",
      "stock_transfer",
      tr.transfer_id,
      tr,
      request_id,
    );
    return repo.getTransfer({ client, brand, id: tr.transfer_id });
  });
}
async function dispatchTransfer({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const tr = await repo.getTransfer({ client, brand, id });
    if (!tr) throw new NotFoundError("Transfer");
    if (tr.status !== "draft")
      throw new AppError(
        "INVALID_STATE",
        `Cannot dispatch a '${tr.status}' transfer`,
        409,
      );
    for (const line of tr.lines) {
      await repo.recordMovement({
        client,
        brand,
        user_id: user.user_id,
        input: {
          variant_id: line.variant_id,
          location_id: tr.from_location_id,
          quantity: -Math.abs(line.qty_dispatched),
          movement_type: "transfer_out",
          reference_type: "transfer",
          reference_id: id,
        },
      });
    }
    const out = await repo.setTransferStatus({
      client,
      brand,
      id,
      status: "dispatched",
      field: "dispatched",
      user_id: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "stock.transfer.dispatch",
      "stock_transfer",
      id,
      { status: "dispatched" },
      request_id,
    );
    events.emit("transfer.dispatched", { brand, id });
    return out;
  });
}
async function receiveTransfer({ brand, user, request_id, id, input = {} }) {
  return transaction(async (client) => {
    const tr = await repo.getTransfer({ client, brand, id });
    if (!tr) throw new NotFoundError("Transfer");
    if (!["dispatched", "in_transit"].includes(tr.status))
      throw new AppError(
        "INVALID_STATE",
        `Cannot receive a '${tr.status}' transfer`,
        409,
      );
    const received = new Map(
      (input.lines || []).map((l) => [l.line_id, l.qty_received]),
    );
    for (const line of tr.lines) {
      const qty = received.has(line.line_id)
        ? received.get(line.line_id)
        : line.qty_dispatched;
      await repo.setTransferLineReceived({
        client,
        brand,
        line_id: line.line_id,
        qty_received: qty,
      });
      if (qty > 0) {
        await repo.recordMovement({
          client,
          brand,
          user_id: user.user_id,
          input: {
            variant_id: line.variant_id,
            location_id: tr.to_location_id,
            quantity: Math.abs(qty),
            movement_type: "transfer_in",
            reference_type: "transfer",
            reference_id: id,
          },
        });
      }
    }
    const done = await repo.setTransferStatus({
      client,
      brand,
      id,
      status: "received",
      field: "received",
      user_id: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "stock.transfer.receive",
      "stock_transfer",
      id,
      { status: "received" },
      request_id,
    );
    events.emit("transfer.received", { brand, id });
    return done;
  });
}

// ── Alerts ───────────────────────────────────────────────
function listAlerts({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listAlerts({ brand, filters, page, page_size, offset });
}
async function setAlertStatus({ brand, user, request_id, id, status }) {
  const a = await repo.setAlertStatus({
    brand,
    id,
    status,
    user_id: user.user_id,
  });
  if (!a) throw new NotFoundError("Alert");
  await A(
    brand,
    user.user_id,
    `stock.alert.${status}`,
    "stock_alert",
    id,
    { status },
    request_id,
  );
  return a;
}

// ── Inbound shipments (receive → receive movements) ──────
function listShipments({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listShipments({ brand, filters, page, page_size, offset });
}
async function getShipment({ brand, id }) {
  const s = await repo.getShipment({ brand, id });
  if (!s) throw new NotFoundError("Shipment");
  return s;
}
async function createShipment({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const sh = await repo.createShipment({ client, brand, header: input });
    for (const line of input.lines || [])
      await repo.addShipmentLine({
        client,
        brand,
        shipment_id: sh.shipment_id,
        line,
      });
    await A(
      brand,
      user.user_id,
      "stock.shipment.create",
      "inbound_shipment",
      sh.shipment_id,
      sh,
      request_id,
    );
    return repo.getShipment({ client, brand, id: sh.shipment_id });
  });
}
async function updateShipmentStatus({ brand, user, request_id, id, status }) {
  const sh = await repo.setShipmentStatus({ brand, id, status });
  if (!sh) throw new NotFoundError("Shipment");
  await A(
    brand,
    user.user_id,
    "stock.shipment.status",
    "inbound_shipment",
    id,
    { status },
    request_id,
  );
  events.emit("shipment.status", { brand, id, status });
  return sh;
}
async function receiveShipment({ brand, user, request_id, id, input = {} }) {
  return transaction(async (client) => {
    const sh = await repo.getShipment({ client, brand, id });
    if (!sh) throw new NotFoundError("Shipment");
    if (sh.status === "received")
      throw new AppError("INVALID_STATE", "Shipment already received", 409);
    const loc = input.location_id
      ? { location_id: input.location_id }
      : await repo.getDefaultLocation({ client, brand });
    if (!loc)
      throw new AppError(
        "NO_STOCK_LOCATION",
        "No location to receive into",
        409,
      );
    const received = new Map((input.lines || []).map((l) => [l.line_id, l]));
    for (const line of sh.lines) {
      const r = received.get(line.line_id) || {};
      const qty =
        r.qty_received !== null && r.qty_received !== undefined
          ? r.qty_received
          : line.qty_expected;
      await repo.setShipmentLineReceived({
        client,
        brand,
        line_id: line.line_id,
        qty_received: qty,
        qty_rejected: r.qty_rejected,
      });
      if (qty > 0) {
        await repo.recordMovement({
          client,
          brand,
          user_id: user.user_id,
          input: {
            variant_id: line.variant_id,
            location_id: loc.location_id,
            quantity: Math.abs(qty),
            movement_type: "receive",
            reference_type: "inbound_shipment",
            reference_id: id,
            unit_cost_ngn: line.unit_cost_ngn,
          },
        });
      }
    }
    const done = await repo.setShipmentStatus({
      client,
      brand,
      id,
      status: "received",
    });
    await A(
      brand,
      user.user_id,
      "stock.shipment.receive",
      "inbound_shipment",
      id,
      { status: "received" },
      request_id,
    );
    events.emit("shipment.received", { brand, id });
    return done;
  });
}

module.exports = {
  listLocations,
  createLocation,
  updateLocation,
  valuation,
  listLevels,
  variantStock,
  listMovements,
  recordMovement,
  deductForSale,
  receiveStock,
  reserveForOrder,
  releaseReservation,
  seedVariant,
  listAdjustments,
  getAdjustment,
  createAdjustment,
  postAdjustment,
  listTransfers,
  getTransfer,
  createTransfer,
  dispatchTransfer,
  receiveTransfer,
  listAlerts,
  setAlertStatus,
  listShipments,
  getShipment,
  createShipment,
  updateShipmentStatus,
  receiveShipment,
};
