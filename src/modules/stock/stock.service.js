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
const costing = require("./stock.costing");
const countSheet = require("./stock.count-sheet");
const countPlan = require("./stock.count-plan");
const careCount = require("./stock.care-count");
const careGate = require("../catalogue/care-accessories.gate");
const vault = require("../catalogue/cost_vault.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError, PermissionDeniedError } = require("../../utils/errors");
const { buildWorkbook } = require("../../services/spreadsheet.service");

// GL treatment per movement type (policies Q5/Q6). 'sale' is EXCLUDED —
// the order.paid sale journal owns COGS/inventory relief for sales.
// Inbound value arrives via GRNI 2050 (cleared when the supplier invoice
// is approved); shrinkage hits Wastage 5080; found stock is Other Income;
// customer returns reverse COGS at cost.
const MOVEMENT_GL = {
  receive: { debit: "INVENTORY_FG", credit: "GRNI", source: "goods_received" },
  production_in: { debit: "INVENTORY_FG", credit: "GRNI", source: "goods_received" },
  adjustment_in: { debit: "INVENTORY_FG", credit: "OTHER_INCOME", source: "stock_adjustment" },
  adjustment_out: { debit: "WASTAGE", credit: "INVENTORY_FG", source: "stock_adjustment" },
  damage: { debit: "WASTAGE", credit: "INVENTORY_FG", source: "stock_adjustment" },
  sample: { debit: "WASTAGE", credit: "INVENTORY_FG", source: "stock_adjustment" },
  theft_writeoff: { debit: "WASTAGE", credit: "INVENTORY_FG", source: "stock_adjustment" },
  return: { debit: "INVENTORY_FG", credit: "COGS", source: "refund" },
};

/**
 * Record a movement AND, in the same transaction: (1) maintain the
 * variant's weighted-average cost (policy Q9); (2) post the movement's GL
 * journal (policies Q5/Q6) at the movement's cost — falling back to the
 * weighted average for uncosted outbound movements. Every movement write
 * in this module goes through here — never call repo.recordMovement
 * directly, or the books drift from the movement ledger.
 */
async function applyMovement({ client, brand, input, user_id }) {
  const m = await repo.recordMovement({ client, brand, input, user_id });
  let costBefore = null;
  if (!costing.isCostingExempt(m.movement_type)) {
    const current = await repo.lockVariantCosting({
      client,
      brand,
      variant_id: m.variant_id,
    });
    costBefore = current ? current.avg_cost_ngn : null;
    const next = costing.applyMovementToCosting(current, m);
    await repo.updateVariantCosting({
      client,
      brand,
      variant_id: m.variant_id,
      qty_tracked: next.qty_tracked,
      avg_cost_ngn: next.avg_cost_ngn,
      movement_id: m.movement_id,
    });
  }

  const gl = MOVEMENT_GL[m.movement_type];
  if (gl) {
    const { money, toCurrencyString } = require("../../utils/money");
    const unitCost =
      m.unit_cost_ngn !== null && m.unit_cost_ngn !== undefined
        ? money(m.unit_cost_ngn)
        : costBefore && money(costBefore).gt(0)
          ? money(costBefore)
          : null;
    // No cost basis at all → nothing valuable moved on the books; skip
    // rather than invent a figure (the GRNI clearing at invoice approval
    // surfaces any residue).
    if (unitCost && unitCost.gt(0)) {
      const accounting = require("../accounting/accounting.service");
      const { ACCOUNTS } = require("../accounting/posting-map");
      // Intercompany receipts: the buyer's IC journal already expensed the
      // trade to IC-COGS 5060 at approval — receiving the goods reclasses
      // that into inventory (never GRNI, or the value would double-count).
      const creditKey =
        m.movement_type === "receive" && m.reference_type === "intercompany"
          ? "COGS_INTERCOMPANY"
          : gl.credit;
      const value = toCurrencyString(unitCost.times(Math.abs(m.quantity)));
      await accounting.postEntry({
        client,
        brand,
        user_id,
        entry: {
          source_type: gl.source,
          source_table: "stock_movements",
          source_id: m.movement_id,
          reference: m.movement_number,
          description: `Stock ${m.movement_type} — ${m.movement_number}`,
          idempotency_key: `stock_move:${m.movement_id}`,
        },
        lines: [
          {
            account_code: ACCOUNTS[gl.debit],
            debit_ngn: value,
            description: `${m.movement_type} — ${m.movement_number}`,
          },
          {
            account_code: ACCOUNTS[creditKey],
            credit_ngn: value,
            description: `${m.movement_type} — ${m.movement_number}`,
          },
        ],
      });
    }
  }

  // Pre-order fulfilment hook (000097): a movement that ADDS to the shelf may be
  // the stock a paid/placed pre-order has been waiting on. Enqueue a durable,
  // post-commit `stock.received` so the allocator (sales/preorder-allocation)
  // draws it for paid pre-orders and reserves it for unpaid ones — paid-first,
  // oldest-first — before that stock is exposed to a fresh sale. Atomic with the
  // movement (writes on the caller's tx client), deduped per movement so an
  // at-least-once dispatch never enqueues twice, and only for inbound types so a
  // sale/reserve/return never triggers a pointless sweep.
  const RAISES_ON_HAND = m.movement_type === "receive"
    || m.movement_type === "production_in"
    || m.movement_type === "adjustment_in";
  if (client && RAISES_ON_HAND && Number(m.quantity) > 0 && m.variant_id) {
    try {
      const outbox = require("../../shared/outbox/outbox");
      await outbox.enqueue(client, {
        business: brand,
        event_type: "stock.received",
        payload: {
          variant_id: m.variant_id,
          location_id: m.location_id,
          movement_id: m.movement_id,
          movement_type: m.movement_type,
        },
        dedup_key: `stock.received:${m.movement_id}`,
      });
    } catch (err) {
      // Never let the fulfilment hook fail the movement itself — the receipt is
      // the system of record; the deploy reconcile sweep will catch anything a
      // missed enqueue leaves behind.
      const { logger } = require("../../config/logger");
      logger.warn(
        { err: err.message, brand, movement_id: m.movement_id },
        "stock.received enqueue skipped — deploy reconcile will backfill",
      );
    }
  }

  return m;
}

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

// Excel sheet names: ≤31 chars, none of : \ / ? * [ ]; non-blank; unique.
function sheetName(raw, used) {
  let name = String(raw || "Location")
    .replace(/[:\\/?*[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  if (!name) name = "Location";
  let candidate = name;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = `${name.slice(0, 31 - suffix.length)}${suffix}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

const SNAPSHOT_COLUMNS = [
  { header: "Product", key: "product_name", width: 40 },
  { header: "Variant", key: "variant_name", width: 26 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "On hand", key: "on_hand", width: 10 },
  { header: "Reserved", key: "reserved", width: 10 },
  { header: "Available", key: "available", width: 10 },
  { header: "Unit cost (NGN)", key: "unit_cost_ngn", width: 16 },
  { header: "Value (NGN)", key: "value_ngn", width: 16 },
];

function toSheetRow(r) {
  return {
    product_name: r.product_name,
    variant_name: r.variant_name || "",
    sku: r.sku || "",
    on_hand: Number(r.on_hand) || 0,
    reserved: Number(r.reserved) || 0,
    available: Number(r.available) || 0,
    unit_cost_ngn: Number(r.unit_cost_ngn) || 0,
    value_ngn: Number(r.value_ngn) || 0,
  };
}

/**
 * Build the stock-on-hand .xlsx: one "All Locations" summary sheet (each SKU
 * once, quantities + value summed across locations) followed by one sheet per
 * stock location. Un-paginated — the whole tracked catalogue in a single file.
 * Returns an .xlsx Buffer.
 */
async function exportOnHand({ brand }) {
  const rows = await repo.onHandSnapshot({ brand });

  // Summary: collapse to one row per variant, summing across locations. Unit
  // cost is per-variant (constant across locations), so it is carried, not
  // summed; value re-sums so it reflects the summed on-hand.
  const byVariant = new Map();
  for (const r of rows) {
    const key = r.variant_id;
    const cur = byVariant.get(key) || {
      product_name: r.product_name,
      variant_name: r.variant_name,
      sku: r.sku,
      on_hand: 0,
      reserved: 0,
      available: 0,
      unit_cost_ngn: Number(r.unit_cost_ngn) || 0,
      value_ngn: 0,
    };
    cur.on_hand += Number(r.on_hand) || 0;
    cur.reserved += Number(r.reserved) || 0;
    cur.available += Number(r.available) || 0;
    cur.value_ngn += Number(r.value_ngn) || 0;
    byVariant.set(key, cur);
  }
  const summaryRows = [...byVariant.values()]
    .sort(
      (a, b) =>
        String(a.product_name).localeCompare(String(b.product_name)) ||
        String(a.sku).localeCompare(String(b.sku)),
    )
    .map(toSheetRow);

  const sheets = [
    { name: "All Locations", columns: SNAPSHOT_COLUMNS, rows: summaryRows },
  ];

  // One sheet per location, in the order locations first appear (rows are
  // already ordered by location name).
  const used = new Set(["all locations"]);
  const byLocation = new Map();
  for (const r of rows) {
    if (!byLocation.has(r.location_id)) {
      byLocation.set(r.location_id, { name: r.location_name, rows: [] });
    }
    byLocation.get(r.location_id).rows.push(toSheetRow(r));
  }
  for (const loc of byLocation.values()) {
    sheets.push({
      name: sheetName(loc.name, used),
      columns: SNAPSHOT_COLUMNS,
      rows: loc.rows,
    });
  }

  return buildWorkbook({ sheets });
}

const MOVEMENT_COLUMNS = [
  { header: "Date", key: "date", width: 20 },
  { header: "Movement #", key: "movement_number", width: 18 },
  { header: "Type", key: "movement_type", width: 16 },
  { header: "Product", key: "product_name", width: 40 },
  { header: "Variant", key: "variant_name", width: 22 },
  { header: "SKU", key: "sku", width: 16 },
  { header: "Location", key: "location_name", width: 24 },
  { header: "Qty", key: "quantity", width: 8 },
  { header: "Unit cost (NGN)", key: "unit_cost_ngn", width: 16 },
  { header: "Channel", key: "sales_channel", width: 14 },
  { header: "Reference", key: "reference", width: 22 },
  { header: "Notes", key: "notes", width: 30 },
  { header: "Performed by", key: "performed_by_email", width: 26 },
];

// dd/mm/yyyy HH:MM — matches the on-screen movement timestamps.
function fmtTs(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * ALL stock movements as a single-sheet .xlsx — the complete log, never a
 * page. Respects the Movements tab's type + location filters so a filtered
 * view exports exactly what it shows (minus the client-only text search).
 * Returns an .xlsx Buffer.
 */
async function exportMovements({ brand, filters = {} }) {
  const rows = await repo.movementsForExport({ brand, filters });
  const sheetRows = rows.map((r) => ({
    date: fmtTs(r.performed_at),
    movement_number: r.movement_number || "",
    movement_type: r.movement_type || "",
    product_name: r.product_name || "",
    variant_name: r.variant_name || "",
    sku: r.sku || "",
    location_name: r.location_name || "",
    quantity: Number(r.quantity) || 0,
    unit_cost_ngn:
      r.unit_cost_ngn === null || r.unit_cost_ngn === undefined
        ? ""
        : Number(r.unit_cost_ngn),
    sales_channel: r.sales_channel || "",
    reference: r.reference_id
      ? `${r.reference_type || "ref"}:${r.reference_id}`
      : "",
    notes: r.notes || "",
    performed_by_email: r.performed_by_email || "",
  }));
  return buildWorkbook({
    sheets: [{ name: "Movements", columns: MOVEMENT_COLUMNS, rows: sheetRows }],
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

/**
 * Base-product stock register (Stock → Products): one row per BASE product
 * with quantities summed across its variants, searchable by name / product
 * code / SKU and filterable by location, category and stock state.
 *
 * Quantity-only — no cost or value — so it needs nothing beyond `stock.view`.
 */
function listProductStock({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listProductStock({ brand, filters, page, page_size, offset });
}

// Movements
function listMovements({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listMovements({ brand, filters, page, page_size, offset });
}
/**
 * One movement with its source document and the other lines of the same
 * operation. Backs the Movement Detail modal: what moved, from which document,
 * through which channel, and who processed it.
 */
async function getMovement({ brand, movement_id }) {
  const movement = await repo.getMovementById({ brand, movement_id });
  if (!movement) throw new NotFoundError("Stock movement not found");
  const siblings = await repo.siblingMovements({ brand, movement });
  return { ...movement, related_movements: siblings };
}

async function recordMovement({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const v = await repo.variantForIntake({ client, brand, variant_id: input.variant_id });
    if (v?.catalogue_role === "retail") {
      careGate.requireEnabled(brand);
      throw new AppError("CARE_STOCK_WORKFLOW_REQUIRED",
        "Use Goods Reception, a SKU count adjustment or a documented transfer for Care stock movements", 422);
    }
    const m = await applyMovement({
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
  const m = await applyMovement({
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
 * Put units back on the shelf that a sale already took — the exact inverse of
 * deductForSale, booked as a 'return' movement against the same sales order.
 *
 * Unlike 'sale' (excluded from MOVEMENT_GL because the order.paid journal owns
 * its COGS), 'return' IS in the map: applyMovement posts DR Inventory FG /
 * CR COGS at the movement's cost, so relieving the goods reverses cleanly on
 * the books without the caller having to hand-write a journal.
 *
 * Never releases more than the order actually took: the caller reads
 * repo.netSoldForOrder first and passes that ceiling. A line that was recorded
 * as a pre-order was never deducted, so it correctly returns nothing.
 */
async function returnFromSale({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  unit_cost_ngn,
  user_id,
  reason,
}) {
  const qty = Math.abs(quantity);
  if (qty <= 0) return null;
  const m = await applyMovement({
    client,
    brand,
    user_id,
    input: {
      variant_id,
      location_id,
      quantity: qty,
      movement_type: "return",
      reference_type: "sales_order",
      reference_id,
      unit_cost_ngn,
      notes: reason || null,
    },
  });
  events.emit("moved", {
    brand,
    variant_id,
    location_id,
    movement_type: "return",
    quantity: qty,
  });
  await audit({
    business: brand,
    user_id,
    action_key: "stock.movement.return",
    target_type: "stock_movement",
    target_id: m.movement_id,
    after: { variant_id, quantity: qty, reference_id, reason: reason || null },
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
  const m = await applyMovement({
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

// GAP-1: cart reservation with 20-minute TTL auto-release via BullMQ delayed job
async function reserveForCart({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  user_id,
}) {
  const m = await reserveForOrder({
    client,
    brand,
    variant_id,
    location_id,
    quantity,
    reference_id,
    user_id,
  });
  const { enqueue } = require("../../jobs/queue-producer");
  await enqueue(
    "cart-ttl",
    "release-cart-reservation",
    {
      brand,
      variant_id,
      location_id,
      quantity,
      reference_id,
    },
    { delay: 20 * 60 * 1000, attempts: 1 },
  );
  return m;
}

// GAP-7: seed into ALL active locations, not just default
async function seedVariant({ brand, variant_id }) {
  const locs = await repo.listLocations({ brand });
  for (const loc of locs) {
    if (loc.is_active)
      await repo.seedLevel({ brand, variant_id, location_id: loc.location_id });
  }
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
  const m = await applyMovement({
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
  const m = await applyMovement({
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

/**
 * Release exactly what THIS order still holds for a variant — never more.
 * stock_levels.reserved aggregates every order's holds, so a blind release
 * for an order that never reserved (legacy pre-payment_plan orders) would
 * silently free someone else's unit. Reads the order's own movement ledger
 * first and releases min(requested, still-held). No-op when nothing is held.
 */
async function releaseOrderReservation({
  client,
  brand,
  variant_id,
  location_id,
  quantity,
  reference_id,
  user_id,
  reason,
}) {
  const held = await repo.outstandingReservationForOrder({
    client,
    brand,
    variant_id,
    location_id,
    reference_id,
  });
  const qty = Math.min(Math.abs(quantity), held);
  if (qty <= 0) return null;
  return releaseReservation({
    client,
    brand,
    variant_id,
    location_id,
    quantity: qty,
    reference_id,
    user_id,
    reason,
  });
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
async function createAdjustment({ brand, user, request_id, input, careScoped = false }) {
  return transaction(async (client) => {
    if (input.adjustment_type === "count") {
      for (const line of input.lines) {
        const v = await repo.variantForIntake({ client, brand, variant_id: line.variant_id });
        if (v?.catalogue_role === "retail" && !careScoped)
          throw new AppError("CARE_COUNT_SCOPE", "Count retail with the SKU-exact Care & Accessories count flow", 422);
      }
    }
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
// GAP-2: submit for approval (write-downs require CEO sign-off)
async function submitAdjustment({ brand, user, request_id, id }) {
  const adj = await repo.getAdjustment({ brand, id });
  if (!adj) throw new NotFoundError("Adjustment");
  if (adj.status !== "draft")
    throw new AppError(
      "INVALID_STATE",
      `Cannot submit a '${adj.status}' adjustment`,
      409,
    );
  const updated = await repo.setAdjustmentStatus({
    brand,
    id,
    status: "submitted",
  });
  await A(
    brand,
    user.user_id,
    "stock.adjustment.submit",
    "stock_adjustment",
    id,
    { status: "submitted" },
    request_id,
  );
  events.emit("adjustment.submitted", { brand, id });
  return updated;
}

// GAP-2: CEO/manager approves a submitted write-down
async function approveAdjustment({ brand, user, request_id, id }) {
  const adj = await repo.getAdjustment({ brand, id });
  if (!adj) throw new NotFoundError("Adjustment");
  if (adj.status !== "submitted")
    throw new AppError(
      "INVALID_STATE",
      `Cannot approve a '${adj.status}' adjustment`,
      409,
    );
  const updated = await repo.setAdjustmentStatus({
    brand,
    id,
    status: "approved",
    approved_by: user.user_id,
  });
  await A(
    brand,
    user.user_id,
    "stock.adjustment.approve",
    "stock_adjustment",
    id,
    { status: "approved" },
    request_id,
  );
  events.emit("adjustment.approved", {
    brand,
    id,
    actor: user.display_name || user.email,
    requested_by: adj.created_by,
    adjustment_number: adj.adjustment_number,
  });
  return updated;
}

// GAP-2: reject a submitted adjustment
async function rejectAdjustment({ brand, user, request_id, id }) {
  const adj = await repo.getAdjustment({ brand, id });
  if (!adj) throw new NotFoundError("Adjustment");
  if (adj.status !== "submitted")
    throw new AppError(
      "INVALID_STATE",
      `Cannot reject a '${adj.status}' adjustment`,
      409,
    );
  const updated = await repo.setAdjustmentStatus({
    brand,
    id,
    status: "rejected",
  });
  await A(
    brand,
    user.user_id,
    "stock.adjustment.reject",
    "stock_adjustment",
    id,
    { status: "rejected" },
    request_id,
  );
  events.emit("adjustment.rejected", {
    brand,
    id,
    actor: user.display_name || user.email,
    requested_by: adj.created_by,
    adjustment_number: adj.adjustment_number,
  });
  return updated;
}

async function postAdjustment({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const adj = await repo.getAdjustment({ client, brand, id });
    if (!adj) throw new NotFoundError("Adjustment");
    // GAP-2: write-downs (physical < system) require approval before posting
    const hasWriteDown = adj.lines.some(
      (l) => l.physical_count - l.system_count < 0,
    );
    if (hasWriteDown && adj.status !== "approved") {
      throw new AppError(
        "APPROVAL_REQUIRED",
        "Write-downs require CEO approval before posting",
        409,
        {
          user_message:
            "This adjustment contains write-downs and must be approved before posting.",
        },
      );
    }
    if (
      !hasWriteDown &&
      !["draft", "submitted", "approved"].includes(adj.status)
    ) {
      throw new AppError(
        "INVALID_STATE",
        `Cannot post a '${adj.status}' adjustment`,
        409,
      );
    }
    if (hasWriteDown && adj.status !== "approved") {
      throw new AppError(
        "INVALID_STATE",
        `Cannot post a '${adj.status}' adjustment with write-downs`,
        409,
      );
    }
    for (const line of adj.lines) {
      const delta = line.physical_count - line.system_count;
      const v = await repo.variantForIntake({ client, brand, variant_id: line.variant_id });
      if (v?.catalogue_role === "retail") {
        careGate.requireEnabled(brand);
        if (adj.adjustment_type === "count" && adj.status !== "approved")
          throw new AppError("APPROVAL_REQUIRED", "Care SKU counts require approval before posting any correction", 409);
        // Counts can sit awaiting CEO approval while stock moves at this
        // location. Lock and reject a stale snapshot instead of applying an
        // old delta to a newer shelf count (or writing down reservations).
        const current = await repo.lockLevel({
          client, brand, variant_id: line.variant_id, location_id: adj.location_id,
        });
        if (Number(current?.on_hand || 0) !== Number(line.system_count) ||
            Number(line.physical_count) < Number(current?.reserved || 0))
          throw new AppError("STALE_CARE_COUNT", "Care SKU stock or reservations changed; recount before posting", 409);
        if (delta !== 0) {
          const basis = await repo.getCostBasisForVariants({
            client, brand, variant_ids: [line.variant_id],
          });
          if (!(Number(line.unit_cost_ngn) > 0) && !(Number(basis.get(line.variant_id)) > 0))
            throw new AppError("COST_REQUIRED", "Care SKU needs a positive operational cost before adjustment", 422);
        }
      }
      if (delta === 0) continue;
      await applyMovement({
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
// Posts the transfer_out movements at the source + stamps the transfer
// 'dispatched' — the shared core of both createTransfer (which now dispatches
// immediately on creation) and the standalone dispatch endpoint (kept so any
// pre-existing 'draft' transfer from before this change can still be sent).
// Runs on the caller's client/transaction — never opens its own, so it's safe
// to call from inside createTransfer's transaction as well as its own.
async function dispatchTransferLines({ client, brand, user_id, request_id, transfer }) {
  for (const line of transfer.lines) {
    await applyMovement({
      client,
      brand,
      user_id,
      input: {
        variant_id: line.variant_id,
        location_id: transfer.from_location_id,
        quantity: -Math.abs(line.qty_dispatched),
        movement_type: "transfer_out",
        reference_type: "transfer",
        reference_id: transfer.transfer_id,
      },
    });
  }
  const out = await repo.setTransferStatus({
    client,
    brand,
    id: transfer.transfer_id,
    status: "dispatched",
    field: "dispatched",
    user_id,
  });
  await A(
    brand,
    user_id,
    "stock.transfer.dispatch",
    "stock_transfer",
    transfer.transfer_id,
    { status: "dispatched" },
    request_id,
  );
  events.emit("transfer.dispatched", { brand, id: transfer.transfer_id });
  return out;
}
// A transfer between two of our own locations has no meaningful "in transit"
// checkpoint worth an extra confirmation click — creating it immediately
// deducts the source (dispatchTransferLines, above), so Ops only has to act
// once. Receiving at the destination stays a separate, deliberate step (the
// physical-arrival checkpoint), unchanged below.
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
    const full = await repo.getTransfer({ client, brand, id: tr.transfer_id });
    await dispatchTransferLines({
      client,
      brand,
      user_id: user.user_id,
      request_id,
      transfer: full,
    });
    return repo.getTransfer({ client, brand, id: tr.transfer_id });
  });
}
// Kept for any transfer still sitting in 'draft' from before transfers began
// dispatching on creation — createTransfer no longer produces a 'draft' row,
// so this endpoint is legacy-only going forward.
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
    return dispatchTransferLines({
      client,
      brand,
      user_id: user.user_id,
      request_id,
      transfer: tr,
    });
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
        await applyMovement({
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
    for (const line of input.lines || []) {
      const v = await repo.variantForIntake({ client, brand, variant_id: line.variant_id });
      if (v?.catalogue_role === "retail") {
        careGate.requireEnabled(brand);
        if (v.is_deleted || !v.is_active || !v.track_stock)
          throw new AppError("NO_STOCK_VARIANT", "Choose an active Care SKU", 422);
        if (line.po_line_id)
          throw new AppError("PO_RECEIPT_REQUIRED", "Receive a Care PO through Goods Reception with exact PO line matching", 422);
        if (!(await vault.canSeeCost({ client, user, brand })))
          throw new PermissionDeniedError("Operational receipt costs require Cost Vault access");
        if (!(Number(line.unit_cost_ngn) > 0))
          throw new AppError("COST_REQUIRED", "Enter a positive operational cost per Care SKU", 422);
      }
    }
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
/**
 * Goods Reception (simplified inbound) — V2.2 §6.9.
 * One step: create the receiving record AND lift stock at once. Lines are
 * BASE PRODUCTS (each resolved to its default stock-bearing variant) + a
 * quantity — no cost is captured here (cost lives in the base-product Cost
 * Vault). The receiver's id is `created_by` (the logged-in user); their name
 * is stored editable for the register. Status is 'received' immediately so a
 * positive 'receive' movement fires the SSOT trigger and on_hand goes up.
 */
async function createGoodsReceipt({ brand, user, request_id, input }) {
  const lines = input.lines || [];
  if (lines.length === 0)
    throw new AppError("VALIDATION", "At least one line is required", 422);

  return transaction(async (client) => {
    // Base receipts retain their existing product → default-variant path.
    // Retail receipts MUST name an exact variant. Verify role, location, PO
    // identity and authorised operational cost BEFORE recording any movement.
    const resolved = [];
    for (const ln of lines) {
      const variant = ln.variant_id
        ? await repo.variantForIntake({ client, brand, variant_id: ln.variant_id })
        : await repo.defaultVariantForProduct({ client, brand, product_id: ln.product_id });
      if (!variant || variant.is_deleted || variant.is_active === false ||
          variant.track_stock === false)
        throw new AppError("NO_STOCK_VARIANT", "Active stock-bearing SKU not found", 422);
      if (ln.product_id && variant.product_id && ln.product_id !== variant.product_id)
        throw new AppError("SKU_MISMATCH", "SKU belongs to a different product", 422);
      const retail = variant.catalogue_role === "retail";
      if (retail) {
        careGate.requireEnabled(brand);
        if (!(await vault.canSeeCost({ client, user, brand })))
          throw new PermissionDeniedError("Operational receipt costs require Cost Vault access");
        if (!(Number(ln.unit_cost_ngn) > 0))
          throw new AppError("COST_REQUIRED", "Enter a positive operational cost per Care SKU", 422);
      }
      if (ln.po_line_id && !input.purchase_order_id)
        throw new AppError("PO_REQUIRED", "A PO line requires its purchase order", 422);
      if (retail && input.purchase_order_id && !ln.po_line_id)
        throw new AppError("PO_LINE_REQUIRED", "Pick the exact Care SKU PO line", 422);
      if (ln.po_line_id) {
        const poLine = await repo.poLineForReceipt({
          client, brand, po_id: input.purchase_order_id, po_line_id: ln.po_line_id,
        });
        if (!poLine || (poLine.variant_id && poLine.variant_id !== variant.variant_id) ||
            (retail && (!poLine.variant_id || Number(poLine.qty_outstanding) < ln.quantity)))
          throw new AppError("PO_SKU_MISMATCH", "PO line does not match this exact SKU or outstanding quantity", 422);
      }
      resolved.push({
        variant_id: variant.variant_id,
        quantity: ln.quantity,
        po_line_id: ln.po_line_id || null,
        unit_cost_ngn: retail ? ln.unit_cost_ngn : null,
      });
    }

    const sh = await repo.createShipment({
      client,
      brand,
      header: {
        destination_location_id: input.destination_location_id,
        received_at: input.received_at || new Date().toISOString().slice(0, 10),
        received_by_name: input.received_by_name || null,
        notes: input.notes || null,
        status: "received",
        created_by: user.user_id,
      },
    });

    for (const r of resolved) {
      const line = await repo.addShipmentLine({
        client,
        brand,
        shipment_id: sh.shipment_id,
        line: {
          variant_id: r.variant_id,
          qty_expected: r.quantity,
          unit_cost_ngn: r.unit_cost_ngn,
          // Keeps the receipt traceable back to the order it satisfies.
          po_line_id: r.po_line_id,
        },
      });
      await repo.setShipmentLineReceived({
        client,
        brand,
        line_id: line.line_id,
        qty_received: r.quantity,
      });
      await applyMovement({
        client,
        brand,
        user_id: user.user_id,
        input: {
          variant_id: r.variant_id,
          location_id: input.destination_location_id,
          quantity: Math.abs(r.quantity),
          movement_type: "receive",
          reference_type: "inbound_shipment",
          reference_id: sh.shipment_id,
          unit_cost_ngn: r.unit_cost_ngn,
        },
      });
    }

    await A(
      brand,
      user.user_id,
      "stock.goods_receipt.create",
      "inbound_shipment",
      sh.shipment_id,
      {
        destination_location_id: input.destination_location_id,
        received_by_name: input.received_by_name || null,
        line_count: resolved.length,
      },
      request_id,
    );
    // Book the delivery against the purchase order IN THIS TRANSACTION.
    // Stock that went up while the PO still shows the goods outstanding is
    // exactly the drift that makes people stop trusting either number, so if
    // the PO update fails the stock movement rolls back with it.
    if (input.purchase_order_id) {
      const purchasing = require("../purchasing/purchasing.service");
      await purchasing.applyReceiptToPo({
        client,
        brand,
        user,
        request_id,
        po_id: input.purchase_order_id,
        lines: resolved
          .filter((r) => r.po_line_id)
          .map((r) => ({ po_line_id: r.po_line_id, quantity: r.quantity })),
      });
    }

    events.emit("shipment.received", { brand, id: sh.shipment_id });
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
        const v = await repo.variantForIntake({ client, brand, variant_id: line.variant_id });
        if (v?.catalogue_role === "retail") {
          careGate.requireEnabled(brand);
          if (v.is_deleted || !v.is_active || !v.track_stock || !(Number(line.unit_cost_ngn) > 0))
            throw new AppError("INVALID_CARE_RECEIPT", "A Care SKU must be active, stock-bearing and costed before receipt", 422);
          if (line.po_line_id)
            throw new AppError("PO_RECEIPT_REQUIRED", "Receive a Care PO through Goods Reception with exact PO line matching", 422);
        }
        await applyMovement({
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

// ── SKU-exact PXG Care count (separate from the hair-axis import) ─────
// Read-only sheet template/receipt picker: all retail SKUs at ONE explicit
// location, with quantities but never operational/true cost amounts.
async function listCareSkus({ brand, location_id }) {
  careGate.requireEnabled(brand);
  const locations = await repo.locationsWithStock({ brand });
  const location = locations.find((l) => l.location_id === location_id && l.is_active);
  if (!location) throw new AppError("INVALID_LOCATION", "Pick an active stock location", 422);
  const rows = await repo.careVariantsAtLocation({ brand, location_id });
  return { location: { location_id, display_name: location.display_name }, rows };
}
async function importCareCount({ brand, user, request_id, input }) {
  careGate.requireEnabled(brand);
  const locations = await repo.locationsWithStock({ brand });
  const location = locations.find((l) =>
    l.location_id === input.location_id && l.is_active,
  );
  if (!location) throw new AppError("INVALID_LOCATION", "Pick an active stock location", 422);
  const variants = await repo.careVariantsAtLocation({
    brand, location_id: location.location_id,
  });
  const preview = careCount.plan({
    rows: input.rows, variants,
    blank: input.blank || "skip", unlisted: input.unlisted || "skip",
  });
  const result = {
    ...preview,
    location: { location_id: location.location_id, display_name: location.display_name },
    adjustment: null,
  };
  if (!input.commit) return result;
  if (preview.blockers.length)
    throw new AppError("COUNT_NOT_RECONCILED", preview.blockers.join("; "), 422);
  if (!preview.lines.length)
    throw new AppError("NO_CHANGES", "The Care SKU count already matches the shelf", 422);
  const adj = await createAdjustment({
    brand, user, request_id, careScoped: true,
    input: {
      location_id: location.location_id, adjustment_type: "count",
      reason: (`${input.reason ? `${input.reason} — ` : ""}Care & Accessories SKU count: ` +
        `${preview.summary.corrections} corrected, ${preview.summary.zeroed} not listed. ` +
        `Net ${preview.summary.net >= 0 ? "+" : ""}${preview.summary.net} units.`).slice(0, 500),
      lines: preview.lines.map((line) => ({
        variant_id: line.variant_id, system_count: line.system_count,
        physical_count: line.physical_count,
        notes: (line.kind === "unlisted"
          ? `Unlisted Care SKU ${line.sku} counted as zero`
          : `Care count row ${line.row}: ${line.sku}`).slice(0, 500),
      })),
    },
  });
  await submitAdjustment({ brand, user, request_id, id: adj.adjustment_id });
  return {
    ...result,
    adjustment: {
      adjustment_id: adj.adjustment_id,
      adjustment_number: adj.adjustment_number, status: "submitted",
    },
  };
}

// ── Count import (Stock → Adjustments → Import Count) ────

/**
 * Reconcile a parsed count sheet against the shelf and — when `commit` is set
 * — file the result as ONE `count` adjustment, submitted for approval.
 *
 * The client parses the workbook and posts plain rows; all matching, all
 * reconciliation and every interlock happens here, so the CLI importer
 * (`scripts/import-stock-count.js`) and this endpoint cannot drift apart.
 *
 * `commit: false` is a dry run that touches nothing: it returns exactly what
 * committing WOULD do, which is what the review step renders. The interlocks
 * are evaluated either way, so the preview can grey out its own submit button
 * for the same reasons the commit would refuse.
 */
async function importCount({ brand, user, request_id, input }) {
  const {
    rows: rawRows = [],
    location_id = null,
    blank = "zero",
    unlisted = "zero",
    reason = null,
    commit = false,
    allow_unmatched = false,
  } = input;

  const parsed = countSheet.parseCountRows(rawRows);
  const { rows: deduped, conflicts } = countSheet.dedupeRows(parsed);
  const badRows = parsed.filter((r) => r.error);

  const products = await repo.productsForCountMatch({ brand });
  const { matched, unmatched, skipped } = countSheet.matchRows(
    deduped,
    products,
    { blank },
  );

  const locations = await repo.locationsWithStock({ brand });
  // Throws when two locations hold stock and nothing names which was counted —
  // guessing there would zero a warehouse that was never walked.
  const location = countPlan.resolveLocation(locations, location_id, unlisted);

  const levelsByProduct = await repo.levelsByProductAtLocation({
    brand,
    location_id: location.location_id,
  });
  const matchedProductIds = new Set(
    [...matched, ...skipped].map((m) => m.product.product_id),
  );
  const { lines, problems, unchanged } = countPlan.buildLines({
    matched,
    levelsByProduct,
    unlisted,
    matchedProductIds,
  });

  const totals = countPlan.summarise(lines);
  const stop = countPlan.blockers({ conflicts, badRows, unmatched, problems });
  const systemTotal = [...levelsByProduct.values()]
    .flat()
    .reduce((sum, v) => sum + v.on_hand, 0);

  // Everything the review step renders, whether or not we go on to write.
  const preview = {
    location: {
      location_id: location.location_id,
      display_name: location.display_name,
    },
    lines: lines.map((l) => ({
      kind: l.kind,
      row: l.row,
      product_id: l.product.product_id,
      product_name: l.product.name,
      sku: l.variant.sku,
      system_count: l.system_count,
      physical_count: l.physical_count,
      delta: l.physical_count - l.system_count,
    })),
    unmatched: unmatched.map((u) => ({ row: u.row.row, error: u.error })),
    problems: problems.map((p) => ({
      row: p.row,
      product_name: p.product.name,
      error: p.error,
    })),
    skipped: skipped.map((s) => ({
      row: s.row.row,
      product_name: s.product.name,
    })),
    conflicts: conflicts.map((c) => c.message),
    bad_rows: badRows.map((r) => ({ row: r.row, error: r.error })),
    blockers: stop,
    summary: {
      rows_read: parsed.length,
      combinations: deduped.length,
      matched: matched.length,
      unchanged: unchanged.length,
      corrections: lines.filter((l) => l.kind === "counted").length,
      zeroed: lines.filter((l) => l.kind === "unlisted").length,
      ...totals,
      system_total: systemTotal,
      ends_at: systemTotal + totals.net,
    },
    adjustment: null,
  };

  if (!commit) return preview;

  if (stop.length && !allow_unmatched)
    throw new AppError("COUNT_NOT_RECONCILED", stop.join("; "), 422, {
      user_message:
        "This sheet can't be filed yet — some rows don't match a product. " +
        "Fix them in the review list first.",
      metadata: { blockers: stop },
    });

  if (!lines.length)
    throw new AppError(
      "NOTHING_TO_CORRECT",
      "Every counted product already matches the system",
      422,
      {
        user_message:
          "Nothing to correct — the system already holds exactly what the sheet says.",
      },
    );

  const adj = await createAdjustment({
    brand,
    user,
    request_id,
    input: {
      location_id: location.location_id,
      adjustment_type: "count",
      // Capped to the 500 the validator allows, so an imported count is
      // indistinguishable from a hand-entered one.
      reason: (
        (reason ? `${reason} — ` : "") +
        `Imported stock count. ${preview.summary.corrections} corrected` +
        (preview.summary.zeroed
          ? `, ${preview.summary.zeroed} not counted and zeroed`
          : "") +
        `. Net ${totals.net >= 0 ? "+" : ""}${totals.net} units.`
      ).slice(0, 500),
      lines: lines.map((l) => ({
        variant_id: l.variant.variant_id,
        system_count: l.system_count,
        physical_count: l.physical_count,
        notes: (l.kind === "unlisted"
          ? "Not on the count sheet — written down to zero."
          : `Count sheet row ${l.row}: ${l.product.name}`
        ).slice(0, 500),
      })),
    },
  });

  // Submitted, never posted: stock moves only when an approver posts it.
  await submitAdjustment({
    brand,
    user,
    request_id,
    id: adj.adjustment_id,
  });

  return {
    ...preview,
    adjustment: {
      adjustment_id: adj.adjustment_id,
      adjustment_number: adj.adjustment_number,
      status: "submitted",
    },
  };
}

module.exports = {
  listLocations,
  createLocation,
  updateLocation,
  valuation,
  exportOnHand,
  exportMovements,
  listLevels,
  listProductStock,
  variantStock,
  listMovements,
  getMovement,
  recordMovement,
  deductForSale,
  returnFromSale,
  receiveStock,
  reserveForOrder,
  reserveForCart,
  releaseReservation,
  releaseOrderReservation,
  seedVariant,
  listAdjustments,
  getAdjustment,
  createAdjustment,
  submitAdjustment,
  approveAdjustment,
  rejectAdjustment,
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
  createGoodsReceipt,
  updateShipmentStatus,
  receiveShipment,
  importCount,
  importCareCount,
  listCareSkus,
};
