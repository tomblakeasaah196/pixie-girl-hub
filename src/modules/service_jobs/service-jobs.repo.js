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

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

async function nextNumber({ client, brand, type }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}($1) AS n`,
    [type],
  );
  return rows[0].n;
}
// 3-digit numeric half of the physical hand-off tag — cycles 1..999 then
// wraps; see fn_next_stylist_tag (migration template 000082). The full tag
// (e.g. "342NS") is this plus 2 initials letters — see deriveTagInitials.
async function nextTagSequence({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_stylist_tag")}() AS n`,
  );
  return rows[0].n;
}

// First letters of the first two significant words in a name, e.g.
// "Nala Sleek Bang Blacks" -> "NS". Falls back to the first two letters of a
// single-word name, or "XX" when there's no name to draw from at all (a
// custom job with neither a styled product nor a hair description).
function deriveTagInitials(name) {
  const words = (name || "")
    .trim()
    .split(/\s+/)
    .filter((w) => /[a-zA-Z]/.test(w));
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) {
    const letters = words[0].replace(/[^a-zA-Z]/g, "");
    return (letters.slice(0, 2).padEnd(2, "X")).toUpperCase();
  }
  return "XX";
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
// Resolve a specific active service type by its stable key (e.g. 'styling',
// 'installation'). Used to open styled-product jobs as Styling rather than the
// arbitrary display_order=1 default. Returns null when the brand has no such
// (active) type — callers fall back to the brand default.
async function getServiceTypeByKey({ client, brand, key }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "service_types")}
      WHERE service_key = $1 AND is_active = true LIMIT 1`,
    [key],
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
    `SELECT j.*, st.display_name AS service_type_name, st.service_key,
            ic.ic_number          AS intercompany_number,
            ic.seller_doc_number  AS intercompany_seller_doc,
            ic.seller_brand       AS intercompany_seller_brand,
            ic.buyer_brand        AS intercompany_buyer_brand,
            ic.status             AS intercompany_status,
            ic.amount_ngn         AS intercompany_amount_ngn,
            -- Identity/context (name only — never a phone/email; stylists
            -- don't get customer contact details, per V2.2 access rules).
            c.display_name        AS customer_name,
            so.order_number        AS sales_order_number,
            so.placed_at            AS order_placed_at,
            pv.variant_name          AS base_product_name,
            sty.name                  AS styled_product_name,
            ${primaryStyledImageSql(brand, "sty")} AS styled_product_image_url,
            -- Wig custody: currently OUT with no return/dispatch/write-off yet.
            (SELECT MIN(l.created_at)
               FROM ${t(brand, "wig_custody_ledger")} l
              WHERE l.job_id = j.job_id AND l.event = 'out'
                AND NOT EXISTS (
                  SELECT 1 FROM ${t(brand, "wig_custody_ledger")} l2
                   WHERE l2.job_id = j.job_id
                     AND l2.event IN ('return','dispatched','write_off')
                )) AS wig_out_at,
            -- Cost rollup: materials (stock-deducted discrete items, priced at
            -- their deduction-time cost) + chemicals logged against this job.
            (SELECT COALESCE(SUM(sjm.quantity * sm.unit_cost_ngn), 0)
               FROM ${t(brand, "service_job_materials")} sjm
               LEFT JOIN ${t(brand, "stock_movements")} sm
                      ON sm.movement_id = sjm.stock_movement_id
              WHERE sjm.job_id = j.job_id AND sjm.kind = 'discrete') AS materials_cost_ngn,
            (SELECT COALESCE(SUM(sjc.cost_ngn), 0)
               FROM ${t(brand, "service_job_chemicals")} sjc
              WHERE sjc.job_id = j.job_id) AS chemicals_cost_ngn
       FROM ${t(brand, "service_jobs")} j
       LEFT JOIN ${t(brand, "service_types")} st ON st.service_type_id = j.service_type_id
       LEFT JOIN shared.intercompany_transactions ic
              ON ic.ic_transaction_id = j.intercompany_transaction_id
       LEFT JOIN shared.contacts c ON c.contact_id = j.customer_contact_id
       LEFT JOIN ${t(brand, "sales_orders")} so ON so.order_id = j.sales_order_id
       LEFT JOIN ${t(brand, "product_variants")} pv ON pv.variant_id = j.hair_variant_id
       LEFT JOIN ${t(brand, "styled_products")} sty ON sty.styled_id = j.styled_id
      WHERE j.job_id = $1`,
    [id],
  );
  return rows[0] || null;
}
// Styled product hero image, in priority order: explicit primary_image_id →
// the default colour's first picture → any picture on the styled product.
// Mirrors styled.repo.js's primaryImageSql (kept local — repos don't import
// across modules in this codebase — same lookup, just against the `sty`
// alias used here).
function primaryStyledImageSql(brand, alias) {
  return `COALESCE(
    (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
      WHERE pi.image_id = ${alias}.primary_image_id),
    (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
       JOIN ${t(brand, "styled_product_colours")} col ON col.colour_id = pi.styled_colour_id
      WHERE col.styled_id = ${alias}.styled_id
      ORDER BY col.is_default DESC, col.display_order, pi.display_order LIMIT 1),
    (SELECT pi.cdn_url FROM ${t(brand, "product_images")} pi
      WHERE pi.styled_id = ${alias}.styled_id
      ORDER BY pi.is_primary DESC, pi.display_order LIMIT 1))`;
}
// Full lifecycle timeline for one job, read straight from the audit log
// every state-changing action already writes to (assign/start/pause/resume/
// return/qc/dispatch/hand_to_sales/outcome) — no separate event table needed.
async function listJobActivity({ brand, job_id }) {
  const { rows } = await query(
    // Resolve the actor's CURRENT display name at read time rather than
    // trusting the snapshot text column — audit_log is append-only (a DB
    // trigger blocks UPDATE/DELETE), so any row written before user_name
    // was populated correctly can never be backfilled in place. A live join
    // fixes those old rows' display too, not just new ones going forward.
    `SELECT al.log_id, al.occurred_at,
            COALESCE(u.display_name, al.user_name) AS user_name,
            al.action, al.after_state
       FROM shared.audit_log al
       LEFT JOIN shared.users u ON u.user_id = al.user_id
      WHERE al.business = $1 AND al.table_name = 'service_job' AND al.record_id = $2
      ORDER BY al.occurred_at ASC`,
    [brand, job_id],
  );
  return rows;
}
/**
 * Flow-1 linkage: bind a service job to its matched inter-company styling
 * transaction (the FLH styling invoice → PXG). Sets is_intercompany so the
 * books-integrity watchdog treats it as a cross-entity job.
 */
async function linkIntercompany({ client, brand, id, ic_transaction_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "service_jobs")}
        SET intercompany_transaction_id = $2,
            is_intercompany = true,
            updated_at = now()
      WHERE job_id = $1 RETURNING *`,
    [id, ic_transaction_id],
  );
  return rows[0] || null;
}
async function listServiceJobs({
  brand,
  status,
  assigned_staff_user_id,
  assigned_stylist_id,
  customer_contact_id,
  sales_order_id,
  own_user_id,
  page = 1,
  page_size = 25,
}) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`sj.status = $${i++}`);
    params.push(status);
  }
  if (assigned_staff_user_id) {
    where.push(`sj.assigned_staff_user_id = $${i++}`);
    params.push(assigned_staff_user_id);
  }
  if (assigned_stylist_id) {
    where.push(`sj.assigned_stylist_id = $${i++}`);
    params.push(assigned_stylist_id);
  }
  if (customer_contact_id) {
    where.push(`sj.customer_contact_id = $${i++}`);
    params.push(customer_contact_id);
  }
  if (sales_order_id) {
    where.push(`sj.sales_order_id = $${i++}`);
    params.push(sales_order_id);
  }
  // Own-scope filter: current OR historical owner. A stylist keeps history on
  // their scorecard after Ops reassigns a job away, so we OR the current
  // assignment with any wig_custody_ledger row where they were the stylist.
  if (own_user_id) {
    where.push(`(
      sj.assigned_staff_user_id = $${i}
      OR EXISTS (
        SELECT 1 FROM ${t(brand, "wig_custody_ledger")} l
         WHERE l.job_id = sj.job_id AND l.stylist_user_id = $${i}
      )
    )`);
    params.push(own_user_id);
    i++;
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM ${t(brand, "service_jobs")} sj ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  // Enrich with the source order's number (Studio board shows "which order is
  // this wig for?"), the assigned stylist's display name (the Order page's
  // Studio card shows WHO has the wig, not a UUID), and the customer's name
  // (name only — board search matches on it, but no contact details ride
  // along here).
  const { rows } = await query(
    `SELECT sj.*, so.order_number AS sales_order_number,
            u.display_name AS assigned_staff_name,
            c.display_name AS customer_name
       FROM ${t(brand, "service_jobs")} sj
       LEFT JOIN ${t(brand, "sales_orders")} so
         ON so.order_id = sj.sales_order_id
       LEFT JOIN shared.users u
         ON u.user_id = sj.assigned_staff_user_id
       LEFT JOIN shared.contacts c
         ON c.contact_id = sj.customer_contact_id
      ${w}
      ORDER BY sj.created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}
/**
 * Own-scope access check for a specific job — mirrors the `own_user_id`
 * OR-clause in listServiceJobs. Returns true when the user is either the
 * CURRENT assignee or was ever a stylist on this job (kept as owner for
 * history purposes; scorecards + past-work visibility rely on this).
 */
async function userHasJobAccess({ brand, job_id, user_id }) {
  const { rows } = await query(
    `SELECT 1
       FROM ${t(brand, "service_jobs")} sj
      WHERE sj.job_id = $1
        AND (
          sj.assigned_staff_user_id = $2
          OR EXISTS (
            SELECT 1 FROM ${t(brand, "wig_custody_ledger")} l
             WHERE l.job_id = sj.job_id AND l.stylist_user_id = $2
          )
        )
      LIMIT 1`,
    [job_id, user_id],
  );
  return rows.length > 0;
}

/** Current assignee's display name — surfaced in the NO_LONGER_ASSIGNED 403
 * so the frontend can render "reassigned to X" instead of a bare denial. */
async function getJobAssigneeName({ brand, id }) {
  const { rows } = await query(
    `SELECT u.display_name AS name
       FROM ${t(brand, "service_jobs")} sj
       LEFT JOIN shared.users u ON u.user_id = sj.assigned_staff_user_id
      WHERE sj.job_id = $1`,
    [id],
  );
  return rows[0] ? rows[0].name : null;
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
/**
 * The single OPEN time session (started_at set, ended_at null) currently
 * running for this user across every job in the brand, joined with the
 * job's number + service-type label so the "You're working on Job X" strip
 * can render without a second round-trip. Returns null when no clock is
 * running (which is the normal state; the strip stays hidden).
 *
 * A stylist should only ever have one open session at a time (startWork
 * refuses to open a second one for the same job), but the LIMIT 1 keeps
 * this honest even if the invariant slips.
 */
async function getUsersOpenSession({ brand, user_id }) {
  const { rows } = await query(
    `SELECT tl.log_id, tl.job_id, tl.started_at,
            sj.job_number, sj.status AS job_status,
            st.display_name AS service_type_name
       FROM ${t(brand, "service_job_time_logs")} tl
       JOIN ${t(brand, "service_jobs")} sj ON sj.job_id = tl.job_id
       LEFT JOIN ${t(brand, "service_types")} st
         ON st.service_type_id = sj.service_type_id
      WHERE tl.stylist_user_id = $1 AND tl.ended_at IS NULL
      ORDER BY tl.started_at DESC LIMIT 1`,
    [user_id],
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
       (job_id, ref_type, doc_id, url, body, created_by, is_locked)
     VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,false)) RETURNING *`,
    [
      r.job_id,
      r.ref_type,
      r.doc_id || null,
      r.url || null,
      r.body || null,
      r.created_by || null,
      r.is_locked === true,
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
  // The customer's locked brief can never be deleted here — only supplementary
  // (is_locked = false) notes. The is_locked guard in SQL means even a
  // hand-crafted request can't remove the original brief.
  const { rowCount } = await query(
    `DELETE FROM ${t(brand, "service_job_references")}
      WHERE reference_id = $1 AND job_id = $2 AND is_locked = false`,
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
// True when the sales order this job was spawned from ALREADY pulled this base
// wig out of stock at payment: markPaid posts a non-studio 'sale' movement
// against (order_id, variant_id). When it did, the Studio must NOT deduct again
// — it only moves the wig into stylist custody. Standalone/walk-in jobs (no
// sales_order_id, or an order whose line carried no stock-backed product) have
// no such movement and DO deduct in the Studio. Guards the styled-order
// double-deduction where one physical wig lost two units (sale + assignment).
async function orderAlreadyDrewWig({
  client,
  brand,
  sales_order_id,
  variant_id,
}) {
  if (!sales_order_id || !variant_id) return false;
  const { rows } = await ex(client)(
    `SELECT 1 FROM ${t(brand, "stock_movements")}
      WHERE reference_id = $1
        AND variant_id = $2
        AND movement_type = 'sale'
        AND sales_channel IS DISTINCT FROM 'service_job'
      LIMIT 1`,
    [sales_order_id, variant_id],
  );
  return rows.length > 0;
}
// Net wigs this job currently has OUT: Σ(out) − Σ(return|dispatched|write_off).
// > 0 means the wig is physically with a stylist right now.
async function jobCustodyBalance({ client, brand, job_id }) {
  const { rows } = await ex(client)(
    `SELECT COALESCE(SUM(CASE
              WHEN event = 'out' THEN quantity
              WHEN event IN ('return','dispatched','write_off') THEN -quantity
              ELSE 0 END), 0)::int AS net
       FROM ${t(brand, "wig_custody_ledger")} WHERE job_id = $1`,
    [job_id],
  );
  return rows[0].net;
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
            u.display_name AS stylist_name, j.job_number, j.created_by,
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

/**
 * Return staff who can be assigned service jobs — stylists (Junior/Senior/
 * Head Stylist) in the Operations department of the active brand who have an
 * active login account. Includes a live open-jobs count (pending or
 * in_progress or assigned or on_hold or rework) and an on-leave-today flag so
 * the picker can show workload + availability without a second round-trip.
 *
 * Department is matched two ways so no one is missed regardless of which
 * source a brand keeps current: the legacy `staff_profiles.department` text
 * AND membership of an "Operations" org unit (org_positions → org_units, the
 * newer source of truth). Within that department, job_title (kept in sync
 * with the org-position seat by org.service.syncProfileFromPosition) narrows
 * the pool to stylist seats only — Operations Manager, Head of Security, and
 * Sanitation Officer are Operations staff but not assignable to styling jobs.
 */
async function listAssignableStylists({ brand }) {
  const { rows } = await query(
    `WITH open_jobs AS (
       SELECT assigned_staff_user_id AS user_id, COUNT(*) AS n
         FROM ${t(brand, "service_jobs")}
        WHERE assigned_staff_user_id IS NOT NULL
          AND status IN ('assigned','in_progress','on_hold','rework')
        GROUP BY assigned_staff_user_id
     )
     SELECT
       u.user_id,
       COALESCE(NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''), u.email) AS full_name,
       u.avatar_url,
       sp.job_title,
       sp.department,
       COALESCE(oj.n, 0)::int AS open_jobs_count,
       EXISTS (
         SELECT 1
           FROM shared.leave_requests lr
          WHERE lr.profile_id = sp.profile_id
            AND lr.status = 'approved'
            AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date
       ) AS on_leave_today
       FROM shared.staff_profiles sp
       JOIN shared.users u ON u.staff_profile_id = sp.profile_id
       JOIN shared.contacts c ON c.contact_id = sp.contact_id
       LEFT JOIN open_jobs oj ON oj.user_id = u.user_id
      WHERE sp.business = $1
        AND sp.is_deleted = false
        AND (sp.end_date IS NULL OR sp.end_date >= CURRENT_DATE)
        AND u.status <> 'disabled'
        AND sp.job_title ILIKE '%stylist%'
        AND (
          TRIM(sp.department) ILIKE 'operations'
          OR EXISTS (
            SELECT 1
              FROM shared.org_positions op
              JOIN shared.org_units ou ON ou.unit_id = op.unit_id
             WHERE op.profile_id = sp.profile_id
               AND ou.business = sp.business
               AND (TRIM(ou.unit_key) ILIKE 'operations'
                    OR TRIM(ou.display_name) ILIKE 'operations')
          )
        )
      ORDER BY on_leave_today ASC, open_jobs_count ASC, full_name ASC`,
    [brand],
  );
  return rows;
}

// Shared aggregate expression for both scorecard queries below — one row per
// (assigned) in-house stylist, never touching shared.stylist_partners /
// stylist_assignments (the separate Stylist Partner Programme tables).
const SCORECARD_AGGREGATE_COLS = `
  COUNT(*)::int AS jobs_total,
  COUNT(*) FILTER (WHERE sj.status = 'completed')::int AS jobs_completed,
  ROUND(AVG(sj.quality_rating)::numeric, 2) AS avg_quality_rating,
  ROUND(AVG(sj.customer_rating)::numeric, 2) AS avg_customer_rating,
  COALESCE(SUM(sj.rework_count), 0)::int AS rework_count,
  ROUND(
    100.0 * COUNT(*) FILTER (
      WHERE sj.status = 'completed' AND sj.sla_due_at IS NOT NULL
        AND sj.completed_at <= sj.sla_due_at
    )
    / NULLIF(COUNT(*) FILTER (
        WHERE sj.status = 'completed' AND sj.sla_due_at IS NOT NULL
      ), 0)::numeric,
    0
  ) AS on_time_pct`;

/**
 * Roster for the Scorecards tab — every in-house stylist who has EVER been
 * assigned a job in this brand (not just currently-assignable ones, so
 * someone who's moved role or left still shows their history), each with
 * their aggregate quality/happiness/on-time/rework numbers.
 */
async function listStylistScorecards({ brand }) {
  const { rows } = await query(
    `SELECT u.user_id, c.display_name AS full_name, u.avatar_url,
            sp.job_title,
            ${SCORECARD_AGGREGATE_COLS}
       FROM ${t(brand, "service_jobs")} sj
       JOIN shared.users u ON u.user_id = sj.assigned_staff_user_id
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE sj.assigned_staff_user_id IS NOT NULL
      GROUP BY u.user_id, c.display_name, u.avatar_url, sp.job_title
      ORDER BY full_name`,
    // No bind params: brand scoping is via the schema name (t(brand, …)),
    // not a placeholder. Passing [brand] here crashed every call — Postgres
    // rejects a bind of 1 param against a statement with 0 placeholders.
  );
  return rows;
}

/** Full drill-down for one stylist: the same aggregate, their job history
 * (with each job's rating/comments so a trend is visible), and their rework
 * history (drawn from the audit log — see recordQc — attributed to whoever
 * the job is CURRENTLY assigned to; a reassigned-mid-rework job's earlier
 * rework events follow the job's current owner, not a point-in-time one). */
async function getStylistScorecard({ brand, user_id }) {
  const { rows: summaryRows } = await query(
    `SELECT u.user_id, c.display_name AS full_name, u.avatar_url,
            sp.job_title,
            ${SCORECARD_AGGREGATE_COLS}
       FROM ${t(brand, "service_jobs")} sj
       JOIN shared.users u ON u.user_id = sj.assigned_staff_user_id
       LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
       LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
      WHERE sj.assigned_staff_user_id = $1
      GROUP BY u.user_id, c.display_name, u.avatar_url, sp.job_title`,
    [user_id],
  );
  if (!summaryRows[0]) return null;

  const { rows: jobs } = await query(
    `SELECT job_id, job_number, tag_code, status, quality_rating,
            customer_rating, customer_feedback, quality_notes, rework_count,
            scheduled_for, expected_completion_at, sla_due_at, completed_at,
            created_at
       FROM ${t(brand, "service_jobs")}
      WHERE assigned_staff_user_id = $1
      ORDER BY created_at DESC`,
    [user_id],
  );

  const { rows: rework } = await query(
    // Same live-name resolution as listJobActivity — audit_log is
    // append-only, so a join beats trusting the stored snapshot text.
    `SELECT al.log_id, al.occurred_at,
            COALESCE(u.display_name, al.user_name) AS user_name,
            al.after_state, sj.job_id, sj.job_number
       FROM shared.audit_log al
       JOIN ${t(brand, "service_jobs")} sj ON sj.job_id = al.record_id
       LEFT JOIN shared.users u ON u.user_id = al.user_id
      WHERE al.business = $1 AND al.table_name = 'service_job'
        AND al.action = 'service_jobs.qc'
        AND al.after_state->>'result' = 'rework'
        AND sj.assigned_staff_user_id = $2
      ORDER BY al.occurred_at DESC`,
    [brand, user_id],
  );

  return { ...summaryRows[0], jobs, rework };
}

/**
 * Count a staffer's done, quality-passing jobs in a month — the quality-gated
 * numerator for the `styles_completed` / `services_completed` target progress.
 */
async function countCompletedQualityForUser({ client, brand, userId, year, month, minQuality }) {
  const run = client ? client.query.bind(client) : query;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to =
    month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const { rows } = await run(
    `SELECT count(*)::int AS n
       FROM ${t(brand, "service_jobs")}
      WHERE assigned_staff_user_id = $1
        AND completed_at IS NOT NULL
        AND quality_rating IS NOT NULL AND quality_rating >= $2
        AND completed_at >= $3 AND completed_at < $4`,
    [userId, minQuality, from, to],
  );
  return rows[0] ? rows[0].n : 0;
}

module.exports = {
  nextNumber,
  nextTagSequence,
  deriveTagInitials,
  listJobActivity,
  countCompletedQualityForUser,
  listServiceTypes,
  listAssignableStylists,
  listStylistScorecards,
  getStylistScorecard,
  getDefaultServiceType,
  getServiceTypeByKey,
  findServiceType,
  createServiceType,
  updateServiceType,
  createServiceJob,
  getServiceJob,
  listServiceJobs,
  userHasJobAccess,
  getJobAssigneeName,
  serviceJobExistsForOrder,
  setServiceJobStatus,
  updateServiceJob,
  linkIntercompany,
  getStudioConfig,
  getStyledDNA,
  listStyledBom,
  firstStudioLine,
  getOpenTimeSession,
  getUsersOpenSession,
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
  orderAlreadyDrewWig,
  jobCustodyBalance,
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
