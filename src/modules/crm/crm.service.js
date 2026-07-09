/**
 * CRM (V2.2 §6.1) — business logic. Deals link contacts → sales; emits
 * `deal.won` so Sales can spin up an order. Stage moves are audited.
 */

"use strict";

const repo = require("./crm.repo");
const events = require("./crm.events");
const strategyEngine = require("../retention/strategy.engine");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
  before,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    before,
    after,
    request_id,
  });

// Pipelines + stages
async function listPipelines({ brand }) {
  const pipelines = await repo.listPipelines({ brand });
  for (const p of pipelines)
    p.stages = await repo.listStages({ brand, pipeline_id: p.pipeline_id });
  return pipelines;
}
async function createPipeline({ brand, user, request_id, input }) {
  const p = await repo.createPipeline({ brand, input });
  await A(
    brand,
    user.user_id,
    "crm.pipeline.create",
    "crm_pipeline",
    p.pipeline_id,
    p,
    request_id,
  );
  return p;
}
async function updatePipeline({ brand, user, request_id, id, patch }) {
  const before = await repo.getPipeline({ brand, id });
  if (!before) throw new NotFoundError("Pipeline");
  const p = await repo.updatePipeline({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "crm.pipeline.update",
    "crm_pipeline",
    id,
    p,
    request_id,
    before,
  );
  return p;
}
async function archivePipeline({ brand, user, request_id, id }) {
  const before = await repo.getPipeline({ brand, id });
  if (!before) throw new NotFoundError("Pipeline");
  await repo.archivePipeline({ brand, id });
  await A(
    brand,
    user.user_id,
    "crm.pipeline.archive",
    "crm_pipeline",
    id,
    null,
    request_id,
    before,
  );
}
const listStages = ({ brand, pipeline_id }) =>
  repo.listStages({ brand, pipeline_id });
async function createStage({ brand, user, request_id, pipeline_id, input }) {
  const p = await repo.getPipeline({ brand, id: pipeline_id });
  if (!p) throw new NotFoundError("Pipeline");
  const s = await repo.createStage({ brand, pipeline_id, input });
  await A(
    brand,
    user.user_id,
    "crm.stage.create",
    "crm_pipeline_stage",
    s.stage_id,
    s,
    request_id,
  );
  return s;
}
async function updateStage({ brand, user, request_id, stage_id, patch }) {
  const s = await repo.updateStage({ brand, stage_id, patch });
  if (!s) throw new NotFoundError("Stage");
  await A(
    brand,
    user.user_id,
    "crm.stage.update",
    "crm_pipeline_stage",
    stage_id,
    s,
    request_id,
  );
  return s;
}
async function deleteStage({ brand, user, request_id, stage_id }) {
  const ok = await repo.deleteStage({ brand, stage_id });
  if (!ok) throw new NotFoundError("Stage");
  await A(
    brand,
    user.user_id,
    "crm.stage.delete",
    "crm_pipeline_stage",
    stage_id,
    null,
    request_id,
  );
}

// Deals
function listDeals({ brand, scope, user, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.findAllDeals({
    brand,
    scope,
    user_id: user.user_id,
    filters,
    page,
    page_size,
    offset,
  });
}
async function getDeal({ brand, scope, user, id }) {
  const d = await repo.findDealById({ brand, id });
  if (!d) throw new NotFoundError("Deal");
  if (
    scope === "own" &&
    d.assigned_to !== user.user_id &&
    d.created_by !== user.user_id
  )
    throw new NotFoundError("Deal");
  d.activities = await repo.listActivities({ brand, deal_id: id });
  d.notes = await repo.listNotes({ brand, deal_id: id });
  d.products = await repo.listDealProducts({ brand, deal_id: id });
  return d;
}
async function createDeal({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const stage = await repo.getStage({
      client,
      brand,
      stage_id: input.current_stage_id,
    });
    if (!stage || stage.pipeline_id !== input.pipeline_id) {
      throw new AppError(
        "INVALID_VALUE",
        "current_stage_id does not belong to pipeline_id",
        400,
      );
    }
    const d = await repo.createDeal({
      client,
      brand,
      input,
      user_id: user.user_id,
    });
    // Append-only stage trail starts with the deal itself (from = none).
    await repo.addStageHistory({
      client,
      brand,
      deal_id: d.deal_id,
      from_stage_id: null,
      to_stage_id: d.current_stage_id,
      moved_by: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "crm.deal.create",
      "crm_deal",
      d.deal_id,
      d,
      request_id,
    );
    events.emit("deal.created", {
      brand,
      id: d.deal_id,
      contact_id: d.contact_id,
    });
    return d;
  });
}
async function updateDeal({ brand, user, request_id, id, patch }) {
  const before = await repo.findDealById({ brand, id });
  if (!before) throw new NotFoundError("Deal");
  const d = await repo.updateDeal({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "crm.deal.update",
    "crm_deal",
    id,
    d,
    request_id,
    before,
  );
  return d;
}
async function moveStage({ brand, user, request_id, id, stage_id }) {
  return transaction(async (client) => {
    const deal = await repo.findDealById({ client, brand, id });
    if (!deal) throw new NotFoundError("Deal");
    const stage = await repo.getStage({ client, brand, stage_id });
    if (!stage || stage.pipeline_id !== deal.pipeline_id) {
      throw new AppError(
        "INVALID_VALUE",
        "stage does not belong to this deal's pipeline",
        400,
      );
    }
    const d = await repo.moveStage({ client, brand, id, stage_id });
    const minutes = deal.stage_entered_at
      ? Math.max(
          0,
          Math.round(
            (Date.now() - new Date(deal.stage_entered_at).getTime()) / 60_000,
          ),
        )
      : null;
    await repo.addStageHistory({
      client,
      brand,
      deal_id: id,
      from_stage_id: deal.current_stage_id,
      to_stage_id: stage_id,
      moved_by: user.user_id,
      time_in_previous_stage_minutes: minutes,
    });
    await A(
      brand,
      user.user_id,
      "crm.deal.move_stage",
      "crm_deal",
      id,
      { from: deal.current_stage_id, to: stage_id },
      request_id,
    );
    events.emit("deal.stage_changed", { brand, id, stage_id });
    return d;
  });
}
async function setStatus({ brand, user, request_id, id, status, lost_reason }) {
  return transaction(async (client) => {
    const before = await repo.findDealById({ client, brand, id });
    if (!before) throw new NotFoundError("Deal");
    const d = await repo.setStatus({ client, brand, id, status, lost_reason });
    await A(
      brand,
      user.user_id,
      "crm.deal.set_status",
      "crm_deal",
      id,
      { status },
      request_id,
      { status: before.status },
    );
    // Cross-module hook: a won deal is the trigger for Sales to create an order.
    if (status === "won")
      events.emit("deal.won", {
        brand,
        id,
        contact_id: d.contact_id,
        expected_value_ngn: d.expected_value_ngn,
      });
    return d;
  });
}
async function deleteDeal({ brand, user, request_id, id }) {
  const ok = await repo.softDeleteDeal({ brand, id });
  if (!ok) throw new NotFoundError("Deal");
  await A(
    brand,
    user.user_id,
    "crm.deal.delete",
    "crm_deal",
    id,
    null,
    request_id,
  );
}

// Activities + notes (under a deal)
async function listActivities({ brand, id }) {
  await ensureDeal({ brand, id });
  return repo.listActivities({ brand, deal_id: id });
}
async function addActivity({ brand, user, request_id, id, input }) {
  await ensureDeal({ brand, id });
  const a = await repo.addActivity({
    brand,
    input: { ...input, deal_id: id },
    user_id: user.user_id,
  });
  events.emit("deal.activity", { brand, id });
  await A(
    brand,
    user.user_id,
    "crm.activity.create",
    "crm_deal",
    id,
    a,
    request_id,
  );
  return a;
}
async function listNotes({ brand, id }) {
  await ensureDeal({ brand, id });
  return repo.listNotes({ brand, deal_id: id });
}
async function addNote({ brand, user, request_id, id, input }) {
  await ensureDeal({ brand, id });
  const n = await repo.addNote({
    brand,
    input: { ...input, deal_id: id },
    user_id: user.user_id,
  });
  await A(
    brand,
    user.user_id,
    "crm.note.create",
    "crm_deal",
    id,
    n,
    request_id,
  );
  return n;
}
async function ensureDeal({ brand, id }) {
  const d = await repo.findDealById({ brand, id });
  if (!d) throw new NotFoundError("Deal");
  return d;
}

// Stage history (read side; writes happen in createDeal/moveStage)
async function listStageHistory({ brand, id }) {
  await ensureDeal({ brand, id });
  return repo.listStageHistory({ brand, deal_id: id });
}

// ── Deal products (anticipated line items) ────────────────
async function listDealProducts({ brand, id }) {
  await ensureDeal({ brand, id });
  return repo.listDealProducts({ brand, deal_id: id });
}
async function addDealProduct({ brand, user, request_id, id, input }) {
  await ensureDeal({ brand, id });
  const dp = await repo.addDealProduct({ brand, deal_id: id, input });
  await A(
    brand,
    user.user_id,
    "crm.deal_product.add",
    "crm_deal",
    id,
    dp,
    request_id,
  );
  return dp;
}
async function updateDealProduct({
  brand,
  user,
  request_id,
  id,
  deal_product_id,
  patch,
}) {
  await ensureDeal({ brand, id });
  const dp = await repo.updateDealProduct({
    brand,
    deal_id: id,
    deal_product_id,
    patch,
  });
  if (!dp) throw new NotFoundError("Deal product");
  await A(
    brand,
    user.user_id,
    "crm.deal_product.update",
    "crm_deal",
    id,
    dp,
    request_id,
  );
  return dp;
}
async function deleteDealProduct({
  brand,
  user,
  request_id,
  id,
  deal_product_id,
}) {
  await ensureDeal({ brand, id });
  const ok = await repo.deleteDealProduct({
    brand,
    deal_id: id,
    deal_product_id,
  });
  if (!ok) throw new NotFoundError("Deal product");
  await A(
    brand,
    user.user_id,
    "crm.deal_product.delete",
    "crm_deal",
    id,
    { deal_product_id },
    request_id,
  );
}

// ── Contact-level activities (log a call/WhatsApp/email on the 360) ──
async function ensureContact({ brand, contact_id }) {
  if (!(await repo.contactExists({ brand, contact_id })))
    throw new NotFoundError("Contact");
}
async function listContactActivities({ brand, contact_id }) {
  await ensureContact({ brand, contact_id });
  return repo.listContactActivities({ brand, contact_id });
}
async function addContactActivity({
  brand,
  user,
  request_id,
  contact_id,
  input,
}) {
  await ensureContact({ brand, contact_id });
  const a = await repo.addActivity({
    brand,
    input: { ...input, contact_id },
    user_id: user.user_id,
  });
  events.emit("contact.activity", { brand, contact_id });
  await A(
    brand,
    user.user_id,
    "crm.activity.create",
    "contact",
    contact_id,
    a,
    request_id,
  );
  return a;
}

// ── One-click win-back ────────────────────────────────────
// Enrols the contact into every ACTIVE retention strategy listening on the
// `win_back` trigger (Module 6.23). enrolled=0 means none is live — the UI
// should point the user at Retention → Strategies to activate one.
async function triggerWinBack({ brand, user, request_id, contact_id }) {
  await ensureContact({ brand, contact_id });
  const { enrolled } = await strategyEngine.trigger({
    brand,
    trigger_type: "win_back",
    contact_id,
    source_table: "crm_win_back",
    source_id: contact_id,
    event: { manual: true, triggered_by: user.user_id },
  });
  if (enrolled > 0) {
    await repo.stampChurnWorkflowTriggered({ brand, contact_id });
    await repo.addActivity({
      brand,
      input: {
        contact_id,
        activity_type: "system_note",
        direction: "internal",
        subject: "Win-back journey triggered",
        body: `Enrolled in ${enrolled} win-back ${enrolled === 1 ? "strategy" : "strategies"}.`,
      },
      user_id: user.user_id,
    });
  }
  await A(
    brand,
    user.user_id,
    "crm.winback.trigger",
    "contact",
    contact_id,
    { enrolled },
    request_id,
  );
  events.emit("churn.win_back_triggered", { brand, contact_id, enrolled });
  return { enrolled };
}

// ── Clients, Today buckets, reports (read-only aggregates) ──
function listClients({ brand, filters, sort, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.listClients({ brand, filters, sort, page, page_size, offset });
}
const todayBuckets = ({ brand, month, year }) =>
  repo.todayBuckets({ brand, month, year });
function reportLtv({ brand, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.reportLtv({ brand, page, page_size, offset });
}
const reportCohorts = ({ brand, months }) =>
  repo.reportCohorts({ brand, months });
const reportWinLoss = ({ brand, months }) =>
  repo.reportWinLoss({ brand, months });
const reportVelocity = ({ brand }) => repo.reportVelocity({ brand });
const reportForecast = ({ brand }) => repo.reportForecast({ brand });

// ── Customer profile: preferences / measurements / churn ──
async function getPreferences({ brand, contact_id }) {
  return (await repo.getPreferences({ brand, contact_id })) || { contact_id };
}
async function upsertPreferences({
  brand,
  user,
  request_id,
  contact_id,
  patch,
}) {
  const prefs = await repo.upsertPreferences({
    brand,
    contact_id,
    patch,
    user_id: user.user_id,
  });
  await A(
    brand,
    user.user_id,
    "crm.preferences.upsert",
    "customer_preferences",
    prefs.preference_id,
    prefs,
    request_id,
  );
  return prefs;
}
const listMeasurements = ({ brand, contact_id }) =>
  repo.listMeasurements({ brand, contact_id });
async function addMeasurement({ brand, user, request_id, contact_id, input }) {
  return transaction(async (client) => {
    if (input.is_current !== false)
      await repo.clearCurrentMeasurements({ client, brand, contact_id });
    const m = await repo.addMeasurement({
      client,
      brand,
      contact_id,
      input,
      user_id: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "crm.measurement.add",
      "customer_measurement",
      m.measurement_id,
      m,
      request_id,
    );
    return m;
  });
}
async function updateMeasurement({
  brand,
  user,
  request_id,
  contact_id,
  measurement_id,
  patch,
}) {
  return transaction(async (client) => {
    const before = await repo.getMeasurement({
      client,
      brand,
      contact_id,
      measurement_id,
    });
    if (!before) throw new NotFoundError("Measurement");
    if (patch.is_current === true)
      await repo.clearCurrentMeasurements({ client, brand, contact_id });
    const m = await repo.updateMeasurement({
      client,
      brand,
      contact_id,
      measurement_id,
      patch,
    });
    await A(
      brand,
      user.user_id,
      "crm.measurement.update",
      "customer_measurement",
      measurement_id,
      m,
      request_id,
      before,
    );
    return m;
  });
}
async function deleteMeasurement({
  brand,
  user,
  request_id,
  contact_id,
  measurement_id,
}) {
  const ok = await repo.deleteMeasurement({
    brand,
    contact_id,
    measurement_id,
  });
  if (!ok) throw new NotFoundError("Measurement");
  await A(
    brand,
    user.user_id,
    "crm.measurement.delete",
    "customer_measurement",
    measurement_id,
    null,
    request_id,
  );
}
const listChurnScores = ({ brand, contact_id }) =>
  repo.listChurnScores({ brand, contact_id });
async function recordChurnScore({
  brand,
  user,
  request_id,
  contact_id,
  input,
}) {
  const score = await repo.recordChurnScore({
    brand,
    input: { ...input, contact_id },
  });
  await A(
    brand,
    user.user_id,
    "crm.churn.record",
    "churn_risk_score",
    score.score_id,
    score,
    request_id,
  );
  if (score.risk_band === "high" || score.risk_band === "critical") {
    events.emit("churn.at_risk", {
      brand,
      contact_id,
      risk_band: score.risk_band,
    });
  }
  return score;
}

/** CRM dashboard KPIs (open pipeline, monthly wins, win rate). */
async function kpis({ brand, month, year }) {
  const k = await repo.kpis({ brand, month, year });
  const closed = Number(k.closed_total) || 0;
  return {
    open_deals: Number(k.open_deals),
    open_pipeline_ngn: String(k.open_pipeline_ngn),
    won_this_month: Number(k.won_this_month),
    won_value_this_month_ngn: String(k.won_value_this_month_ngn),
    win_rate:
      closed > 0 ? Number((Number(k.won_total) / closed).toFixed(4)) : null,
  };
}

module.exports = {
  kpis,
  listStageHistory,
  listDealProducts,
  addDealProduct,
  updateDealProduct,
  deleteDealProduct,
  listContactActivities,
  addContactActivity,
  triggerWinBack,
  listClients,
  todayBuckets,
  reportLtv,
  reportCohorts,
  reportWinLoss,
  reportVelocity,
  reportForecast,
  listPipelines,
  createPipeline,
  updatePipeline,
  archivePipeline,
  listStages,
  createStage,
  updateStage,
  deleteStage,
  listDeals,
  getDeal,
  createDeal,
  updateDeal,
  moveStage,
  setStatus,
  deleteDeal,
  listActivities,
  addActivity,
  listNotes,
  addNote,
  getPreferences,
  upsertPreferences,
  listMeasurements,
  addMeasurement,
  updateMeasurement,
  deleteMeasurement,
  listChurnScores,
  recordChurnScore,
};
