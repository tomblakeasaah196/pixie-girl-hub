/**
 * Production & Landed Cost (V2.2 §6.24) — repository.
 *
 * production_runs (factory→Lagos→styled), production_run_units, cost_components
 * (trigger `fn_production_run_recompute_totals` rolls these up to the run),
 * and service_jobs (FLH styling; trigger auto-creates a staff task). Per-brand
 * tables via the brand registry `t()`. Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}

// ── Production runs ────────────────────────────────────────
async function createRun({ client, brand, run }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "production_runs")}
       (run_number, title, status, units_planned,
        supplier_id, po_id, funding_currency,
        planned_start_date, expected_ready_date, expected_arrival_date,
        notes, created_by)
     VALUES ($1,$2,COALESCE($3,'planned'),COALESCE($4,0),
             $5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      run.run_number,
      run.title,
      run.status,
      run.units_planned,
      run.supplier_id || null,
      run.po_id || null,
      run.funding_currency || null,
      run.planned_start_date || null,
      run.expected_ready_date || null,
      run.expected_arrival_date || null,
      run.notes || null,
      run.created_by || null,
    ],
  );
  return rows[0];
}
async function getRun({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT r.*, s.display_name AS supplier_name, p.po_number
       FROM ${t(brand, "production_runs")} r
       LEFT JOIN ${t(brand, "suppliers")} s ON s.supplier_id = r.supplier_id
       LEFT JOIN ${t(brand, "purchase_orders")} p ON p.po_id = r.po_id
      WHERE r.run_id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const [units, components] = await Promise.all([
    listUnits({ client, brand, run_id: id }),
    listCostComponents({ client, brand, run_id: id }),
  ]);
  return { ...rows[0], units, components };
}
async function listRuns({ brand, status, page = 1, page_size = 25 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`r.status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM ${t(brand, "production_runs")} r ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT r.*, s.display_name AS supplier_name, p.po_number,
            (SELECT count(*)::int FROM ${t(brand, "production_run_units")} u
              WHERE u.run_id = r.run_id) AS unit_count
       FROM ${t(brand, "production_runs")} r
       LEFT JOIN ${t(brand, "suppliers")} s ON s.supplier_id = r.supplier_id
       LEFT JOIN ${t(brand, "purchase_orders")} p ON p.po_id = r.po_id
      ${w}
      ORDER BY r.created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}
async function setRunStatus({ client, brand, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "production_runs")} SET ${set.join(", ")}, updated_at = now()
      WHERE run_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function bumpUnitsReceived({ client, brand, id, qty }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "production_runs")}
        SET units_received = units_received + $2, updated_at = now()
      WHERE run_id = $1 RETURNING *`,
    [id, qty],
  );
  return rows[0] || null;
}

async function addCostComponent({ client, brand, c }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "cost_components")}
       (run_id, cost_type, amount, currency, fx_rate_used, amount_ngn,
        applies_to_units, description, invoice_reference, funding_source_id,
        source_type, source_id, recorded_by, incurred_at)
     VALUES ($1,$2,$3,$4,COALESCE($5,1),$6,$7,$8,$9,$10,
             COALESCE($11,'manual'),$12,$13,COALESCE($14,CURRENT_DATE))
     RETURNING *`,
    [
      c.run_id,
      c.cost_type,
      c.amount,
      c.currency,
      c.fx_rate_used,
      c.amount_ngn,
      c.applies_to_units ?? null,
      c.description || null,
      c.invoice_reference || null,
      c.funding_source_id || null,
      c.source_type || null,
      c.source_id || null,
      c.recorded_by || null,
      c.incurred_at,
    ],
  );
  return rows[0];
}

/** Cost components with the recorder's name, for the run detail panel. */
async function listCostComponents({ client, brand, run_id }) {
  const { rows } = await ex(client)(
    `SELECT c.*, u.display_name AS recorded_by_name
       FROM ${t(brand, "cost_components")} c
       LEFT JOIN shared.users u ON u.user_id = c.recorded_by
      WHERE c.run_id = $1
      ORDER BY c.recorded_at`,
    [run_id],
  );
  return rows;
}

async function addUnit({ client, brand, unit }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "production_run_units")}
       (unit_code, run_id, variant_id, sku_snapshot, status)
     VALUES ($1,$2,$3,$4,COALESCE($5,'planned')) RETURNING *`,
    [
      unit.unit_code,
      unit.run_id,
      unit.variant_id || null,
      unit.sku_snapshot || null,
      unit.status,
    ],
  );
  return rows[0];
}

/**
 * Bulk-insert units for one run. `units` is already numbered by the caller
 * (unit_code is UNIQUE), so this is a single multi-VALUES insert rather than
 * N round-trips — a 200-unit factory batch is one statement.
 */
async function addUnits({ client, brand, units }) {
  if (!units.length) return [];
  const params = [];
  const tuples = units.map((u, n) => {
    const b = n * 5;
    params.push(
      u.unit_code,
      u.run_id,
      u.variant_id || null,
      u.sku_snapshot || null,
      u.status || "planned",
    );
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
  });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "production_run_units")}
       (unit_code, run_id, variant_id, sku_snapshot, status)
     VALUES ${tuples.join(",")} RETURNING *`,
    params,
  );
  return rows;
}

/** How many units already exist on a run — the unit_code sequence base. */
async function countUnits({ client, brand, run_id }) {
  const { rows } = await ex(client)(
    `SELECT count(*)::int AS n FROM ${t(brand, "production_run_units")}
      WHERE run_id = $1`,
    [run_id],
  );
  return rows[0].n;
}

/**
 * A run's units, grouped for display: one row per (variant, status) with a
 * quantity, rather than 200 near-identical unit rows. The raw unit rows stay
 * the SSOT — this is the shape the run detail panel reads.
 */
async function listUnits({ client, brand, run_id }) {
  const { rows } = await ex(client)(
    `SELECT u.variant_id,
            u.status,
            count(*)::int                AS quantity,
            min(u.unit_code)             AS first_unit_code,
            max(u.sku_snapshot)          AS sku_snapshot,
            max(v.sku)                   AS sku,
            max(v.variant_name)          AS variant_name,
            max(p.name)                  AS product_name
       FROM ${t(brand, "production_run_units")} u
       LEFT JOIN ${t(brand, "product_variants")} v ON v.variant_id = u.variant_id
       LEFT JOIN ${t(brand, "products")} p ON p.product_id = v.product_id
      WHERE u.run_id = $1
      GROUP BY u.variant_id, u.status
      ORDER BY max(p.name) NULLS LAST, max(v.sku) NULLS LAST, u.status`,
    [run_id],
  );
  return rows;
}

// ── Purchase-order import ─────────────────────────────────
/** PO header + lines, for "build this run from PO-0012". */
async function getPoWithLines({ client, brand, po_id }) {
  const { rows } = await ex(client)(
    `SELECT po_id, po_number, title, supplier_id, po_currency, fx_rate_used, status
       FROM ${t(brand, "purchase_orders")} WHERE po_id = $1`,
    [po_id],
  );
  if (!rows[0]) return null;
  const { rows: lines } = await ex(client)(
    `SELECT l.line_id, l.variant_id, l.description, l.qty_ordered,
            l.unit_price, l.unit_price_ngn, v.sku
       FROM ${t(brand, "po_lines")} l
       LEFT JOIN ${t(brand, "product_variants")} v ON v.variant_id = l.variant_id
      WHERE l.po_id = $1
      ORDER BY l.display_order, l.line_id`,
    [po_id],
  );
  return { ...rows[0], lines };
}

/** Point a PO's lines at the run they're being produced under. */
async function linkPoLinesToRun({ client, brand, po_id, run_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "po_lines")} SET production_run_id = $2 WHERE po_id = $1`,
    [po_id, run_id],
  );
}

/** SKU lookup for units created from a picked variant. */
async function variantSkus({ client, brand, variant_ids }) {
  if (!variant_ids.length) return {};
  const { rows } = await ex(client)(
    `SELECT variant_id, sku FROM ${t(brand, "product_variants")}
      WHERE variant_id = ANY($1::uuid[])`,
    [variant_ids],
  );
  return Object.fromEntries(rows.map((r) => [r.variant_id, r.sku]));
}

// Lightweight run-row read (no units/components join) — used by the landed-cost
// recompute which only needs the trigger-maintained roll-up columns.
async function getRunBare({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "production_runs")} WHERE run_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function setRunPerUnitCost({ client, brand, id, per_unit_cost_ngn }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "production_runs")}
        SET per_unit_cost_ngn = $2, cost_last_recomputed_at = now(), updated_at = now()
      WHERE run_id = $1 RETURNING *`,
    [id, per_unit_cost_ngn],
  );
  return rows[0] || null;
}

// ── Landed-cost breakdown snapshots ───────────────────────
async function getLatestBreakdown({ client, brand, run_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "landed_cost_breakdown")}
      WHERE run_id = $1 AND is_latest = true`,
    [run_id],
  );
  return rows[0] || null;
}

async function markBreakdownsNotLatest({ client, brand, run_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "landed_cost_breakdown")}
        SET is_latest = false
      WHERE run_id = $1 AND is_latest = true`,
    [run_id],
  );
}

async function insertBreakdown({ client, brand, b }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "landed_cost_breakdown")}
       (run_id, computed_reason,
        factory_cost_total_ngn, freight_total_ngn, customs_total_ngn,
        lagos_3pl_total_ngn, styling_total_ngn, packaging_total_ngn,
        wastage_total_ngn, other_total_ngn,
        total_landed_cost_ngn, units_in_run, per_unit_landed_cost_ngn,
        weighted_avg_fx_rate, funding_currency, variance_from_previous_pct,
        is_latest)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,true)
     RETURNING *`,
    [
      b.run_id,
      b.computed_reason || null,
      b.factory_cost_total_ngn,
      b.freight_total_ngn,
      b.customs_total_ngn,
      b.lagos_3pl_total_ngn,
      b.styling_total_ngn,
      b.packaging_total_ngn,
      b.wastage_total_ngn,
      b.other_total_ngn,
      b.total_landed_cost_ngn,
      b.units_in_run,
      b.per_unit_landed_cost_ngn,
      b.weighted_avg_fx_rate ?? null,
      b.funding_currency || null,
      b.variance_from_previous_pct ?? null,
    ],
  );
  return rows[0];
}

async function listBreakdowns({ brand, run_id, limit = 50 }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "landed_cost_breakdown")}
      WHERE run_id = $1 ORDER BY computed_at DESC LIMIT $2`,
    [run_id, limit],
  );
  return rows;
}

// ── Units + rework (F-7b) ─────────────────────────────────
async function getUnit({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "production_run_units")} WHERE unit_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function setUnitStatus({ client, brand, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "production_run_units")} SET ${set.join(", ")}, updated_at = now()
      WHERE unit_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function insertRework({ client, brand, r }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "rework_events")}
       (unit_id, run_id, reason, qc_finding, extra_cost_ngn, cost_component_id,
        delay_days, rework_completed_at, outcome, recorded_by, notes)
     VALUES ($1,$2,$3,$4,COALESCE($5,0),$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      r.unit_id,
      r.run_id,
      r.reason,
      r.qc_finding || null,
      r.extra_cost_ngn,
      r.cost_component_id || null,
      r.delay_days ?? null,
      r.rework_completed_at || null,
      r.outcome || null,
      r.recorded_by || null,
      r.notes || null,
    ],
  );
  return rows[0];
}

async function listRework({ brand, run_id, unit_id, limit = 100 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (run_id) {
    where.push(`run_id = $${i++}`);
    params.push(run_id);
  }
  if (unit_id) {
    where.push(`unit_id = $${i++}`);
    params.push(unit_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "rework_events")} ${w}
      ORDER BY recorded_at DESC LIMIT $${i}`,
    [...params, limit],
  );
  return rows;
}

// Service types + service_jobs are owned by the standalone Service Jobs
// module (src/modules/service_jobs).

module.exports = {
  nextNumber,
  createRun,
  getRun,
  listRuns,
  setRunStatus,
  bumpUnitsReceived,
  addCostComponent,
  listCostComponents,
  addUnit,
  addUnits,
  countUnits,
  listUnits,
  getPoWithLines,
  linkPoLinesToRun,
  variantSkus,
  getRunBare,
  setRunPerUnitCost,
  getLatestBreakdown,
  markBreakdownsNotLatest,
  insertBreakdown,
  listBreakdowns,
  getUnit,
  setUnitStatus,
  insertRework,
  listRework,
};
