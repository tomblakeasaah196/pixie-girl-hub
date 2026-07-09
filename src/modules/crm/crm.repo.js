/**
 * CRM (V2.2 §6.1) — repository.
 * Tables (per-brand): crm_pipelines, crm_pipeline_stages, crm_deals,
 * crm_activities, crm_notes. deal_number via fn_next_document_number('crm_deal').
 */

"use strict";

const { ex, query } = require("../../config/database");
const { t } = require("../../config/brands");
const P = require("./crm.presets");
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

// ── Deal stage history (append-only; powers velocity analytics) ──
async function addStageHistory({
  client,
  brand,
  deal_id,
  from_stage_id,
  to_stage_id,
  moved_by,
  time_in_previous_stage_minutes,
  notes,
}) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_deal_stage_history")}
       (deal_id, from_stage_id, to_stage_id, moved_by, time_in_previous_stage_minutes, notes)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      deal_id,
      from_stage_id || null,
      to_stage_id,
      moved_by || null,
      time_in_previous_stage_minutes ?? null,
      notes || null,
    ],
  );
  return rows[0];
}
async function listStageHistory({ client, brand, deal_id }) {
  const { rows } = await ex(client)(
    `SELECT h.*, sf.display_name AS from_stage_name, st.display_name AS to_stage_name
       FROM ${t(brand, "crm_deal_stage_history")} h
       LEFT JOIN ${t(brand, "crm_pipeline_stages")} sf ON sf.stage_id = h.from_stage_id
       LEFT JOIN ${t(brand, "crm_pipeline_stages")} st ON st.stage_id = h.to_stage_id
      WHERE h.deal_id = $1 ORDER BY h.moved_at`,
    [deal_id],
  );
  return rows;
}

// ── Deal products (anticipated line items; forecasting) ──
const DEAL_PRODUCT = [
  "product_id",
  "variant_id",
  "custom_description",
  "quantity",
  "unit_price_ngn",
  "display_order",
];
async function listDealProducts({ client, brand, deal_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_deal_products")} WHERE deal_id = $1 ORDER BY display_order, deal_product_id`,
    [deal_id],
  );
  return rows;
}
async function getDealProduct({ client, brand, deal_id, deal_product_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_deal_products")} WHERE deal_product_id = $1 AND deal_id = $2`,
    [deal_product_id, deal_id],
  );
  return rows[0] || null;
}
async function addDealProduct({ client, brand, deal_id, input }) {
  const { f, ph, p } = ins(DEAL_PRODUCT, input, { deal_id });
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "crm_deal_products")} (${f.join(",")}) VALUES (${ph.join(",")}) RETURNING *`,
    p,
  );
  return rows[0];
}
async function updateDealProduct({
  client,
  brand,
  deal_id,
  deal_product_id,
  patch,
}) {
  const { f, p, next } = upd(DEAL_PRODUCT, patch);
  if (!f.length)
    return getDealProduct({ client, brand, deal_id, deal_product_id });
  p.push(deal_product_id, deal_id);
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "crm_deal_products")} SET ${f.join(",")}
      WHERE deal_product_id = $${next} AND deal_id = $${next + 1} RETURNING *`,
    p,
  );
  return rows[0] || null;
}
async function deleteDealProduct({ client, brand, deal_id, deal_product_id }) {
  const { rowCount } = await ex(client)(
    `DELETE FROM ${t(brand, "crm_deal_products")} WHERE deal_product_id = $1 AND deal_id = $2`,
    [deal_product_id, deal_id],
  );
  return rowCount > 0;
}

// ── Contact-level activities (calls/WhatsApp/emails on the 360) ──
async function contactExists({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM shared.contacts
      WHERE contact_id = $1 AND is_deleted = false
        AND ($2 = ANY(visible_to) OR visible_to = '{}')`,
    [contact_id, brand],
  );
  return rows.length > 0;
}
async function listContactActivities({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "crm_activities")} WHERE contact_id = $1 ORDER BY performed_at DESC`,
    [contact_id],
  );
  return rows;
}

/** Stamp the contact's current churn score when a win-back journey fires. */
async function stampChurnWorkflowTriggered({ client, brand, contact_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "churn_risk_scores")} SET workflow_triggered_at = now()
      WHERE contact_id = $1 AND superseded_at IS NULL AND workflow_triggered_at IS NULL`,
    [contact_id],
  );
}

// ── Clients (contacts + commercial roll-up) ──────────────
// The spend definition matches the contact-360 header (contacts.timeline.repo
// summary()): total_ngn over paid-ish orders, all orders counted for count.
const PAID_STATUSES = "('paid','awaiting_dispatch','completed')";

/** MMDD-window birthday clause with year-end wrap (same logic campaigns use). */
function birthdayClause(alias, idx) {
  return `(${alias}.date_of_birth IS NOT NULL AND (
      to_char(${alias}.date_of_birth,'MMDD')
        BETWEEN to_char(current_date,'MMDD')
            AND to_char(current_date + ($${idx} || ' days')::interval,'MMDD')
      OR (
        to_char(current_date,'MMDD') > to_char(current_date + ($${idx} || ' days')::interval,'MMDD')
        AND (to_char(${alias}.date_of_birth,'MMDD') >= to_char(current_date,'MMDD')
             OR to_char(${alias}.date_of_birth,'MMDD') <= to_char(current_date + ($${idx} || ' days')::interval,'MMDD'))
      )
    ))`;
}

const CLIENT_SORTS = {
  recent: "COALESCE(o.last_order_at, c.created_at) DESC",
  top_spend: "COALESCE(o.lifetime_spend_ngn, 0) DESC",
  newest: "c.created_at DESC",
  oldest: "c.created_at ASC", // "longest clients" — earliest on the books first
  name: "COALESCE(c.display_name, c.first_name) ASC",
};

async function listClients({
  brand,
  filters = {},
  sort = "recent",
  page = 1,
  page_size = 25,
  offset = 0,
}) {
  const params = [brand];
  const where = [
    "c.is_deleted = false",
    "'customer' = ANY(c.contact_type)",
    "($1 = ANY(c.visible_to) OR c.visible_to = '{}')",
  ];
  let i = 2;
  if (filters.q) {
    where.push(
      `(c.display_name ILIKE $${i} OR c.first_name ILIKE $${i} OR c.last_name ILIKE $${i}
        OR c.email ILIKE $${i} OR c.primary_phone ILIKE $${i})`,
    );
    params.push(`%${filters.q}%`);
    i++;
  }
  switch (filters.chip) {
    case "vip":
      where.push(`COALESCE(o.lifetime_spend_ngn, 0) >= ${P.VIP_SPEND_NGN}`);
      break;
    case "big_spender":
      where.push(
        `COALESCE(o.lifetime_spend_ngn, 0) >= ${P.BIG_SPENDER_SPEND_NGN}`,
      );
      break;
    case "new":
      where.push(`c.created_at >= now() - interval '${P.NEW_CLIENT_DAYS} days'`);
      break;
    case "win_back":
      where.push(
        `o.orders_count > 0 AND o.last_order_at < now() - interval '${P.WINBACK_LAPSED_DAYS} days'`,
      );
      break;
    case "birthdays_soon": {
      params.push(String(P.BIRTHDAY_SOON_DAYS));
      where.push(birthdayClause("c", i));
      i++;
      break;
    }
    default:
      break;
  }
  const from = `
    FROM shared.contacts c
    LEFT JOIN (
      SELECT contact_id,
             COUNT(*)::int AS orders_count,
             COALESCE(SUM(total_ngn) FILTER (WHERE status IN ${PAID_STATUSES}), 0) AS lifetime_spend_ngn,
             MAX(COALESCE(placed_at, created_at)) AS last_order_at
        FROM ${t(brand, "sales_orders")}
       WHERE contact_id IS NOT NULL
       GROUP BY contact_id
    ) o ON o.contact_id = c.contact_id`;
  const w = `WHERE ${where.join(" AND ")}`;
  const orderBy = CLIENT_SORTS[sort] || CLIENT_SORTS.recent;

  const { rows: cnt } = await query(
    `SELECT COUNT(*)::int AS total ${from} ${w}`,
    params,
  );
  const { rows } = await query(
    `SELECT c.contact_id, c.display_name, c.first_name, c.last_name, c.email,
            c.primary_phone, c.date_of_birth, c.source, c.priority_level, c.created_at,
            COALESCE(o.orders_count, 0) AS orders_count,
            COALESCE(o.lifetime_spend_ngn, 0) AS lifetime_spend_ngn,
            o.last_order_at,
            COALESCE(l.current_balance, 0) AS loyalty_points,
            ch.risk_score AS churn_risk_score,
            ch.risk_band AS churn_risk_band
       ${from}
       LEFT JOIN shared.customer_loyalty_state l
              ON l.contact_id = c.contact_id AND l.business = $1
       LEFT JOIN LATERAL (
         SELECT risk_score, risk_band FROM ${t(brand, "churn_risk_scores")} s
          WHERE s.contact_id = c.contact_id AND s.superseded_at IS NULL
          ORDER BY s.computed_at DESC LIMIT 1
       ) ch ON true
       ${w}
       ORDER BY ${orderBy} NULLS LAST
       LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: cnt[0].total,
      has_more: offset + rows.length < cnt[0].total,
    },
  };
}

/**
 * Resolve a (possibly partial/invalid) month+year query param pair into a
 * clamped calendar-month window. Defaults to the current month/year.
 */
function resolveMonth(month, year) {
  const now = new Date();
  const y = Number.isInteger(Number(year)) ? Number(year) : now.getFullYear();
  const mRaw = Number.isInteger(Number(month)) ? Number(month) : now.getMonth() + 1;
  const m = Math.min(12, Math.max(1, mRaw));
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return { month: m, year: y, start: start.toISOString(), end: end.toISOString() };
}

// ── Today buckets (who to reach out to) ──────────────────
async function todayBuckets({ brand, limit = 10, month, year }) {
  const visible = `c.is_deleted = false AND 'customer' = ANY(c.contact_type) AND ($1 = ANY(c.visible_to) OR c.visible_to = '{}')`;
  const { month: mm, start, end } = resolveMonth(month, year);

  // Birthday month — recurs every year, so only the month digit matters.
  const celebrate = await query(
    `SELECT c.contact_id, c.display_name, c.first_name, c.date_of_birth,
            COUNT(*) OVER ()::int AS total
       FROM shared.contacts c
      WHERE ${visible} AND c.date_of_birth IS NOT NULL
        AND EXTRACT(MONTH FROM c.date_of_birth) = $2
      ORDER BY EXTRACT(DAY FROM c.date_of_birth)
      LIMIT ${Number(limit)}`,
    [brand, mm],
  );

  const welcome = await query(
    `SELECT c.contact_id, c.display_name, c.first_name, c.source, c.created_at,
            COUNT(*) OVER ()::int AS total
       FROM shared.contacts c
      WHERE ${visible} AND c.created_at >= $2::timestamptz AND c.created_at < $3::timestamptz
      ORDER BY c.created_at DESC
      LIMIT ${Number(limit)}`,
    [brand, start, end],
  );

  // days_since_last_order is a snapshot taken at scoring time — approximate
  // the calendar month of that last order from it to apply the same filter.
  const winBack = await query(
    `SELECT c.contact_id, c.display_name, c.first_name,
            s.risk_score, s.risk_band, s.days_since_last_order, s.lifetime_value_ngn,
            COUNT(*) OVER ()::int AS total
       FROM ${t(brand, "churn_risk_scores")} s
       JOIN shared.contacts c ON c.contact_id = s.contact_id
      WHERE s.superseded_at IS NULL AND s.risk_band IN ('high','critical')
        AND ${visible}
        AND (s.computed_at::date - (COALESCE(s.days_since_last_order, 0) || ' days')::interval)
              >= $2::timestamptz
        AND (s.computed_at::date - (COALESCE(s.days_since_last_order, 0) || ' days')::interval)
              < $3::timestamptz
      ORDER BY s.risk_score DESC
      LIMIT ${Number(limit)}`,
    [brand, start, end],
  );

  const topMonth = await query(
    `SELECT o.contact_id, c.display_name, c.first_name,
            SUM(o.total_ngn) AS spend_this_month_ngn,
            COUNT(*)::int AS orders_this_month,
            COUNT(*) OVER ()::int AS total
       FROM ${t(brand, "sales_orders")} o
       JOIN shared.contacts c ON c.contact_id = o.contact_id
      WHERE o.status IN ${PAID_STATUSES}
        AND COALESCE(o.placed_at, o.created_at) >= $2::timestamptz
        AND COALESCE(o.placed_at, o.created_at) < $3::timestamptz
        AND ${visible}
      GROUP BY o.contact_id, c.display_name, c.first_name
      ORDER BY SUM(o.total_ngn) DESC
      LIMIT ${Number(limit)}`,
    [brand, start, end],
  );

  const followUps = await query(
    `SELECT d.deal_id, d.deal_number, d.title, d.contact_id, c.display_name,
            d.expected_value_ngn, COALESCE(d.last_activity_at, d.created_at) AS quiet_since,
            COUNT(*) OVER ()::int AS total
       FROM ${t(brand, "crm_deals")} d
       JOIN shared.contacts c ON c.contact_id = d.contact_id
      WHERE d.status = 'open' AND d.is_deleted = false
        AND COALESCE(d.last_activity_at, d.created_at) < now() - interval '${P.STALE_DEAL_DAYS} days'
        AND COALESCE(d.last_activity_at, d.created_at) >= $2::timestamptz
        AND COALESCE(d.last_activity_at, d.created_at) < $3::timestamptz
        AND ${visible}
      ORDER BY COALESCE(d.last_activity_at, d.created_at) ASC
      LIMIT ${Number(limit)}`,
    [brand, start, end],
  );

  // Checkout started (payment record created) but never completed — the
  // "clicked checkout, never paid" list. Leaves the list the moment status
  // moves off pending_payment.
  const pendingPayments = await query(
    `SELECT o.order_id, o.order_number, o.contact_id, c.display_name, c.first_name,
            o.total_ngn, o.sales_channel, COALESCE(o.placed_at, o.created_at) AS pending_since,
            COUNT(*) OVER ()::int AS total
       FROM ${t(brand, "sales_orders")} o
       JOIN shared.contacts c ON c.contact_id = o.contact_id
      WHERE o.status = 'pending_payment'
        AND COALESCE(o.placed_at, o.created_at) >= $2::timestamptz
        AND COALESCE(o.placed_at, o.created_at) < $3::timestamptz
        AND ${visible}
      ORDER BY COALESCE(o.placed_at, o.created_at) ASC
      LIMIT ${Number(limit)}`,
    [brand, start, end],
  );

  // Open deals expected to close within the selected month.
  const closingSoon = await query(
    `SELECT d.deal_id, d.deal_number, d.title, d.contact_id, c.display_name,
            d.expected_value_ngn, d.expected_close_date,
            COUNT(*) OVER ()::int AS total
       FROM ${t(brand, "crm_deals")} d
       JOIN shared.contacts c ON c.contact_id = d.contact_id
      WHERE d.status = 'open' AND d.is_deleted = false
        AND d.expected_close_date >= $2::date AND d.expected_close_date < $3::date
        AND ${visible}
      ORDER BY d.expected_close_date ASC
      LIMIT ${Number(limit)}`,
    [brand, start, end],
  );

  // All-time — deliberately not month-scoped.
  const topAllTime = await query(
    `SELECT c.contact_id, c.display_name, c.first_name,
            SUM(o.total_ngn) AS lifetime_spend_ngn,
            COUNT(*)::int AS orders_count,
            COUNT(*) OVER ()::int AS total
       FROM ${t(brand, "sales_orders")} o
       JOIN shared.contacts c ON c.contact_id = o.contact_id
      WHERE o.status IN ${PAID_STATUSES} AND ${visible}
      GROUP BY c.contact_id, c.display_name, c.first_name
      ORDER BY SUM(o.total_ngn) DESC
      LIMIT ${Number(limit)}`,
    [brand],
  );

  const bucket = (res) => ({
    total: res.rows[0] ? res.rows[0].total : 0,
    items: res.rows.map(({ total: _total, ...r }) => r),
  });
  return {
    to_celebrate: bucket(celebrate),
    to_welcome: bucket(welcome),
    to_win_back: bucket(winBack),
    top_this_month: bucket(topMonth),
    follow_ups: bucket(followUps),
    pending_payments: bucket(pendingPayments),
    closing_soon: bucket(closingSoon),
    top_customers_all_time: bucket(topAllTime),
  };
}

// ── Reports ──────────────────────────────────────────────
async function reportLtv({ brand, page = 1, page_size = 25, offset = 0 }) {
  const { rows: cnt } = await query(
    `SELECT COUNT(DISTINCT o.contact_id)::int AS total
       FROM ${t(brand, "sales_orders")} o
       JOIN shared.contacts c ON c.contact_id = o.contact_id
      WHERE c.is_deleted = false AND 'customer' = ANY(c.contact_type)
        AND o.status IN ${PAID_STATUSES}`,
  );
  const { rows } = await query(
    `SELECT c.contact_id, c.display_name, c.first_name, c.email, c.primary_phone,
            COUNT(*)::int AS orders_count,
            SUM(o.total_ngn) AS lifetime_spend_ngn,
            ROUND(AVG(o.total_ngn), 2) AS avg_order_value_ngn,
            MIN(COALESCE(o.placed_at, o.created_at)) AS first_order_at,
            MAX(COALESCE(o.placed_at, o.created_at)) AS last_order_at
       FROM ${t(brand, "sales_orders")} o
       JOIN shared.contacts c ON c.contact_id = o.contact_id
      WHERE c.is_deleted = false AND 'customer' = ANY(c.contact_type)
        AND o.status IN ${PAID_STATUSES}
      GROUP BY c.contact_id, c.display_name, c.first_name, c.email, c.primary_phone
      ORDER BY SUM(o.total_ngn) DESC
      LIMIT $1 OFFSET $2`,
    [page_size, offset],
  );
  return {
    data: rows,
    meta: {
      page,
      page_size,
      total: cnt[0].total,
      has_more: offset + rows.length < cnt[0].total,
    },
  };
}

async function reportCohorts({ brand, months = 12 }) {
  const m = Math.min(Math.max(Number(months) || 12, 3), 24);
  const { rows } = await query(
    `WITH firsts AS (
       SELECT contact_id, date_trunc('month', MIN(COALESCE(placed_at, created_at))) AS cohort_month
         FROM ${t(brand, "sales_orders")}
        WHERE contact_id IS NOT NULL AND status IN ${PAID_STATUSES}
        GROUP BY contact_id
     ),
     activity AS (
       SELECT DISTINCT o.contact_id, f.cohort_month,
              ((EXTRACT(YEAR FROM date_trunc('month', COALESCE(o.placed_at, o.created_at)))
                - EXTRACT(YEAR FROM f.cohort_month)) * 12
             + (EXTRACT(MONTH FROM date_trunc('month', COALESCE(o.placed_at, o.created_at)))
                - EXTRACT(MONTH FROM f.cohort_month)))::int AS month_offset
         FROM ${t(brand, "sales_orders")} o
         JOIN firsts f ON f.contact_id = o.contact_id
        WHERE o.status IN ${PAID_STATUSES}
     )
     SELECT cohort_month, month_offset, COUNT(*)::int AS active_customers
       FROM activity
      WHERE cohort_month >= date_trunc('month', now()) - interval '${m - 1} months'
      GROUP BY cohort_month, month_offset
      ORDER BY cohort_month, month_offset`,
  );
  return rows;
}

async function reportWinLoss({ brand, months = 12 }) {
  const m = Math.min(Math.max(Number(months) || 12, 3), 24);
  const since = `now() - interval '${m} months'`;
  const { rows: monthly } = await query(
    `SELECT date_trunc('month', COALESCE(won_at, lost_at)) AS month,
            COUNT(*) FILTER (WHERE status = 'won')::int AS won,
            COUNT(*) FILTER (WHERE status = 'lost')::int AS lost,
            COALESCE(SUM(expected_value_ngn) FILTER (WHERE status = 'won'), 0) AS won_value_ngn,
            COALESCE(SUM(expected_value_ngn) FILTER (WHERE status = 'lost'), 0) AS lost_value_ngn
       FROM ${t(brand, "crm_deals")}
      WHERE is_deleted = false AND status IN ('won','lost')
        AND COALESCE(won_at, lost_at) >= ${since}
      GROUP BY 1 ORDER BY 1`,
  );
  const { rows: reasons } = await query(
    `SELECT COALESCE(NULLIF(TRIM(lost_reason), ''), '(no reason recorded)') AS reason,
            COUNT(*)::int AS deals,
            COALESCE(SUM(expected_value_ngn), 0) AS value_ngn
       FROM ${t(brand, "crm_deals")}
      WHERE is_deleted = false AND status = 'lost' AND lost_at >= ${since}
      GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
  );
  const { rows: byPipeline } = await query(
    `SELECT p.pipeline_id, p.display_name,
            COUNT(*) FILTER (WHERE d.status = 'won')::int AS won,
            COUNT(*) FILTER (WHERE d.status = 'lost')::int AS lost
       FROM ${t(brand, "crm_deals")} d
       JOIN ${t(brand, "crm_pipelines")} p ON p.pipeline_id = d.pipeline_id
      WHERE d.is_deleted = false AND d.status IN ('won','lost')
        AND COALESCE(d.won_at, d.lost_at) >= ${since}
      GROUP BY p.pipeline_id, p.display_name ORDER BY p.display_name`,
  );
  return { monthly, lost_reasons: reasons, by_pipeline: byPipeline };
}

async function reportVelocity({ brand }) {
  const { rows: stages } = await query(
    `SELECT s.stage_id, s.stage_key, s.display_name, s.display_order,
            p.pipeline_id, p.display_name AS pipeline_name,
            COUNT(*)::int AS moves,
            ROUND(AVG(h.time_in_previous_stage_minutes) / 1440.0, 1) AS avg_days_in_stage,
            ROUND((percentile_cont(0.5) WITHIN GROUP
              (ORDER BY h.time_in_previous_stage_minutes) / 1440.0)::numeric, 1)
              AS median_days_in_stage
       FROM ${t(brand, "crm_deal_stage_history")} h
       JOIN ${t(brand, "crm_pipeline_stages")} s ON s.stage_id = h.from_stage_id
       JOIN ${t(brand, "crm_pipelines")} p ON p.pipeline_id = s.pipeline_id
      WHERE h.time_in_previous_stage_minutes IS NOT NULL
      GROUP BY s.stage_id, s.stage_key, s.display_name, s.display_order,
               p.pipeline_id, p.display_name
      ORDER BY p.display_name, s.display_order`,
  );
  const { rows: close } = await query(
    `SELECT COUNT(*)::int AS won_deals,
            ROUND(AVG(EXTRACT(EPOCH FROM (won_at - created_at)) / 86400.0)::numeric, 1)
              AS avg_days_to_win
       FROM ${t(brand, "crm_deals")}
      WHERE is_deleted = false AND status = 'won' AND won_at IS NOT NULL`,
  );
  return { stages, close: close[0] };
}

async function reportForecast({ brand }) {
  const { rows: open } = await query(
    `SELECT COALESCE(date_trunc('month', d.expected_close_date), NULL) AS month,
            COUNT(*)::int AS deals,
            COALESCE(SUM(d.expected_value_ngn), 0) AS pipeline_value_ngn,
            COALESCE(SUM(d.expected_value_ngn * s.win_probability_pct / 100.0), 0)
              AS weighted_value_ngn
       FROM ${t(brand, "crm_deals")} d
       JOIN ${t(brand, "crm_pipeline_stages")} s ON s.stage_id = d.current_stage_id
      WHERE d.is_deleted = false AND d.status = 'open'
      GROUP BY 1 ORDER BY 1 NULLS LAST`,
  );
  const { rows: actual } = await query(
    `SELECT date_trunc('month', won_at) AS month,
            COUNT(*)::int AS deals,
            COALESCE(SUM(expected_value_ngn), 0) AS won_value_ngn
       FROM ${t(brand, "crm_deals")}
      WHERE is_deleted = false AND status = 'won'
        AND won_at >= now() - interval '6 months'
      GROUP BY 1 ORDER BY 1`,
  );
  return { open_by_month: open, won_by_month: actual };
}

/** Dashboard KPIs: open pipeline, wins this month, win/closed totals. */
async function kpis({ brand, client, month, year }) {
  const { start, end } = resolveMonth(month, year);
  const { rows } = await ex(client)(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'open')::int AS open_deals,
       COALESCE(SUM(expected_value_ngn) FILTER (WHERE status = 'open'), 0)
         AS open_pipeline_ngn,
       COUNT(*) FILTER (WHERE status = 'won'
         AND won_at >= $1::timestamptz AND won_at < $2::timestamptz)::int AS won_this_month,
       COALESCE(SUM(expected_value_ngn) FILTER (WHERE status = 'won'
         AND won_at >= $1::timestamptz AND won_at < $2::timestamptz), 0)
         AS won_value_this_month_ngn,
       COUNT(*) FILTER (WHERE status = 'won')::int AS won_total,
       COUNT(*) FILTER (WHERE status IN ('won', 'lost'))::int AS closed_total
     FROM ${t(brand, "crm_deals")}
     WHERE is_deleted = false`,
    [start, end],
  );
  return rows[0];
}

module.exports = {
  kpis,
  addStageHistory,
  listStageHistory,
  listDealProducts,
  getDealProduct,
  addDealProduct,
  updateDealProduct,
  deleteDealProduct,
  contactExists,
  listContactActivities,
  stampChurnWorkflowTriggered,
  listClients,
  todayBuckets,
  reportLtv,
  reportCohorts,
  reportWinLoss,
  reportVelocity,
  reportForecast,
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
