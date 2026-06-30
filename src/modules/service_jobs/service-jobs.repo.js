/**
 * Faitlyn Service Job Tracker (V2.2 §6.24) — repository.
 *
 * Canonical owner of per-brand service_types + service_jobs (split out of
 * Production). A service_job insert fires the DB trigger that auto-creates a
 * staff task; deposit-triggered orders open a job via the subscriber; a stylist
 * assignment may be opened from a job (stylist programme §6.26). Parameterised
 * SQL only; per-brand tables via the brand registry `t()`.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (c) => (c ? c.query.bind(c) : query);

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}

// ── service_types ──────────────────────────────────────────
async function listServiceTypes({ brand, is_active }) {
  const where = [];
  const params = [];
  let i = 1;
  if (is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(is_active);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "service_types")} ${w} ORDER BY display_order, display_name`,
    params,
  );
  return rows;
}
async function getDefaultServiceType({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "service_types")} WHERE is_active = true
      ORDER BY display_order, display_name LIMIT 1`,
  );
  return rows[0] || null;
}
async function findServiceType({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "service_types")} WHERE service_type_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function createServiceType({ brand, st }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "service_types")}
       (service_key, display_name, description, standard_cost_ngn,
        standard_turnaround_days, default_account_id, display_order)
     VALUES ($1,$2,$3,COALESCE($4,0),$5,$6,COALESCE($7,0)) RETURNING *`,
    [
      st.service_key,
      st.display_name,
      st.description || null,
      st.standard_cost_ngn === undefined ? null : st.standard_cost_ngn,
      st.standard_turnaround_days === undefined
        ? null
        : st.standard_turnaround_days,
      st.default_account_id || null,
      st.display_order === undefined ? null : st.display_order,
    ],
  );
  return rows[0];
}
async function updateServiceType({ brand, id, patch }) {
  const allowed = [
    "display_name",
    "description",
    "standard_cost_ngn",
    "standard_turnaround_days",
    "default_account_id",
    "display_order",
    "is_active",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return findServiceType({ brand, id });
  params.push(id);
  const { rows } = await query(
    `UPDATE ${t(brand, "service_types")} SET ${sets.join(", ")}, updated_at = now()
      WHERE service_type_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── service_jobs ───────────────────────────────────────────
async function createServiceJob({ client, brand, job }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "service_jobs")}
       (job_number, service_type_id, hair_variant_id, hair_unit_id, hair_description,
        sales_order_id, sales_order_line_id, customer_contact_id,
        assigned_staff_user_id, assigned_stylist_id, is_intercompany,
        intercompany_transaction_id, specification, recipe_id, status,
        scheduled_for, expected_completion_at, agreed_cost_ngn, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,false),$12,$13,$14,
             COALESCE($15,'pending'),$16,$17,$18,$19)
     RETURNING *`,
    [
      job.job_number,
      job.service_type_id,
      job.hair_variant_id || null,
      job.hair_unit_id || null,
      job.hair_description || null,
      job.sales_order_id || null,
      job.sales_order_line_id || null,
      job.customer_contact_id || null,
      job.assigned_staff_user_id || null,
      job.assigned_stylist_id || null,
      job.is_intercompany === undefined ? null : job.is_intercompany,
      job.intercompany_transaction_id || null,
      job.specification ? JSON.stringify(job.specification) : null,
      job.recipe_id || null,
      job.status,
      job.scheduled_for || null,
      job.expected_completion_at || null,
      job.agreed_cost_ngn === undefined ? null : job.agreed_cost_ngn,
      job.created_by || null,
    ],
  );
  return rows[0];
}
async function getServiceJob({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT j.*, st.display_name AS service_type_name, st.service_key
       FROM ${t(brand, "service_jobs")} j
       LEFT JOIN ${t(brand, "service_types")} st ON st.service_type_id = j.service_type_id
      WHERE j.job_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listServiceJobs({
  brand,
  status,
  assigned_staff_user_id,
  assigned_stylist_id,
  customer_contact_id,
  page = 1,
  page_size = 25,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  if (assigned_staff_user_id) {
    where.push(`assigned_staff_user_id = $${i++}`);
    params.push(assigned_staff_user_id);
  }
  if (assigned_stylist_id) {
    where.push(`assigned_stylist_id = $${i++}`);
    params.push(assigned_stylist_id);
  }
  if (customer_contact_id) {
    where.push(`customer_contact_id = $${i++}`);
    params.push(customer_contact_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM ${t(brand, "service_jobs")} ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "service_jobs")} ${w}
      ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}
async function serviceJobExistsForOrder({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "service_jobs")} WHERE sales_order_id = $1 LIMIT 1`,
    [order_id],
  );
  return rows.length > 0;
}
async function setServiceJobStatus({ client, brand, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "service_jobs")} SET ${set.join(", ")}, updated_at = now()
      WHERE job_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function updateServiceJob({ client, brand, id, patch }) {
  const allowed = [
    "assigned_staff_user_id",
    "assigned_stylist_id",
    "hair_variant_id",
    "hair_unit_id",
    "hair_description",
    "specification",
    "recipe_id",
    "recipe_override",
    "scheduled_for",
    "expected_completion_at",
    "agreed_cost_ngn",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      const v =
        (k === "specification" || k === "recipe_override") &&
        patch[k] !== null &&
        patch[k] !== undefined
          ? JSON.stringify(patch[k])
          : patch[k];
      sets.push(`${k} = $${i++}`);
      params.push(v);
    }
  }
  if (!sets.length) return getServiceJob({ client, brand, id });
  params.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "service_jobs")} SET ${sets.join(", ")}, updated_at = now()
      WHERE job_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── chemical_recipes (F-7c) ────────────────────────────────
async function listRecipes({ brand, is_active }) {
  const where = [];
  const params = [];
  let i = 1;
  if (is_active !== undefined) {
    where.push(`is_active = $${i++}`);
    params.push(is_active);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "chemical_recipes")} ${w} ORDER BY display_name`,
    params,
  );
  return rows;
}
async function getRecipe({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "chemical_recipes")} WHERE recipe_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function createRecipe({ brand, r, user_id }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "chemical_recipes")}
       (recipe_key, display_name, ingredients, instructions, target_shade, notes, is_active, created_by)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,COALESCE($7,true),$8) RETURNING *`,
    [
      r.recipe_key,
      r.display_name,
      JSON.stringify(r.ingredients),
      r.instructions || null,
      r.target_shade || null,
      r.notes || null,
      r.is_active === undefined ? null : r.is_active,
      user_id || null,
    ],
  );
  return rows[0];
}
async function updateRecipe({ brand, id, patch }) {
  const allowed = [
    "display_name",
    "ingredients",
    "instructions",
    "target_shade",
    "notes",
    "is_active",
  ];
  const sets = [];
  const params = [];
  let i = 1;
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    if (k === "ingredients") {
      sets.push(`${k} = $${i++}::jsonb`);
      params.push(JSON.stringify(patch[k]));
    } else {
      sets.push(`${k} = $${i++}`);
      params.push(patch[k]);
    }
  }
  if (!sets.length) return getRecipe({ brand, id });
  params.push(id);
  const { rows } = await query(
    `UPDATE ${t(brand, "chemical_recipes")} SET ${sets.join(", ")}, updated_at = now()
      WHERE recipe_id = $${i} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── service_job_chemicals (F-7d) ───────────────────────────
async function addJobChemical({ client, brand, jc }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "service_job_chemicals")}
       (job_id, chemical_name, chemical_brand, variant_id, qty_used, unit, cost_ngn, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [
      jc.job_id,
      jc.chemical_name,
      jc.chemical_brand || null,
      jc.variant_id || null,
      jc.qty_used,
      jc.unit,
      jc.cost_ngn ?? null,
      jc.notes || null,
      jc.recorded_by || null,
    ],
  );
  return rows[0];
}
async function listJobChemicals({ brand, job_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "service_job_chemicals")}
      WHERE job_id = $1 ORDER BY recorded_at`,
    [job_id],
  );
  return rows;
}

// ── monthly_chemical_reconciliations (F-7e) ────────────────
async function getFiscalPeriod({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "fiscal_periods")} WHERE period_id = $1`,
    [id],
  );
  return rows[0] || null;
}
// Periods that ended within the last `days` and aren't locked — the month-end
// reconciliation cron targets these.
async function periodsEndedWithin({ brand, days }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "fiscal_periods")}
      WHERE ends_on <= CURRENT_DATE
        AND ends_on >= CURRENT_DATE - ($1 || ' days')::interval
        AND status <> 'locked'
      ORDER BY ends_on DESC`,
    [String(days)],
  );
  return rows;
}
// Consumed per chemical for jobs whose chemical usage was recorded in [start,end].
async function consumedByChemical({ brand, starts_on, ends_on }) {
  const { rows } = await query(
    `SELECT chemical_name, unit, SUM(qty_used)::numeric(12,3) AS qty_consumed,
            SUM(COALESCE(cost_ngn,0))::numeric(14,2) AS cost_ngn
       FROM ${t(brand, "service_job_chemicals")}
      WHERE recorded_at::date BETWEEN $1 AND $2
      GROUP BY chemical_name, unit
      ORDER BY chemical_name, unit`,
    [starts_on, ends_on],
  );
  return rows;
}
async function upsertReconciliation({ client, brand, rec }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "monthly_chemical_reconciliations")}
       (fiscal_period_id, chemical_name, unit, qty_purchased, qty_consumed,
        qty_disposed, variance_value_ngn, variance_status, investigation_notes, computed_at)
     VALUES ($1,$2,$3,COALESCE($4,0),COALESCE($5,0),COALESCE($6,0),$7,COALESCE($8,'normal'),$9, now())
     ON CONFLICT (fiscal_period_id, chemical_name, unit) DO UPDATE
       SET qty_purchased = EXCLUDED.qty_purchased,
           qty_consumed = EXCLUDED.qty_consumed,
           qty_disposed = EXCLUDED.qty_disposed,
           variance_value_ngn = EXCLUDED.variance_value_ngn,
           variance_status = EXCLUDED.variance_status,
           computed_at = now()
     RETURNING *`,
    [
      rec.fiscal_period_id,
      rec.chemical_name,
      rec.unit,
      rec.qty_purchased,
      rec.qty_consumed,
      rec.qty_disposed,
      rec.variance_value_ngn ?? null,
      rec.variance_status,
      rec.investigation_notes || null,
    ],
  );
  return rows[0];
}
async function listReconciliations({
  brand,
  fiscal_period_id,
  variance_status,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (fiscal_period_id) {
    where.push(`fiscal_period_id = $${i++}`);
    params.push(fiscal_period_id);
  }
  if (variance_status) {
    where.push(`variance_status = $${i++}`);
    params.push(variance_status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "monthly_chemical_reconciliations")} ${w}
      ORDER BY chemical_name, unit`,
    params,
  );
  return rows;
}
// Existing recorded purchased qty for a period (so a recompute preserves the
// admin-entered qty_purchased / qty_disposed rather than zeroing it).
async function existingReconciliationMap({ brand, fiscal_period_id }) {
  const { rows } = await query(
    `SELECT chemical_name, unit, qty_purchased, qty_disposed
       FROM ${t(brand, "monthly_chemical_reconciliations")}
      WHERE fiscal_period_id = $1`,
    [fiscal_period_id],
  );
  return rows;
}

// ════════════════════════════════════════════════════════════
// Stylist Studio (PR2) — lifecycle, materials, references, custody
// ════════════════════════════════════════════════════════════

// ── studio_config (the one friendly knob: missing-wig threshold) ──
async function getStudioConfig({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "studio_config")} WHERE singleton = true`,
  );
  return rows[0] || { missing_wig_threshold_days: 7 };
}

// ── styled-product production DNA (for job inheritance) ─────
async function getStyledDNA({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT styled_id, base_product_id, base_variant_id, name,
            style_addon_price_ngn, default_service_type_id, default_recipe_id,
            standard_turnaround_days, sop_steps
       FROM ${t(brand, "styled_products")} WHERE styled_id = $1`,
    [styled_id],
  );
  return rows[0] || null;
}
async function listStyledBom({ client, brand, styled_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "styled_product_bom")}
      WHERE styled_id = $1 AND is_active = true ORDER BY display_order`,
    [styled_id],
  );
  return rows;
}
// The first order line that needs styling work (styled or service). Drives the
// deposit-met auto-open so a plain wig sale never opens a job.
async function firstStudioLine({ client, brand, order_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "sales_order_lines")}
      WHERE order_id = $1 AND line_kind IN ('styled','service')
      ORDER BY display_order, line_id LIMIT 1`,
    [order_id],
  );
  return rows[0] || null;
}

// ── time sessions ──────────────────────────────────────────
async function getOpenTimeSession({ client, brand, job_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "service_job_time_logs")}
      WHERE job_id = $1 AND ended_at IS NULL LIMIT 1`,
    [job_id],
  );
  return rows[0] || null;
}
async function openTimeSession({ client, brand, job_id, stylist_user_id }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "service_job_time_logs")} (job_id, stylist_user_id)
     VALUES ($1,$2) RETURNING *`,
    [job_id, stylist_user_id || null],
  );
  return rows[0];
}
async function closeTimeSession({ client, brand, log_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "service_job_time_logs")}
        SET ended_at = now(),
            duration_minutes = GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - started_at)) / 60))
      WHERE log_id = $1 RETURNING *`,
    [log_id],
  );
  return rows[0] || null;
}
async function listTimeLogs({ brand, job_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "service_job_time_logs")}
      WHERE job_id = $1 ORDER BY started_at`,
    [job_id],
  );
  return rows;
}
async function totalActiveMinutes({ client, brand, job_id }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(duration_minutes),0)::int AS minutes
       FROM ${t(brand, "service_job_time_logs")} WHERE job_id = $1`,
    [job_id],
  );
  return rows[0].minutes;
}

// ── materials ──────────────────────────────────────────────
async function addMaterial({ client, brand, m }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "service_job_materials")}
       (job_id, kind, variant_id, quantity, chemical_name, usage_note,
        stock_deducted, stock_movement_id, logged_by)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false),$8,$9) RETURNING *`,
    [
      m.job_id,
      m.kind,
      m.variant_id || null,
      m.quantity ?? null,
      m.chemical_name || null,
      m.usage_note || null,
      m.stock_deducted ?? null,
      m.stock_movement_id || null,
      m.logged_by || null,
    ],
  );
  return rows[0];
}
async function markMaterialDeducted({
  client,
  brand,
  material_id,
  movement_id,
}) {
  await ex(client)(
    `UPDATE ${t(brand, "service_job_materials")}
        SET stock_deducted = true, stock_movement_id = $2 WHERE material_id = $1`,
    [material_id, movement_id || null],
  );
}
async function listMaterials({ brand, job_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "service_job_materials")}
      WHERE job_id = $1 ORDER BY created_at`,
    [job_id],
  );
  return rows;
}

// ── references (style brief) ───────────────────────────────
async function addReference({ client, brand, r }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "service_job_references")}
       (job_id, ref_type, doc_id, url, body, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      r.job_id,
      r.ref_type,
      r.doc_id || null,
      r.url || null,
      r.body || null,
      r.created_by || null,
    ],
  );
  return rows[0];
}
async function listReferences({ brand, job_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "service_job_references")}
      WHERE job_id = $1 ORDER BY created_at`,
    [job_id],
  );
  return rows;
}
async function deleteReference({ brand, job_id, reference_id }) {
  const { rowCount } = await query(
    `DELETE FROM ${t(brand, "service_job_references")}
      WHERE reference_id = $1 AND job_id = $2`,
    [reference_id, job_id],
  );
  return rowCount > 0;
}

// ── wig custody ledger (quantity accountability) ───────────
async function addCustody({ client, brand, c }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "wig_custody_ledger")}
       (job_id, event, quantity, stylist_user_id, location, reason, created_by)
     VALUES ($1,$2,COALESCE($3,1),$4,$5,$6,$7) RETURNING *`,
    [
      c.job_id || null,
      c.event,
      c.quantity ?? null,
      c.stylist_user_id || null,
      c.location || null,
      c.reason || null,
      c.created_by || null,
    ],
  );
  return rows[0];
}
async function hasCustodyEvent({ client, brand, job_id, event }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "wig_custody_ledger")}
      WHERE job_id = $1 AND event = $2 LIMIT 1`,
    [job_id, event],
  );
  return rows.length > 0;
}
async function listCustody({ brand, job_id, stylist_user_id, limit = 200 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (job_id) {
    where.push(`job_id = $${i++}`);
    params.push(job_id);
  }
  if (stylist_user_id) {
    where.push(`stylist_user_id = $${i++}`);
    params.push(stylist_user_id);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "wig_custody_ledger")} ${w}
      ORDER BY created_at DESC LIMIT $${i}`,
    params,
  );
  return rows;
}
// Net wigs currently held per stylist:
//   Σ(out) − Σ(return) − Σ(dispatched) − Σ(write_off).
async function custodyBalances({ brand }) {
  const { rows } = await query(
    `SELECT l.stylist_user_id,
            u.display_name AS stylist_name,
            SUM(CASE WHEN l.event = 'out'        THEN l.quantity ELSE 0 END)
          - SUM(CASE WHEN l.event = 'return'     THEN l.quantity ELSE 0 END)
          - SUM(CASE WHEN l.event = 'dispatched' THEN l.quantity ELSE 0 END)
          - SUM(CASE WHEN l.event = 'write_off'  THEN l.quantity ELSE 0 END) AS holding
       FROM ${t(brand, "wig_custody_ledger")} l
       LEFT JOIN shared.users u ON u.user_id = l.stylist_user_id
      WHERE l.stylist_user_id IS NOT NULL
      GROUP BY l.stylist_user_id, u.display_name
      HAVING SUM(CASE WHEN l.event = 'out'        THEN l.quantity ELSE 0 END)
           - SUM(CASE WHEN l.event = 'return'     THEN l.quantity ELSE 0 END)
           - SUM(CASE WHEN l.event = 'dispatched' THEN l.quantity ELSE 0 END)
           - SUM(CASE WHEN l.event = 'write_off'  THEN l.quantity ELSE 0 END) <> 0
      ORDER BY holding DESC`,
  );
  return rows;
}
// Jobs sent OUT to a stylist with no matching RETURN/dispatch, older than
// `threshold_days` — the "go check on this wig" signal.
async function overdueOutWigs({ brand, threshold_days }) {
  const { rows } = await query(
    `WITH outs AS (
       SELECT l.job_id, l.stylist_user_id, MIN(l.created_at) AS out_at
         FROM ${t(brand, "wig_custody_ledger")} l
        WHERE l.event = 'out'
        GROUP BY l.job_id, l.stylist_user_id
     ),
     backs AS (
       SELECT DISTINCT job_id FROM ${t(brand, "wig_custody_ledger")}
        WHERE event IN ('return','dispatched','write_off')
     )
     SELECT o.job_id, o.stylist_user_id, o.out_at,
            u.display_name AS stylist_name, j.job_number,
            EXTRACT(DAY FROM now() - o.out_at)::int AS days_out
       FROM outs o
       LEFT JOIN backs b ON b.job_id = o.job_id
       LEFT JOIN shared.users u ON u.user_id = o.stylist_user_id
       LEFT JOIN ${t(brand, "service_jobs")} j ON j.job_id = o.job_id
      WHERE b.job_id IS NULL
        AND o.out_at < now() - ($1 || ' days')::interval
      ORDER BY o.out_at`,
    [String(threshold_days)],
  );
  return rows;
}

module.exports = {
  nextNumber,
  listServiceTypes,
  getDefaultServiceType,
  findServiceType,
  createServiceType,
  updateServiceType,
  createServiceJob,
  getServiceJob,
  listServiceJobs,
  serviceJobExistsForOrder,
  setServiceJobStatus,
  updateServiceJob,
  getStudioConfig,
  getStyledDNA,
  listStyledBom,
  firstStudioLine,
  getOpenTimeSession,
  openTimeSession,
  closeTimeSession,
  listTimeLogs,
  totalActiveMinutes,
  addMaterial,
  markMaterialDeducted,
  listMaterials,
  addReference,
  listReferences,
  deleteReference,
  addCustody,
  hasCustodyEvent,
  listCustody,
  custodyBalances,
  overdueOutWigs,
  listRecipes,
  getRecipe,
  createRecipe,
  updateRecipe,
  addJobChemical,
  listJobChemicals,
  getFiscalPeriod,
  periodsEndedWithin,
  consumedByChemical,
  upsertReconciliation,
  listReconciliations,
  existingReconciliationMap,
};
