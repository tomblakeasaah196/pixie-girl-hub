/**
 * Stock (V2.2 §6.9 — SSOT) — repository.
 * stock_levels is maintained by the fn_apply_stock_movement TRIGGER from
 * stock_movements (signed quantity: +receive / -sale). Never write
 * stock_levels.on_hand directly except the zero-seed for a new variant.
 */

"use strict";

const { ex } = require("../../config/database");
const { t } = require("../../config/brands");
const {
  nextDocumentNumber,
} = require("../../shared/numbering/document-number");
const { logger } = require("../../config/logger");
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
/**
 * The single location every sale reserves and deducts against.
 *
 * `is_default` is NOT globally unique — 000017 indexes it UNIQUE per
 * `location_type`, so a brand can legitimately carry a default warehouse AND a
 * default production/in_transit/reserved_holding row at the same time. The
 * original `ORDER BY is_default DESC, created_at` therefore tiebroke on
 * whichever default happened to be created first, which could hand every
 * reservation to a location that holds no sellable stock (and, when two rows
 * shared a created_at, was not even deterministic).
 *
 * Ordering — never filtering, so a brand whose only location is an odd type
 * still resolves rather than pre-ordering everything:
 *   1. is_default
 *   2. a genuinely sellable type (warehouse/showroom) over transit/production
 *   3. storefront-sellable, then POS-sellable
 *   4. created_at, then location_id — a total order, so the result is stable.
 */
async function getDefaultLocation({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "stock_locations")}
      WHERE is_active = true
      ORDER BY is_default DESC,
               (location_type IN ('warehouse','showroom')) DESC,
               available_for_storefront DESC,
               available_for_pos DESC,
               created_at ASC,
               location_id ASC
      LIMIT 1`,
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
    [...params, page * page_size, offset],
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

/**
 * Non-locking read of one variant's level at one location. For "can we do
 * this?" previews (the Change Order modal's stock warning) — a check that must
 * not take a row lock, because the operator may sit on the preview for a
 * minute before deciding. The reserve/deduct itself still locks and remains
 * the authority.
 */
async function levelFor({ client, brand, variant_id, location_id }) {
  const { rows } = await ex(client)(
    `SELECT on_hand, reserved, available
       FROM ${t(brand, "stock_levels")}
      WHERE variant_id = $1 AND location_id = $2`,
    [variant_id, location_id],
  );
  return rows[0] || null;
}

/**
 * Units THIS order still holds reserved for a variant at a location:
 * sum of its 'reserve' movements minus its 'release_reserve' movements.
 * stock_levels.reserved is an aggregate counter across all orders, so a
 * release must never exceed this figure or it frees someone else's hold.
 */
async function outstandingReservationForOrder({
  client,
  brand,
  variant_id,
  location_id,
  reference_id,
}) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(CASE WHEN movement_type = 'reserve' THEN ABS(quantity)
                              WHEN movement_type = 'release_reserve' THEN -ABS(quantity)
                              ELSE 0 END), 0) AS held
       FROM ${t(brand, "stock_movements")}
      WHERE variant_id = $1 AND location_id = $2
        AND reference_type = 'sales_order' AND reference_id = $3
        AND movement_type IN ('reserve','release_reserve')`,
    [variant_id, location_id, reference_id],
  );
  const held = rows[0] ? Number(rows[0].held) : 0;
  return held > 0 ? held : 0;
}

/**
 * Units THIS order has actually TAKEN off the shelf for a variant at a
 * location: its 'sale' movements minus any 'return' movements booked back
 * against the same order.
 *
 * Two callers depend on this being the ledger truth rather than "the line says
 * quantity N":
 *
 *   • markPaid — an order whose total later rose (a delivery-fee change, or an
 *     amendment) goes back to a balance, and the top-up payment re-enters the
 *     "this payment completed the order" branch. Without this reading, the
 *     second pass would deduct every line a SECOND time.
 *   • the amendment reconciler — removing a line from an already-paid order
 *     must return exactly what that order took, never more (a pre-order line
 *     was never deducted at all, so it has nothing to give back).
 */
async function netSoldForOrder({
  client,
  brand,
  variant_id,
  location_id,
  reference_id,
}) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(CASE WHEN movement_type = 'sale'   THEN ABS(quantity)
                              WHEN movement_type = 'return' THEN -ABS(quantity)
                              ELSE 0 END), 0) AS sold
       FROM ${t(brand, "stock_movements")}
      WHERE variant_id = $1 AND location_id = $2
        AND reference_type = 'sales_order' AND reference_id = $3
        AND movement_type IN ('sale','return')`,
    [variant_id, location_id, reference_id],
  );
  const sold = rows[0] ? Number(rows[0].sold) : 0;
  return sold > 0 ? sold : 0;
}

// Movements (the only way to change on_hand)
/**
 * Movement numbers go through the guarded helper, never the raw SQL function.
 *
 * `fn_next_document_number` RAISEs when shared.document_numbering has no row for
 * (brand, 'stock_movement') — and nothing in this codebase ever seeded that
 * type. Because a RAISE aborts the enclosing transaction, the unguarded call
 * here made EVERY stock movement insert fail, so every checkout reservation
 * failed and every order line was written as a pre-order no matter how much
 * stock was on hand. The helper provisions the row on first use.
 */
async function nextMovementNumber({ client, brand }) {
  return nextDocumentNumber({ client, brand, type: "stock_movement" });
}
/**
 * Every movement carries a soft FK (reference_type + reference_id) to the
 * document that caused it. Reading "SALE −1" without that document is what
 * made the ledger unreadable: you couldn't tell WHICH order, WHICH channel or
 * WHO processed it. These joins resolve the source document inline so both the
 * table and the detail view can name it — one query, no N+1.
 *
 * Each join is guarded on reference_type so a UUID that happens to exist in
 * two tables can never cross-match.
 *
 * NO POS JOIN: the POS terminal module was retired and template 000074 DROPs
 * every per-brand pos_* table, so `pos_transactions` does not exist in any
 * live brand schema. Joining it made Postgres fail at PARSE time, which took
 * the whole Movements tab (and the Overview strip) down with a 500 — a
 * historic 'pos_transaction' movement now reads from its reference_type alone.
 * Only join tables the migrations still create.
 */
function movementJoins(brand) {
  return `LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sm.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
       LEFT JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sm.location_id
       LEFT JOIN shared.users u ON u.user_id = sm.performed_by
       LEFT JOIN ${t(brand, "sales_orders")} so
              ON sm.reference_type = 'sales_order' AND so.order_id = sm.reference_id
       LEFT JOIN shared.contacts ct ON ct.contact_id = so.contact_id
       LEFT JOIN ${t(brand, "stock_adjustments")} adj
              ON sm.reference_type = 'adjustment' AND adj.adjustment_id = sm.reference_id
       LEFT JOIN ${t(brand, "stock_transfers")} trf
              ON sm.reference_type = 'transfer' AND trf.transfer_id = sm.reference_id
       LEFT JOIN ${t(brand, "inbound_shipments")} shp
              ON sm.reference_type IN ('inbound_shipment','goods_received_note')
             AND shp.shipment_id = sm.reference_id`;
}

/** Columns shared by the movements list and the single-movement detail. */
const MOVEMENT_SELECT = `sm.*, pv.sku, pv.variant_name, p.name AS product_name,
            loc.display_name AS location_name,
            COALESCE(u.display_name, u.email) AS performed_by_name,
            so.order_id, so.order_number, so.status AS order_status,
            so.order_type, so.placed_at AS order_placed_at,
            so.sales_channel AS order_sales_channel,
            ct.display_name AS customer_name,
            adj.adjustment_id, adj.adjustment_number, adj.status AS adjustment_status,
            adj.adjustment_type, adj.reason AS adjustment_reason,
            trf.transfer_id, trf.transfer_number, trf.status AS transfer_status,
            shp.shipment_id, shp.shipment_number, shp.status AS shipment_status,
            COALESCE(so.order_number, adj.adjustment_number,
                     trf.transfer_number, shp.shipment_number) AS reference_number`;

/**
 * One movement, fully resolved — the detail modal's payload. Adds the parties
 * the list doesn't need (adjustment raiser/approver, transfer endpoints) so an
 * operator can answer "where did this come from and who did it?" in one look.
 */
async function getMovementById({ client, brand, movement_id }) {
  const { rows } = await ex(client)(
    `SELECT ${MOVEMENT_SELECT},
            adj.created_at AS adjustment_created_at,
            adj.approved_at AS adjustment_approved_at,
            COALESCE(adju.display_name, adju.email) AS adjustment_created_by_name,
            COALESCE(adja.display_name, adja.email) AS adjustment_approved_by_name,
            trf_from.display_name AS transfer_from_location_name,
            trf_to.display_name AS transfer_to_location_name
       FROM ${t(brand, "stock_movements")} sm
       ${movementJoins(brand)}
       LEFT JOIN shared.users adju ON adju.user_id = adj.created_by
       LEFT JOIN shared.users adja ON adja.user_id = adj.approved_by
       LEFT JOIN ${t(brand, "stock_locations")} trf_from ON trf_from.location_id = trf.from_location_id
       LEFT JOIN ${t(brand, "stock_locations")} trf_to ON trf_to.location_id = trf.to_location_id
      WHERE sm.movement_id = $1`,
    [movement_id],
  );
  return rows[0] || null;
}

/**
 * Sibling movements from the same source document (the other lines of the
 * order, the other lines of the adjustment). Lets the detail view show the
 * whole operation, not just the one line that was clicked.
 */
async function siblingMovements({ client, brand, movement }) {
  if (!movement.reference_type || !movement.reference_id) return [];
  const { rows } = await ex(client)(
    `SELECT sm.movement_id, sm.movement_number, sm.movement_type, sm.quantity,
            sm.unit_cost_ngn, sm.performed_at, pv.sku, pv.variant_name,
            p.name AS product_name
       FROM ${t(brand, "stock_movements")} sm
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sm.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE sm.reference_type = $1 AND sm.reference_id = $2
        AND sm.movement_id <> $3
      ORDER BY sm.performed_at ASC LIMIT 50`,
    [movement.reference_type, movement.reference_id, movement.movement_id],
  );
  return rows;
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
    where.push(`sm.variant_id = $${i++}`);
    params.push(filters.variant_id);
  }
  if (filters.movement_type) {
    where.push(`sm.movement_type = $${i++}`);
    params.push(filters.movement_type);
  }
  if (filters.reference_id) {
    where.push(`sm.reference_id = $${i++}`);
    params.push(filters.reference_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "stock_movements")} sm ${w}`,
    params,
  );
  const paged = [...params, page_size, offset];
  const limitPh = `$${i++}`;
  const offsetPh = `$${i++}`;
  let rows;
  try {
    rows = (
      await run(
        `SELECT ${MOVEMENT_SELECT}
       FROM ${t(brand, "stock_movements")} sm
       ${movementJoins(brand)}
       ${w} ORDER BY sm.performed_at DESC LIMIT ${limitPh} OFFSET ${offsetPh}`,
        paged,
      )
    ).rows;
  } catch (err) {
    // The movement ledger is the one screen that must always render. Resolving
    // the source documents reaches into five other modules' tables, and a
    // module can be RETIRED between releases — POS was, and its dropped table
    // turned every request here into a 500 that blanked the Movements tab and
    // the Overview strip. Enrichment is a nicety; the ledger is not. Fall back
    // to the bare movements so the page still works, and log loudly enough
    // that the broken join gets fixed rather than silently tolerated.
    logger.error(
      { err: err.message, brand },
      "stock: movement source enrichment failed — serving un-enriched rows",
    );
    rows = (
      await run(
        `SELECT sm.*, pv.sku, pv.variant_name, p.name AS product_name,
            loc.display_name AS location_name,
            COALESCE(u.display_name, u.email) AS performed_by_name
       FROM ${t(brand, "stock_movements")} sm
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sm.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
       LEFT JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sm.location_id
       LEFT JOIN shared.users u ON u.user_id = sm.performed_by
       ${w} ORDER BY sm.performed_at DESC LIMIT ${limitPh} OFFSET ${offsetPh}`,
        paged,
      )
    ).rows;
  }
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

/**
 * Every movement matching the filters — UN-PAGINATED — for the .xlsx export.
 * Mirrors listMovements' joins (SKU, variant, product) and adds the location
 * name + the performer, so the exported log is self-contained. Supports the
 * same filters the Movements tab exposes (type + location), newest first.
 */
async function movementsForExport({ client, brand, filters = {} }) {
  const where = [];
  const params = [];
  let i = 1;
  if (filters.movement_type) {
    where.push(`sm.movement_type = $${i++}`);
    params.push(filters.movement_type);
  }
  if (filters.location_id) {
    where.push(`sm.location_id = $${i++}`);
    params.push(filters.location_id);
  }
  if (filters.variant_id) {
    where.push(`sm.variant_id = $${i++}`);
    params.push(filters.variant_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await ex(client)(
    `SELECT sm.movement_number, sm.performed_at, sm.movement_type,
            sm.quantity, sm.unit_cost_ngn, sm.sales_channel,
            sm.reference_type, sm.reference_id, sm.notes,
            pv.sku, pv.variant_name, p.name AS product_name,
            loc.display_name AS location_name,
            u.email AS performed_by_email
       FROM ${t(brand, "stock_movements")} sm
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sm.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
       LEFT JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sm.location_id
       LEFT JOIN shared.users u ON u.user_id = sm.performed_by
       ${w} ORDER BY sm.performed_at DESC`,
    params,
  );
  return rows;
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

// ── Variant costing (weighted average, policy Q9) ────────
// Ensure-then-lock: the row is created lazily on the variant's first
// non-exempt movement, then locked so concurrent movements serialise.
async function lockVariantCosting({ client, brand, variant_id }) {
  await ex(client)(
    `INSERT INTO ${t(brand, "variant_costing")} (variant_id)
     VALUES ($1) ON CONFLICT (variant_id) DO NOTHING`,
    [variant_id],
  );
  const { rows } = await ex(client)(
    `SELECT variant_id, qty_tracked, avg_cost_ngn
       FROM ${t(brand, "variant_costing")}
      WHERE variant_id = $1 FOR UPDATE`,
    [variant_id],
  );
  return rows[0];
}

async function updateVariantCosting({
  client,
  brand,
  variant_id,
  qty_tracked,
  avg_cost_ngn,
  movement_id,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "variant_costing")}
        SET qty_tracked = $2, avg_cost_ngn = $3, last_movement_id = $4
      WHERE variant_id = $1`,
    [variant_id, qty_tracked, avg_cost_ngn, movement_id],
  );
}

/**
 * COGS basis per variant: the weighted average when one exists, else the
 * variant's (deprecated but still populated) standard cost. Returns a
 * Map(variant_id → cost string); variants with no basis are absent.
 */
async function getCostBasisForVariants({ client, brand, variant_ids }) {
  if (!variant_ids || variant_ids.length === 0) return new Map();
  const { rows } = await ex(client)(
    `SELECT pv.variant_id,
            COALESCE(NULLIF(vc.avg_cost_ngn, 0), pv.cost_price_ngn) AS unit_cost_ngn
       FROM ${t(brand, "product_variants")} pv
       LEFT JOIN ${t(brand, "variant_costing")} vc ON vc.variant_id = pv.variant_id
      WHERE pv.variant_id = ANY($1)`,
    [variant_ids],
  );
  const map = new Map();
  for (const r of rows) {
    if (r.unit_cost_ngn !== null) map.set(r.variant_id, r.unit_cost_ngn);
  }
  return map;
}

/** Transfers / adjustments / counts — same guard, same reason as above. */
async function nextDocNumber({ client, brand, type }) {
  return nextDocumentNumber({ client, brand, type });
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
    `SELECT sal.*, pv.sku, pv.variant_name, p.name AS product_name
       FROM ${t(brand, "stock_adjustment_lines")} sal
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sal.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE sal.adjustment_id = $1`,
    [adjustment_id],
  );
  return rows;
}
async function listAdjustmentLinesForAdjustments({
  client,
  brand,
  adjustment_ids,
}) {
  if (!adjustment_ids.length) return {};
  const { rows } = await ex(client)(
    `SELECT sal.*, pv.sku, pv.variant_name, p.name AS product_name
       FROM ${t(brand, "stock_adjustment_lines")} sal
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sal.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE sal.adjustment_id = ANY($1::uuid[])`,
    [adjustment_ids],
  );
  const byAdjustment = {};
  for (const line of rows) {
    (byAdjustment[line.adjustment_id] ??= []).push(line);
  }
  return byAdjustment;
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
  const linesByAdjustment = await listAdjustmentLinesForAdjustments({
    client,
    brand,
    adjustment_ids: rows.map((r) => r.adjustment_id),
  });
  rows.forEach((r) => {
    r.lines = linesByAdjustment[r.adjustment_id] ?? [];
  });
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

// Who to notify when an adjustment is submitted for approval: the CEO
// (bypasses the permission matrix entirely) plus anyone holding a `stock`
// module `approve` grant under this brand (or an all-brands '*' grant).
// Mirrors the exact tables requirePermission()/identityCache check — see
// src/middleware/rbac.js — so this list never drifts from what the approve
// endpoints themselves actually accept.
async function listAdjustmentApprovers({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT DISTINCT u.user_id, u.email, u.display_name
       FROM shared.users u
      WHERE u.is_active = true
        AND (
          u.is_ceo = true
          OR u.user_id IN (
            SELECT ur.user_id
              FROM shared.user_roles ur
              JOIN shared.permissions p ON p.role_id = ur.role_id
             WHERE p.module = 'stock' AND p.action = 'approve'
               AND (ur.business = '*' OR ur.business = $1)
               AND (ur.expires_at IS NULL OR ur.expires_at > now())
          )
        )`,
    [brand],
  );
  return rows;
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
    `SELECT stl.*, pv.sku, pv.variant_name, p.name AS product_name
       FROM ${t(brand, "stock_transfer_lines")} stl
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = stl.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE stl.transfer_id = $1`,
    [transfer_id],
  );
  return rows;
}
async function listTransferLinesForTransfers({ client, brand, transfer_ids }) {
  if (!transfer_ids.length) return {};
  const { rows } = await ex(client)(
    `SELECT stl.*, pv.sku, pv.variant_name, p.name AS product_name
       FROM ${t(brand, "stock_transfer_lines")} stl
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = stl.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE stl.transfer_id = ANY($1::uuid[])`,
    [transfer_ids],
  );
  const byTransfer = {};
  for (const line of rows) {
    (byTransfer[line.transfer_id] ??= []).push(line);
  }
  return byTransfer;
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
  const linesByTransfer = await listTransferLinesForTransfers({
    client,
    brand,
    transfer_ids: rows.map((r) => r.transfer_id),
  });
  rows.forEach((r) => {
    r.lines = linesByTransfer[r.transfer_id] ?? [];
  });
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

// The product's default (then first) variant — the stock-bearing SKU a base
// product receives into. Mirrors catalogue.repo.getDefaultVariant so Goods
// Reception can take a base product_id and move stock without coupling to the
// catalogue module.
async function defaultVariantForProduct({ client, brand, product_id }) {
  const { rows } = await ex(client)(
    `SELECT variant_id, sku, variant_name FROM ${t(brand, "product_variants")}
      WHERE product_id = $1
      ORDER BY is_default DESC, display_order ASC, created_at ASC
      LIMIT 1`,
    [product_id],
  );
  return rows[0] || null;
}

/**
 * The best variant of `product_id` to draw `quantity` units from AT
 * `location_id` — i.e. one whose reservation is guaranteed to succeed against
 * the `reserved <= on_hand` invariant.
 *
 * Deliberately different from `defaultVariantForProduct`, which is ordering-
 * based and stock-blind: it can hand back an inactive variant, or an active one
 * with nothing on the shelf, which then fails to reserve and silently becomes a
 * pre-order. Availability reads sum stock across every location while the sale
 * only ever reserves at ONE, so a donor must be chosen against that same
 * location or the two disagree.
 *
 * Returns null when no single variant of this product can cover `quantity`
 * there — callers fall back to their existing pre-order handling.
 */
async function variantWithStockForProduct({
  client,
  brand,
  product_id,
  location_id,
  quantity,
}) {
  const { rows } = await ex(client)(
    `SELECT pv.variant_id, pv.sku, pv.variant_name, sl.available
       FROM ${t(brand, "product_variants")} pv
       JOIN ${t(brand, "stock_levels")} sl
         ON sl.variant_id = pv.variant_id AND sl.location_id = $2
      WHERE pv.product_id = $1
        AND pv.is_active = true
        AND sl.available >= $3
      ORDER BY sl.available DESC, pv.display_order ASC, pv.created_at ASC
      LIMIT 1`,
    [product_id, location_id, quantity],
  );
  return rows[0] || null;
}

// ── Inbound shipments (+ lines) ──────────────────────────
// destination_location_id / received_at / received_by_name / notes / status /
// created_by are all optional on insert — the detailed shipment flow omits the
// first four (DB defaults apply); Goods Reception sets them to land stock at a
// location, dated, attributed, with status pre-set to 'received'.
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
  "destination_location_id",
  "received_at",
  "received_by_name",
  "notes",
  "status",
  "created_by",
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
    `SELECT isl.*, pv.sku, pv.variant_name, p.name AS product_name
       FROM ${t(brand, "inbound_shipment_lines")} isl
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = isl.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE isl.shipment_id = $1`,
    [shipment_id],
  );
  return rows;
}
async function listShipmentLinesForShipments({ client, brand, shipment_ids }) {
  if (!shipment_ids.length) return {};
  const { rows } = await ex(client)(
    `SELECT isl.*, pv.sku, pv.variant_name, p.name AS product_name
       FROM ${t(brand, "inbound_shipment_lines")} isl
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = isl.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
      WHERE isl.shipment_id = ANY($1::uuid[])`,
    [shipment_ids],
  );
  const byShipment = {};
  for (const line of rows) {
    (byShipment[line.shipment_id] ??= []).push(line);
  }
  return byShipment;
}
async function getShipment({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT s.*, loc.display_name AS destination_location_name
       FROM ${t(brand, "inbound_shipments")} s
       LEFT JOIN ${t(brand, "stock_locations")} loc
         ON loc.location_id = s.destination_location_id
      WHERE s.shipment_id = $1`,
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
    `SELECT s.*, loc.display_name AS destination_location_name,
            (SELECT COUNT(*)::int FROM ${t(brand, "inbound_shipment_lines")} l
              WHERE l.shipment_id = s.shipment_id) AS line_count
       FROM ${t(brand, "inbound_shipments")} s
       LEFT JOIN ${t(brand, "stock_locations")} loc
         ON loc.location_id = s.destination_location_id
       ${w}
      ORDER BY s.created_at DESC LIMIT $${i++} OFFSET $${i++}`,
    [...params, page_size, offset],
  );
  const linesByShipment = await listShipmentLinesForShipments({
    client,
    brand,
    shipment_ids: rows.map((r) => r.shipment_id),
  });
  rows.forEach((r) => {
    r.lines = linesByShipment[r.shipment_id] ?? [];
  });
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

/**
 * Full stock-on-hand snapshot — ONE un-paginated row per variant × location,
 * with the product/variant/location names, on-hand/reserved/available and the
 * variant's unit cost + line value. This is the source for the .xlsx export
 * (the "export my total stock" file); unlike listLevels it is never paginated,
 * so every tracked SKU is present. Ordered for a readable stocktake.
 */
async function onHandSnapshot({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT sl.variant_id, sl.location_id,
            loc.display_name AS location_name,
            p.product_id, p.name AS product_name, p.product_code,
            pv.sku, pv.variant_name,
            sl.on_hand, sl.reserved, sl.available,
            COALESCE(pv.cost_price_ngn, 0) AS unit_cost_ngn,
            (sl.on_hand * COALESCE(pv.cost_price_ngn, 0))::numeric(14,2) AS value_ngn
       FROM ${t(brand, "stock_levels")} sl
       JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = sl.variant_id
       JOIN ${t(brand, "products")} p ON p.product_id = pv.product_id
       JOIN ${t(brand, "stock_locations")} loc ON loc.location_id = sl.location_id
      ORDER BY loc.display_name ASC, p.name ASC, pv.sku ASC`,
  );
  return rows;
}

module.exports = {
  listLocations,
  getDefaultLocation,
  createLocation,
  updateLocation,
  valuation,
  onHandSnapshot,
  listLevels,
  levelsForVariant,
  seedLevel,
  lockLevel,
  levelFor,
  outstandingReservationForOrder,
  netSoldForOrder,
  nextMovementNumber,
  nextDocNumber,
  defaultVariantForProduct,
  variantWithStockForProduct,
  listMovements,
  getMovementById,
  siblingMovements,
  movementsForExport,
  recordMovement,
  lockVariantCosting,
  updateVariantCosting,
  getCostBasisForVariants,
  createAdjustment,
  addAdjustmentLine,
  listAdjustmentLines,
  getAdjustment,
  listAdjustments,
  setAdjustmentStatus,
  listAdjustmentApprovers,
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
