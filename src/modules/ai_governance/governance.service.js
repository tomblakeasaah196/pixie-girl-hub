/**
 * AI Governance (V2.2 §6.31 / §8.1) — business logic. The "AI Control" admin
 * surface plus the runtime guards the rest of the AI subsystem calls:
 *   - canUseFeature(user, feature) — flag enabled + access grant + budget OK
 *   - getVendorConfig(vendor)      — decrypted creds for the AI layer (internal)
 *   - recordUsage(...)             — append the per-call ledger row (the hook
 *     every Praxis/Insights call writes through; trigger rolls up budget+daily)
 */

"use strict";

const repo = require("./governance.repo");
const crypto = require("../../services/encryption.service");
const { audit } = require("../../middleware/audit");
const { money } = require("../../utils/money");
const { NotFoundError } = require("../../utils/errors");

const A = (user, action_key, target_type, target_id, after, request_id) =>
  audit({
    business: null,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// ── Feature flags ──────────────────────────────────────────
function listFlags() {
  return repo.listFlags();
}
async function upsertFlag({ user, request_id, input }) {
  const flag = await repo.upsertFlag({ flag: input, user_id: user.user_id });
  await A(
    user,
    "ai_governance.flag.upsert",
    "ai_feature_flag",
    flag.flag_id,
    { feature_key: flag.feature_key },
    request_id,
  );
  return flag;
}
async function setFlagEnabled({ user, request_id, feature_key, is_enabled }) {
  const flag = await repo.setFlagEnabled({
    feature_key,
    is_enabled,
    user_id: user.user_id,
  });
  if (!flag) throw new NotFoundError("Feature flag");
  await A(
    user,
    "ai_governance.flag.toggle",
    "ai_feature_flag",
    flag.flag_id,
    { is_enabled },
    request_id,
  );
  return flag;
}

// ── Access grants ──────────────────────────────────────────
function listGrants(args) {
  return repo.listGrants(args);
}
async function grant({ user, request_id, input }) {
  const g = await repo.grant({ g: input, granted_by: user.user_id });
  await A(
    user,
    "ai_governance.grant",
    "ai_access_grant",
    g.grant_id,
    { user_id: input.user_id, feature_key: input.feature_key },
    request_id,
  );
  return g;
}
async function revokeGrant({ user, request_id, grant_id, reason }) {
  const ok = await repo.revokeGrant({ grant_id, reason });
  if (!ok) throw new NotFoundError("Access grant");
  await A(
    user,
    "ai_governance.revoke",
    "ai_access_grant",
    grant_id,
    { reason },
    request_id,
  );
}

// ── Vendor credentials ─────────────────────────────────────
function listVendors() {
  return repo.listVendors();
}
async function upsertVendor({ user, request_id, input }) {
  const v = { ...input };
  if (input.api_key) v.api_key_enc = crypto.encrypt(input.api_key);
  if (input.org_id) v.org_id_enc = crypto.encrypt(input.org_id);
  delete v.api_key;
  delete v.org_id;
  const saved = await repo.upsertVendor({ v });
  await A(
    user,
    "ai_governance.vendor.upsert",
    "ai_vendor_credential",
    saved.credential_id,
    { vendor: saved.vendor },
    request_id,
  );
  return saved;
}
async function rotateVendorKey({ user, request_id, vendor, api_key }) {
  const saved = await repo.rotateVendorKey({
    vendor,
    api_key_enc: crypto.encrypt(api_key),
    user_id: user.user_id,
  });
  if (!saved) throw new NotFoundError("Vendor");
  await A(
    user,
    "ai_governance.vendor.rotate",
    "ai_vendor_credential",
    saved.credential_id,
    { vendor },
    request_id,
  );
  return saved;
}
async function setVendorActive({ user, request_id, vendor, is_active }) {
  const saved = await repo.setVendorActive({ vendor, is_active });
  if (!saved) throw new NotFoundError("Vendor");
  await A(
    user,
    "ai_governance.vendor.active",
    "ai_vendor_credential",
    saved.credential_id,
    { is_active },
    request_id,
  );
  return saved;
}
/** INTERNAL (AI layer only): decrypted vendor config. Never exposed via HTTP. */
async function getVendorConfig({ vendor }) {
  const v = await repo.getVendorRaw({ vendor });
  if (!v || !v.is_active) return null;
  return {
    vendor: v.vendor,
    endpoint_url: v.endpoint_url,
    default_model: v.default_model,
    api_key: v.api_key_enc ? crypto.decrypt(v.api_key_enc) : null,
    org_id: v.org_id_enc ? crypto.decrypt(v.org_id_enc) : null,
    cost_per_1k_input_tokens: v.cost_per_1k_input_tokens,
    cost_per_1k_output_tokens: v.cost_per_1k_output_tokens,
    cost_per_audio_minute: v.cost_per_audio_minute,
  };
}

// ── Budget periods ─────────────────────────────────────────
function getActivePeriod() {
  return repo.activePeriod({});
}
function listPeriods() {
  return repo.listPeriods();
}
async function openPeriod({ user, request_id, input }) {
  const p = await repo.createPeriod({ p: input, user_id: user.user_id });
  await A(
    user,
    "ai_governance.budget.open",
    "ai_budget_period",
    p.period_id,
    { period_start: p.period_start },
    request_id,
  );
  return p;
}
async function setCaps({
  user,
  request_id,
  period_id,
  soft_cap_ngn,
  hard_cap_ngn,
}) {
  const p = await repo.setCaps({ period_id, soft_cap_ngn, hard_cap_ngn });
  if (!p) throw new NotFoundError("Budget period");
  await A(
    user,
    "ai_governance.budget.caps",
    "ai_budget_period",
    period_id,
    { soft_cap_ngn, hard_cap_ngn },
    request_id,
  );
  return p;
}

// ── Runtime guards (called by the AI layer) ────────────────
/**
 * Whether `user` may use `feature_key` right now: the flag is enabled, the
 * user has an active grant, and the active budget period hasn't hit its hard
 * cap. Returns { ok, reason }.
 */
async function canUseFeature({ user_id, feature_key, is_ceo }) {
  const flag = await repo.findFlag({ feature_key });
  if (!flag || !flag.is_enabled)
    return { ok: false, reason: "FEATURE_DISABLED" };
  if (!is_ceo) {
    const granted = await repo.hasGrant({ user_id, feature_key });
    if (!granted) return { ok: false, reason: "NO_ACCESS_GRANT" };
  }
  const period = await repo.activePeriod({});
  if (period && period.hard_cap_breached_at)
    return { ok: false, reason: "BUDGET_HARD_CAP" };
  if (period && money(period.actual_spend_ngn).gte(money(period.hard_cap_ngn)))
    return { ok: false, reason: "BUDGET_HARD_CAP" };
  return {
    ok: true,
    reason: null,
    period_id: period ? period.period_id : null,
  };
}
/** Append a usage row (trigger updates budget period + daily rollup). */
async function recordUsage({ usage }) {
  const period = await repo.activePeriod({});
  return repo.recordUsage({
    u: {
      ...usage,
      period_id: usage.period_id || (period ? period.period_id : null),
    },
  });
}

// ── Usage meter (reads) ────────────────────────────────────
function listUsage(args) {
  return repo.listUsage(args);
}
async function spendMeter({ from, to, feature_key, vendor }) {
  const [daily, period] = await Promise.all([
    repo.usageDaily({ from, to, feature_key, vendor }),
    repo.activePeriod({}),
  ]);
  return {
    current_period: period
      ? {
          period_start: period.period_start,
          period_end: period.period_end,
          soft_cap_ngn: period.soft_cap_ngn,
          hard_cap_ngn: period.hard_cap_ngn,
          actual_spend_ngn: period.actual_spend_ngn,
          actual_calls_count: period.actual_calls_count,
          soft_cap_breached: !!period.soft_cap_breached_at,
          hard_cap_breached: !!period.hard_cap_breached_at,
        }
      : null,
    daily,
  };
}

// ── Action catalogue ───────────────────────────────────────
function listActions(args) {
  return repo.listActions(args);
}
async function upsertAction({ user, request_id, input }) {
  const a = await repo.upsertAction({ a: input });
  await A(
    user,
    "ai_governance.action.upsert",
    "ai_action",
    a.action_id,
    { action_key: a.action_key },
    request_id,
  );
  return a;
}
async function setActionEnabled({ user, request_id, action_key, ai_enabled }) {
  const a = await repo.setActionEnabled({ action_key, ai_enabled });
  if (!a) throw new NotFoundError("Action");
  await A(
    user,
    "ai_governance.action.toggle",
    "ai_action",
    a.action_id,
    { ai_enabled },
    request_id,
  );
  return a;
}

module.exports = {
  listFlags,
  upsertFlag,
  setFlagEnabled,
  listGrants,
  grant,
  revokeGrant,
  listVendors,
  upsertVendor,
  rotateVendorKey,
  setVendorActive,
  getVendorConfig,
  getActivePeriod,
  listPeriods,
  openPeriod,
  setCaps,
  canUseFeature,
  recordUsage,
  listUsage,
  spendMeter,
  listActions,
  upsertAction,
  setActionEnabled,
};
