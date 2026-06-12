/**
 * Stock (V2.2 §6.9 — SSOT) — repository.
 * stock_levels is maintained by the fn_apply_stock_movement TRIGGER from
 * stock_movements (signed quantity: +receive / -sale). Never write
 * stock_levels.on_hand directly except the zero-seed for a new variant.
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

const LOC = [
  "location_code",
  "display_name",
  "location_type",
  "address",
  "city",
  "state",
  "country",
  "latitude",
  "longitude",
  "available_for_storefront",
  "available_for_pos",
  "is_active",
  "is_default",
];
const MOV = [
  "variant_id",
  "location_id",
  "quantity",
  "movement_type",
  "sales_channel",
  "reference_type",
  "reference_id",
  "unit_cost_ngn",
  "counterparty_type",
  "counterparty_id",
  "notes",
];

function ins(cols, src, extra = {}) {
  const f = [],
    ph = [],
    p = [];
  let i = 1;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(c);
    ph.push(`$${i++}`);
    p.push(src[c]);
  }
  for (const [c, v] of Object.entries(extra)) {
    f.push(c);
    ph.push(`$${i++}`);
    p.push(v);
  }
  return { f, ph, p };
}
function upd(cols, src, start = 1) {
  const f = [],
    p = [];
  let i = start;
  for (const c of cols) {
    if (src[c] === undefined) continue;
    f.push(`${c} = $${i++}`);
    p.push(src[c]);
  }
  return { f, p, next: i };
}

// Locations
async function listLocations({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_locations")} ORDER BY is_default DESC, display_name`,
  );
  return rows;
}
async function getDefaultLocation({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_locations")} WHERE is_active = true ORDER BY is_default DESC, created_at LIMIT 1`,
  );
  return rows[0] || null;
}
async function createLocation({ client, brand, input }) {
  const { f, ph, p } = ins(LOC, input);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_locations")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateLocation({ client, brand, id, patch }) {
  const { f, p, next } = upd(LOC, patch);
  if (!f.length) {
    const { rows } = await ex(client)(
      `SELECT * FROM ${t(brand, "stock_locations")} WHERE location_id=$1`,
      [id],
    );
    return rows[0] || null;
  }
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "stock_locations")} SET ${f.join(",")} WHERE location_id = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}

// Levels
async function listLevels({
  client,
  brand,
  variant_id,
  location_id,
  page = 1,
  page_size = 50,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (variant_id) {
    where.push(`sl.variant_id = $${i++}`);
    params.push(variant_id);
  }
  if (location_id) {
    where.push(`sl.location_id = $${i++}`);
    params.push(location_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT sl.*, pv.sku, pv.variant_name FROM ${t(brand, "stock_levels")} sl
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
       ${w} ORDER BY sl.updated_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page, page_size, offset],
  );
  return rows;
}
async function levelsForVariant({ client, brand, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT sl.*, loc.display_name AS location_name FROM ${t(brand, "stock_levels")} sl
       JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sl.location_id
      WHERE sl.variant_id = $1`,
    [variant_id],
  );
  return rows;
}
async function seedLevel({ client, brand, variant_id, location_id }) {
  await ex(client)(
    `INSERT INTO ${t(brand, "stock_levels")} (variant_id, location_id, on_hand)
     VALUES ($1, $2, 0) ON CONFLICT (variant_id, location_id) DO NOTHING`,
    [variant_id, location_id],
  );
}

// Lock the (variant, location) level row FOR UPDATE so an oversell pre-check is
// race-safe: concurrent sale deductions on the same level serialize here.
// Requires a transaction client. Returns null when no level row exists yet.
async function lockLevel({ client, brand, variant_id, location_id }) {
  const { rows } = await client.query(
    `SELECT on_hand, reserved, available
       FROM ${t(brand, "stock_levels")}
      WHERE variant_id = $1 AND location_id = $2
      FOR UPDATE`,
    [variant_id, location_id],
  );
  return rows[0] || null;
}

// Movements (the only way to change on_hand)
async function nextMovementNumber({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}('stock_movement') AS n`,
  );
  return rows[0].n;
}
async function listMovements({
  client,
  brand,
  filters = {},
  page = 1,
  page_size = 50,
  offset = 0,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.variant_id) {
    where.push(`variant_id = $${i++}`);
    params.push(filters.variant_id);
  }
  if (filters.movement_type) {
    where.push(`movement_type = $${i++}`);
    params.push(filters.movement_type);
  }
  if (filters.reference_id) {
    where.push(`reference_id = $${i++}`);
    params.push(filters.reference_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "stock_movements")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "stock_movements")} ${w} ORDER BY performed_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function recordMovement({ client, brand, input, user_id }) {
  const movement_number = await nextMovementNumber({ client, brand });
  const { f, ph, p } = ins(MOV, input, {
    movement_number,
    performed_by: user_id,
  });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_movements")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

async function nextDocNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}

// ── Adjustments (+ lines) ────────────────────────────────
async function createAdjustment({ client, brand, header, user_id }) {
  const num = await nextDocNumber({ client, brand, type: "stock_adjustment" });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_adjustments")}
       (adjustment_number, location_id, adjustment_type, reason, evidence_document_id, approval_required_above_units, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      num,
      header.location_id,
      header.adjustment_type,
      header.reason,
      header.evidence_document_id || null,
      header.approval_required_above_units ?? null,
      user_id,
    ],
  );
  return rows[0];
}
async function addAdjustmentLine({ client, brand, adjustment_id, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_adjustment_lines")} (adjustment_id, variant_id, system_count, physical_count, unit_cost_ngn, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      adjustment_id,
      line.variant_id,
      line.system_count,
      line.physical_count,
      line.unit_cost_ngn ?? null,
      line.notes || null,
    ],
  );
  return rows[0];
}
async function listAdjustmentLines({ client, brand, adjustment_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_adjustment_lines")} WHERE adjustment_id = $1`,
    [adjustment_id],
  );
  return rows;
}
async function getAdjustment({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_adjustments")} WHERE adjustment_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  rows[0].lines = await listAdjustmentLines({
    client,
    brand,
    adjustment_id: id,
  });
  return rows[0];
}
async function listAdjustments({
  client,
  brand,
  page = 1,
  page_size = 25,
  offset = 0,
  filters = {},
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.location_id) {
    where.push(`location_id = $${i++}`);
    params.push(filters.location_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "stock_adjustments")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "stock_adjustments")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setAdjustmentStatus({ client, brand, id, status, approved_by }) {
  const extra =
    status === "approved"
      ? ", approved_by = $3, approved_at = now()"
      : status === "posted"
        ? ", posted_at = now()"
        : "";
  const params =
    approved_by && status === "approved"
      ? [id, status, approved_by]
      : [id, status];
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "stock_adjustments")} SET status = $2${extra} WHERE adjustment_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Transfers (+ lines) ──────────────────────────────────
async function createTransfer({ client, brand, header, user_id }) {
  const num = await nextDocNumber({ client, brand, type: "stock_transfer" });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_transfers")} (transfer_number, from_location_id, to_location_id, reason, carrier_name, tracking_reference, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      num,
      header.from_location_id,
      header.to_location_id,
      header.reason || null,
      header.carrier_name || null,
      header.tracking_reference || null,
      user_id,
    ],
  );
  return rows[0];
}
async function addTransferLine({ client, brand, transfer_id, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_transfer_lines")} (transfer_id, variant_id, qty_dispatched, notes) VALUES ($1,$2,$3,$4) RETURNING *`,
    [transfer_id, line.variant_id, line.qty_dispatched, line.notes || null],
  );
  return rows[0];
}
async function listTransferLines({ client, brand, transfer_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_transfer_lines")} WHERE transfer_id = $1`,
    [transfer_id],
  );
  return rows;
}
async function getTransfer({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_transfers")} WHERE transfer_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  rows[0].lines = await listTransferLines({ client, brand, transfer_id: id });
  return rows[0];
}
async function listTransfers({
  client,
  brand,
  page = 1,
  page_size = 25,
  offset = 0,
  filters = {},
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "stock_transfers")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "stock_transfers")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setTransferStatus({
  client,
  brand,
  id,
  status,
  field,
  user_id,
}) {
  const stamp = field ? `, ${field}_by = $3, ${field}_at = now()` : "";
  const params = field ? [id, status, user_id] : [id, status];
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "stock_transfers")} SET status = $2${stamp} WHERE transfer_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function setTransferLineReceived({
  client,
  brand,
  line_id,
  qty_received,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "stock_transfer_lines")} SET qty_received = $2 WHERE line_id = $1`,
    [line_id, qty_received],
  );
}

// ── Alerts ───────────────────────────────────────────────
async function listAlerts({
  client,
  brand,
  page = 1,
  page_size = 50,
  offset = 0,
  filters = {},
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.variant_id) {
    where.push(`variant_id = $${i++}`);
    params.push(filters.variant_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "stock_alerts")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "stock_alerts")} ${w} ORDER BY detected_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function createAlert({ client, brand, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "stock_alerts")}
       (variant_id, location_id, alert_type, on_hand_at_detection, reorder_point, daily_velocity, projected_days_left, severity, suppression_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'medium'),$9) RETURNING *`,
    [
      input.variant_id,
      input.location_id || null,
      input.alert_type,
      input.on_hand_at_detection,
      input.reorder_point,
      input.daily_velocity ?? null,
      input.projected_days_left ?? null,
      input.severity,
      input.suppression_key,
    ],
  );
  return rows[0];
}
async function setAlertStatus({ client, brand, id, status, user_id }) {
  const stamp =
    status === "acknowledged"
      ? ", acknowledged_by = $3, acknowledged_at = now()"
      : status === "resolved"
        ? ", resolved_at = now()"
        : "";
  const params =
    status === "acknowledged" ? [id, status, user_id] : [id, status];
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "stock_alerts")} SET status = $2${stamp} WHERE alert_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Inbound shipments (+ lines) ──────────────────────────
const SHP_COLS = [
  "origin_country",
  "origin_port",
  "carrier_name",
  "tracking_reference",
  "shipping_method",
  "total_factory_cost_ngn",
  "total_freight_ngn",
  "total_customs_ngn",
  "total_other_ngn",
];
async function createShipment({ client, brand, header }) {
  const num = await nextDocNumber({ client, brand, type: "inbound_shipment" });
  const { f, ph, p } = ins(SHP_COLS, header, { shipment_number: num });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "inbound_shipments")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function addShipmentLine({ client, brand, shipment_id, line }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "inbound_shipment_lines")} (shipment_id, variant_id, po_line_id, qty_expected, unit_cost, unit_cost_currency, unit_cost_ngn, fx_rate_used, unit_weight_g, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      shipment_id,
      line.variant_id,
      line.po_line_id || null,
      line.qty_expected,
      line.unit_cost ?? null,
      line.unit_cost_currency || null,
      line.unit_cost_ngn ?? null,
      line.fx_rate_used ?? null,
      line.unit_weight_g ?? null,
      line.notes || null,
    ],
  );
  return rows[0];
}
async function listShipmentLines({ client, brand, shipment_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "inbound_shipment_lines")} WHERE shipment_id = $1`,
    [shipment_id],
  );
  return rows;
}
async function getShipment({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "inbound_shipments")} WHERE shipment_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  rows[0].lines = await listShipmentLines({ client, brand, shipment_id: id });
  return rows[0];
}
async function listShipments({
  client,
  brand,
  page = 1,
  page_size = 25,
  offset = 0,
  filters = {},
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "inbound_shipments")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "inbound_shipments")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: c[0].total,
      has_more: offset + rows.length < c[0].total,
    },
  };
}
async function setShipmentStatus({ client, brand, id, status }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "inbound_shipments")} SET status = $2 WHERE shipment_id = $1 RETURNING *`,
    [id, status],
  );
  return rows[0] || null;
}
async function setShipmentLineReceived({
  client,
  brand,
  line_id,
  qty_received,
  qty_rejected,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "inbound_shipment_lines")} SET qty_received = $2, qty_rejected = $3 WHERE line_id = $1`,
    [line_id, qty_received, qty_rejected ?? null],
  );
}

// ── Valuation (on_hand × variant standard cost) ──────────
async function valuation({ client, brand, filters = {} }) {
  const where = ["sl.on_hand > 0"];
  const params = [];
  let i = 1;
  if (filters.location_id) {
    where.push(`sl.location_id = $${i++}`);
    params.push(filters.location_id);
  }
  if (filters.variant_id) {
    where.push(`sl.variant_id = $${i++}`);
    params.push(filters.variant_id);
  }
  if (filters.product_id) {
    where.push(`pv.product_id = $${i++}`);
    params.push(filters.product_id);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: lines } = await run(
    `SELECT sl.variant_id, sl.location_id, loc.display_name AS location_name,
            pv.product_id, pv.sku, pv.variant_name,
            sl.on_hand, COALESCE(pv.cost_price_ngn, 0) AS unit_cost_ngn,
            (sl.on_hand * COALESCE(pv.cost_price_ngn, 0))::numeric(14,2) AS value_ngn
       FROM ${t(brand, "stock_levels")} sl
       JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
       JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sl.location_id
       ${w}
      ORDER BY value_ngn DESC`,
    params,
  );
  const { rows: summary } = await run(
    `SELECT COUNT(*)::int AS sku_locations,
            COALESCE(SUM(sl.on_hand), 0)::int AS total_units,
            COALESCE(SUM(sl.on_hand * COALESCE(pv.cost_price_ngn, 0)), 0)::numeric(14,2) AS total_value_ngn,
            COUNT(*) FILTER (WHERE pv.cost_price_ngn IS NULL)::int AS missing_cost_count
       FROM ${t(brand, "stock_levels")} sl
       JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
       ${w}`,
    params,
  );
  return { lines, summary: summary[0] };
}

module.exports = {
  listLocations,
  getDefaultLocation,
  createLocation,
  updateLocation,
  valuation,
  listLevels,
  levelsForVariant,
  seedLevel,
  lockLevel,
  nextMovementNumber,
  nextDocNumber,
  listMovements,
  recordMovement,
  createAdjustment,
  addAdjustmentLine,
  listAdjustmentLines,
  getAdjustment,
  listAdjustments,
  setAdjustmentStatus,
  createTransfer,
  addTransferLine,
  listTransferLines,
  getTransfer,
  listTransfers,
  setTransferStatus,
  setTransferLineReceived,
  listAlerts,
  createAlert,
  setAlertStatus,
  createShipment,
  addShipmentLine,
  listShipmentLines,
  getShipment,
  listShipments,
  setShipmentStatus,
  setShipmentLineReceived,
};
