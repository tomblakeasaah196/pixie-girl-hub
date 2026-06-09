/**
 * CRM (V2.2 §6.1) — repository.
 * Tables (per-brand): crm_pipelines, crm_pipeline_stages, crm_deals,
 * crm_activities, crm_notes. deal_number via fn_next_document_number('crm_deal').
 */

"use strict";

const { query } = require("../../config/database");

const { VALID } = require("../../config/brands");
const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

const PIPE = [
  "pipeline_key",
  "display_name",
  "description",
  "is_default",
  "applies_to",
  "display_order",
  "is_active",
];
const STAGE = [
  "stage_key",
  "display_name",
  "description",
  "display_order",
  "colour",
  "is_terminal",
  "is_won",
  "is_lost",
  "win_probability_pct",
  "sla_days",
  "workflow_trigger_key",
  "is_active",
];
const DEAL = [
  "contact_id",
  "pipeline_id",
  "current_stage_id",
  "title",
  "description",
  "expected_value_ngn",
  "expected_close_date",
  "source_channel",
  "source_reference",
  "assigned_to",
];
const ACT = [
  "contact_id",
  "deal_id",
  "activity_type",
  "direction",
  "subject",
  "body",
  "outcome",
  "external_ref",
  "scheduled_at",
  "duration_minutes",
];
const NOTE = ["contact_id", "deal_id", "body", "is_pinned", "visibility"];

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

// Pipelines + stages
async function listPipelines({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_pipelines")} ORDER BY display_order, display_name`,
  );
  return rows;
}
async function getPipeline({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_pipelines")} WHERE pipeline_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function createPipeline({ client, brand, input }) {
  const { f, ph, p } = ins(PIPE, input);
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_pipelines")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updatePipeline({ client, brand, id, patch }) {
  const { f, p, next } = upd(PIPE, patch);
  if (!f.length) return getPipeline({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "crm_pipelines")} SET ${f.join(",")} WHERE pipeline_id = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function archivePipeline({ client, brand, id }) {
  await ex(client)(
    `UPDATE ${t(brand, "crm_pipelines")} SET is_active = false WHERE pipeline_id = $1`,
    [id],
  );
}
async function listStages({ client, brand, pipeline_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_pipeline_stages")} WHERE pipeline_id = $1 ORDER BY display_order`,
    [pipeline_id],
  );
  return rows;
}
async function getStage({ client, brand, stage_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_pipeline_stages")} WHERE stage_id = $1`,
    [stage_id],
  );
  return rows[0] || null;
}
async function createStage({ client, brand, pipeline_id, input }) {
  const { f, ph, p } = ins(STAGE, input, { pipeline_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_pipeline_stages")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateStage({ client, brand, stage_id, patch }) {
  const { f, p, next } = upd(STAGE, patch);
  if (!f.length) return getStage({ client, brand, stage_id });
  p.push(stage_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "crm_pipeline_stages")} SET ${f.join(",")} WHERE stage_id = $${next} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function deleteStage({ client, brand, stage_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "crm_pipeline_stages")} WHERE stage_id = $1`,
    [stage_id],
  );
  return rowCount > 0;
}

// Deals
async function nextDealNumber({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}('crm_deal') AS n`,
  );
  return rows[0].n;
}
async function findAllDeals({
  client,
  brand,
  filters = {},
  scope,
  user_id,
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const where = ["is_deleted = false"];
  const params = [];
  let i = 1;
  if (filters.pipeline_id) {
    where.push(`pipeline_id = $${i++}`);
    params.push(filters.pipeline_id);
  }
  if (filters.current_stage_id) {
    where.push(`current_stage_id = $${i++}`);
    params.push(filters.current_stage_id);
  }
  if (filters.status) {
    where.push(`status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.contact_id) {
    where.push(`contact_id = $${i++}`);
    params.push(filters.contact_id);
  }
  if (filters.assigned_to) {
    where.push(`assigned_to = $${i++}`);
    params.push(filters.assigned_to);
  }
  if (scope === "own" && user_id) {
    where.push(`(assigned_to = $${i} OR created_by = $${i})`);
    params.push(user_id);
    i++;
  }
  if (filters.q) {
    where.push(`(title ILIKE $${i} OR deal_number ILIKE $${i})`);
    params.push(`%${filters.q}%`);
    i++;
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const run = ex(client);
  const { rows: c } = await run(
    `SELECT COUNT(*)::int AS total FROM ${t(brand, "crm_deals")} ${w}`,
    params,
  );
  const { rows } = await run(
    `SELECT * FROM ${t(brand, "crm_deals")} ${w} ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`,
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
async function findDealById({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_deals")} WHERE deal_id = $1 AND is_deleted = false`,
    [id],
  );
  return rows[0] || null;
}
async function createDeal({ client, brand, input, user_id }) {
  const deal_number = await nextDealNumber({ client, brand });
  const { f, ph, p } = ins(DEAL, input, { deal_number, created_by: user_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_deals")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateDeal({ client, brand, id, patch }) {
  const { f, p, next } = upd(DEAL, patch);
  if (!f.length) return findDealById({ client, brand, id });
  p.push(id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "crm_deals")} SET ${f.join(",")} WHERE deal_id = $${next} AND is_deleted = false RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function moveStage({ client, brand, id, stage_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "crm_deals")} SET current_stage_id = $2, stage_entered_at = now(), last_activity_at = now()
      WHERE deal_id = $1 AND is_deleted = false RETURNING *`,
    [id, stage_id],
  );
  return rows[0] || null;
}
async function setStatus({ client, brand, id, status, lost_reason }) {
  const col =
    status === "won"
      ? "won_at = now()"
      : status === "lost"
        ? "lost_at = now()"
        : "last_activity_at = now()";
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "crm_deals")} SET status = $2, ${col}, lost_reason = $3
      WHERE deal_id = $1 AND is_deleted = false RETURNING *`,
    [id, status, lost_reason || null],
  );
  return rows[0] || null;
}
async function softDeleteDeal({ client, brand, id }) {
  const { rowCount } = await ex(client)(
    `UPDATE ${t(brand, "crm_deals")} SET is_deleted = true, deleted_at = now() WHERE deal_id = $1 AND is_deleted = false`,
    [id],
  );
  return rowCount > 0;
}

// Activities + notes
async function listActivities({ client, brand, deal_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_activities")} WHERE deal_id = $1 ORDER BY performed_at DESC`,
    [deal_id],
  );
  return rows;
}
async function addActivity({ client, brand, input, user_id }) {
  const { f, ph, p } = ins(ACT, input, { performed_by: user_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_activities")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function listNotes({ client, brand, deal_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_notes")} WHERE deal_id = $1 ORDER BY is_pinned DESC, created_at DESC`,
    [deal_id],
  );
  return rows;
}
async function addNote({ client, brand, input, user_id }) {
  const { f, ph, p } = ins(NOTE, input, { created_by: user_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_notes")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}

// ── Customer preferences (1:1 with contact) ─────────────
const PREF_COLS = [
  "preferred_textures",
  "preferred_lace_types",
  "preferred_lengths_in",
  "preferred_colours",
  "preferred_densities",
  "preferred_cap_sizes",
  "avoid_textures",
  "avoid_colours",
  "use_cases",
  "budget_min_ngn",
  "budget_max_ngn",
  "styling_sensitivities",
  "source",
];
async function getPreferences({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "customer_preferences")} WHERE contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}
async function upsertPreferences({
  client,
  brand,
  contact_id,
  patch,
  user_id,
}) {
  const present = PREF_COLS.filter((c) => patch[c] !== undefined);
  const cols = ["contact_id", ...present, "updated_by"];
  const vals = [contact_id, ...present.map((c) => patch[c]), user_id || null];
  const ph = vals.map((_, idx) => `$${idx + 1}`);
  const setList = present
    .map((c) => `${c} = EXCLUDED.${c}`)
    .concat("updated_by = EXCLUDED.updated_by", "updated_at = now()")
    .join(", ");
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "customer_preferences")} (${cols.join(",")}) VALUES (${ph.join(",")})
     ON CONFLICT (contact_id) DO UPDATE SET ${setList} RETURNING *`,
    vals,
  );
  return rows[0];
}

// ── Customer measurements (1:many) ───────────────────────
const MEAS_COLS = [
  "circumference_cm",
  "ear_to_ear_cm",
  "forehead_to_nape_cm",
  "temple_to_temple_cm",
  "nape_width_cm",
  "natural_hair_type",
  "scalp_notes",
  "head_shape_notes",
  "photo_document_ids",
  "measured_by_stylist_id",
  "is_current",
  "notes",
];
async function listMeasurements({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "customer_measurements")} WHERE contact_id = $1 ORDER BY measured_at DESC`,
    [contact_id],
  );
  return rows;
}
async function getMeasurement({ client, brand, contact_id, measurement_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "customer_measurements")} WHERE measurement_id = $1 AND contact_id = $2`,
    [measurement_id, contact_id],
  );
  return rows[0] || null;
}
async function clearCurrentMeasurements({ client, brand, contact_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "customer_measurements")} SET is_current = false WHERE contact_id = $1 AND is_current = true`,
    [contact_id],
  );
}
async function addMeasurement({ client, brand, contact_id, input, user_id }) {
  const { f, ph, p } = ins(MEAS_COLS, input, {
    contact_id,
    measured_by: user_id,
  });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "customer_measurements")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateMeasurement({
  client,
  brand,
  contact_id,
  measurement_id,
  patch,
}) {
  const f = [],
    p = [];
  let i = 1;
  for (const c of MEAS_COLS) {
    if (patch[c] === undefined) continue;
    f.push(`${c} = $${i++}`);
    p.push(patch[c]);
  }
  if (!f.length)
    return getMeasurement({ client, brand, contact_id, measurement_id });
  p.push(measurement_id, contact_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "customer_measurements")} SET ${f.join(",")} WHERE measurement_id = $${i++} AND contact_id = $${i} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function deleteMeasurement({
  client,
  brand,
  contact_id,
  measurement_id,
}) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "customer_measurements")} WHERE measurement_id = $1 AND contact_id = $2`,
    [measurement_id, contact_id],
  );
  return rowCount > 0;
}

// ── Churn risk scores (computed; list + record) ──────────
async function listChurnScores({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "churn_risk_scores")} WHERE contact_id = $1 ORDER BY computed_at DESC`,
    [contact_id],
  );
  return rows;
}
async function recordChurnScore({ client, brand, input }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "churn_risk_scores")}
       (contact_id, risk_score, risk_band, reasons, days_since_last_order, lifetime_value_ngn, total_orders, average_days_between_orders)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      input.contact_id,
      input.risk_score,
      input.risk_band,
      input.reasons || [],
      input.days_since_last_order ?? null,
      input.lifetime_value_ngn ?? null,
      input.total_orders ?? null,
      input.average_days_between_orders ?? null,
    ],
  );
  return rows[0];
}

module.exports = {
  listPipelines,
  getPipeline,
  createPipeline,
  updatePipeline,
  archivePipeline,
  listStages,
  getStage,
  createStage,
  updateStage,
  deleteStage,
  findAllDeals,
  findDealById,
  createDeal,
  updateDeal,
  moveStage,
  setStatus,
  softDeleteDeal,
  listActivities,
  addActivity,
  listNotes,
  addNote,
  getPreferences,
  upsertPreferences,
  listMeasurements,
  getMeasurement,
  clearCurrentMeasurements,
  addMeasurement,
  updateMeasurement,
  deleteMeasurement,
  listChurnScores,
  recordChurnScore,
};
