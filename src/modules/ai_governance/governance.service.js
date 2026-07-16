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
const brandVoiceRepo = require("./brand-voice.repo");
const modelCatalogue = require("./model-catalogue.repo");
const crypto = require("../../services/encryption.service");
const { config } = require("../../config/env");
const { audit } = require("../../middleware/audit");
const { money } = require("../../utils/money");
const { NotFoundError } = require("../../utils/errors");

/**
 * Fallback vendor config from environment variables. A key set in .env is used
 * when a vendor row has no encrypted key stored via the AI Control UI, so
 * operators can configure keys either way. Only the api_key / endpoint / model
 * come from env; costs + caps still come from the DB row.
 */
function envVendor(vendor) {
  switch (vendor) {
    case "deepseek":
      return {
        api_key: config.DEEPSEEK_API_KEY,
        endpoint_url: config.DEEPSEEK_BASE_URL,
        default_model: config.DEEPSEEK_MODEL,
      };
    case "openai":
      return {
        api_key: config.OPENAI_API_KEY,
        endpoint_url: "https://api.openai.com/v1",
        default_model: config.OPENAI_EMBEDDING_MODEL,
      };
    case "groq":
      return {
        api_key: config.GROQ_API_KEY,
        endpoint_url: "https://api.groq.com/openai/v1",
        default_model: "whisper-large-v3",
      };
    case "gemini":
      return {
        api_key: config.GEMINI_API_KEY,
        endpoint_url: config.GEMINI_BASE_URL,
        default_model: config.GEMINI_MODEL,
      };
    default:
      return {};
  }
}

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
// Q8: per-brand toggle. Audit-logged so the "who turned it off, when"
// question always has an answer without a `git blame`.
async function setFlagBrandScope({
  user,
  request_id,
  feature_key,
  enabled_for_pxg,
  enabled_for_flh,
}) {
  const flag = await repo.setFlagBrandScope({
    feature_key,
    enabled_for_pxg,
    enabled_for_flh,
    user_id: user.user_id,
  });
  if (!flag) throw new NotFoundError("Feature flag");
  await A(
    user,
    "ai_governance.flag.brand_scope",
    "ai_feature_flag",
    flag.flag_id,
    { enabled_for_pxg, enabled_for_flh },
    request_id,
  );
  return flag;
}
async function setFlagUserCap({
  user,
  request_id,
  feature_key,
  daily_user_cap,
}) {
  const flag = await repo.setFlagUserCap({
    feature_key,
    daily_user_cap,
    user_id: user.user_id,
  });
  if (!flag) throw new NotFoundError("Feature flag");
  await A(
    user,
    "ai_governance.flag.user_cap",
    "ai_feature_flag",
    flag.flag_id,
    { daily_user_cap },
    request_id,
  );
  return flag;
}
async function setFlagRestingMessage({
  user,
  request_id,
  feature_key,
  resting_message,
}) {
  const flag = await repo.setFlagRestingMessage({
    feature_key,
    resting_message,
    user_id: user.user_id,
  });
  if (!flag) throw new NotFoundError("Feature flag");
  await A(
    user,
    "ai_governance.flag.resting_message",
    "ai_feature_flag",
    flag.flag_id,
    { has_message: !!resting_message },
    request_id,
  );
  return flag;
}

// ── Access grants ──────────────────────────────────────────
function listGrants(args) {
  return repo.listGrants(args);
}
function searchGrantUsers(args) {
  return repo.searchGrantUsers(args);
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
/**
 * Grant one user several AI features in one call — the "give this staff
 * member the whole AI" path on the AI Access screen. Unknown feature keys
 * are rejected up front (clearer than the FK error), each grant upserts
 * (re-granting un-revokes), and one audit row records the batch.
 */
async function grantBulk({ user, request_id, input }) {
  const flags = await repo.listFlags();
  const known = new Set(flags.map((f) => f.feature_key));
  const unknown = input.feature_keys.filter((k) => !known.has(k));
  if (unknown.length) {
    throw new NotFoundError(`Feature flag (${unknown.join(", ")})`);
  }
  const grants = [];
  for (const feature_key of input.feature_keys) {
    grants.push(
      await repo.grant({
        g: {
          user_id: input.user_id,
          feature_key,
          monthly_cap_ngn: input.monthly_cap_ngn,
        },
        granted_by: user.user_id,
      }),
    );
  }
  await A(
    user,
    "ai_governance.grant_bulk",
    "ai_access_grant",
    input.user_id,
    { user_id: input.user_id, feature_keys: input.feature_keys },
    request_id,
  );
  return grants;
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
async function listVendors() {
  const rows = await repo.listVendors();
  // Reflect an env-provided key/endpoint/model so a vendor configured purely
  // via .env still shows as ready (has_api_key) and surfaces its endpoint/model.
  return rows.map((r) => {
    const env = envVendor(r.vendor);
    return {
      ...r,
      has_api_key: r.has_api_key || Boolean(env.api_key),
      endpoint_url: r.endpoint_url ?? env.endpoint_url ?? null,
      default_model: r.default_model ?? env.default_model ?? null,
    };
  });
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
  // Prefer the encrypted key/endpoint/model stored via AI Control; fall back to
  // the .env values so a vendor configured only through the environment works.
  const env = envVendor(vendor);
  return {
    vendor: v.vendor,
    endpoint_url: v.endpoint_url || env.endpoint_url || null,
    default_model: v.default_model || env.default_model || null,
    api_key: v.api_key_enc ? crypto.decrypt(v.api_key_enc) : env.api_key || null,
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
  storefront_soft_cap_ngn,
  storefront_hard_cap_ngn,
}) {
  const p = await repo.setCaps({
    period_id,
    soft_cap_ngn,
    hard_cap_ngn,
    storefront_soft_cap_ngn,
    storefront_hard_cap_ngn,
  });
  if (!p) throw new NotFoundError("Budget period");
  await A(
    user,
    "ai_governance.budget.caps",
    "ai_budget_period",
    period_id,
    {
      soft_cap_ngn,
      hard_cap_ngn,
      storefront_soft_cap_ngn,
      storefront_hard_cap_ngn,
    },
    request_id,
  );
  return p;
}

// ── Runtime guards (called by the AI layer) ────────────────
/**
 * Whether the caller may use `feature_key` right now. The gate order is:
 *
 *   1. Feature flag globally enabled.
 *   2. Per-brand toggle for the calling brand (Q8) — a CEO can disable
 *      Praxis chat for pxg but keep it running for flh.
 *   3. Access grant (skipped for CEO). Public/storefront callers pass
 *      `is_ceo: true` so this is bypassed for them.
 *   4. Per-user daily cap (Q8). Only enforced for staff features
 *      (feature_scope='internal') with a set cap. Public storefront
 *      callers have user_id=null → they gate on Redis quotas instead.
 *   5. Budget cap (Q7 tiered). Internal features gate on the standard
 *      hard_cap_ngn. Storefront features gate on their SEPARATE
 *      storefront_hard_cap_ngn (NULL → uncapped, "revenue features
 *      die last"). Both use the ledger totals maintained by the
 *      trigger in 000310.
 *
 * On a block, returns `{ ok: false, reason, resting_message, feature_scope }`
 * so the caller can show the right copy — the storefront surfaces
 * resting_message to shoppers, staff features see the technical reason.
 */
async function canUseFeature({ user_id, feature_key, is_ceo, business }) {
  const flag = await repo.findFlag({ feature_key });
  if (!flag || !flag.is_enabled) {
    return {
      ok: false,
      reason: "FEATURE_DISABLED",
      resting_message: flag ? flag.resting_message : null,
      feature_scope: flag ? flag.feature_scope : "internal",
    };
  }
  // Per-brand toggle. Only enforced when the caller declares a brand;
  // internal admin surfaces without a brand context skip this check.
  if (business === "pixiegirl" && !flag.enabled_for_pxg) {
    return {
      ok: false,
      reason: "FEATURE_DISABLED_FOR_BRAND",
      resting_message: flag.resting_message,
      feature_scope: flag.feature_scope,
    };
  }
  if (business === "faitlynhair" && !flag.enabled_for_flh) {
    return {
      ok: false,
      reason: "FEATURE_DISABLED_FOR_BRAND",
      resting_message: flag.resting_message,
      feature_scope: flag.feature_scope,
    };
  }
  if (!is_ceo) {
    const granted = await repo.hasGrant({ user_id, feature_key });
    if (!granted) {
      return {
        ok: false,
        reason: "NO_ACCESS_GRANT",
        resting_message: flag.resting_message,
        feature_scope: flag.feature_scope,
      };
    }
  }
  // Per-user daily cap. Only for staff features with a cap set — public
  // storefront callers (user_id=null) skip this by design.
  if (
    user_id &&
    flag.daily_user_cap &&
    Number(flag.daily_user_cap) > 0 &&
    flag.feature_scope !== "storefront"
  ) {
    const used = await repo.userCallsToday({ user_id, feature_key });
    if (used >= Number(flag.daily_user_cap)) {
      return {
        ok: false,
        reason: "USER_DAILY_CAP",
        resting_message: flag.resting_message,
        feature_scope: flag.feature_scope,
        used_today: used,
        daily_user_cap: Number(flag.daily_user_cap),
      };
    }
  }
  // Budget cap — tiered by feature scope (Q7).
  const period = await repo.activePeriod({});
  if (period) {
    if (flag.feature_scope === "storefront") {
      // NULL storefront cap → uncapped, storefront never blocks on spend.
      // This is what makes revenue features die last: a Praxis training
      // spike drains the internal cap but the shop stays online.
      const cap = period.storefront_hard_cap_ngn;
      if (
        cap !== null &&
        cap !== undefined &&
        (period.storefront_hard_cap_breached_at ||
          money(period.storefront_actual_spend_ngn).gte(money(cap)))
      ) {
        return {
          ok: false,
          reason: "STOREFRONT_BUDGET_HARD_CAP",
          resting_message: flag.resting_message,
          feature_scope: flag.feature_scope,
        };
      }
    } else {
      // Internal features honour the original hard cap.
      if (
        period.hard_cap_breached_at ||
        money(period.actual_spend_ngn).gte(money(period.hard_cap_ngn))
      ) {
        return {
          ok: false,
          reason: "BUDGET_HARD_CAP",
          resting_message: flag.resting_message,
          feature_scope: flag.feature_scope,
        };
      }
    }
  }
  return {
    ok: true,
    reason: null,
    period_id: period ? period.period_id : null,
    feature_scope: flag.feature_scope,
    resting_message: flag.resting_message,
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
// Recent Chief-of-Staff turn traces (observability) — metadata only, surfaced
// in AI Control → Health & Logs. Read via the CoS trace repo (governance is the
// AI observability aggregator).
const cosTraceRepo = require("../chief_of_staff/cos.trace.repo");
function listCosTurnTraces(args) {
  return cosTraceRepo.listTraces(args);
}
async function spendMeter({ from, to, feature_key, vendor }) {
  const [daily, period] = await Promise.all([
    repo.usageDaily({ from, to, feature_key, vendor }),
    repo.activePeriod({}),
  ]);
  // Split the internal vs storefront view (Q7). The internal totals
  // are (all AI) − storefront, so an internal-cap breach reflects
  // what *staff* consumed, not what shoppers cost. The storefront
  // totals live in their own columns updated by the 000310 trigger.
  const internalSpend = period
    ? Number(period.actual_spend_ngn || 0) -
      Number(period.storefront_actual_spend_ngn || 0)
    : 0;
  const internalCalls = period
    ? Number(period.actual_calls_count || 0) -
      Number(period.storefront_actual_calls_count || 0)
    : 0;
  return {
    current_period: period
      ? {
          period_id: period.period_id,
          period_start: period.period_start,
          period_end: period.period_end,
          internal: {
            soft_cap_ngn: period.soft_cap_ngn,
            hard_cap_ngn: period.hard_cap_ngn,
            actual_spend_ngn: String(internalSpend.toFixed(2)),
            actual_calls_count: internalCalls,
            soft_cap_breached: !!period.soft_cap_breached_at,
            hard_cap_breached: !!period.hard_cap_breached_at,
          },
          storefront: {
            soft_cap_ngn: period.storefront_soft_cap_ngn,
            hard_cap_ngn: period.storefront_hard_cap_ngn,
            actual_spend_ngn: period.storefront_actual_spend_ngn,
            actual_calls_count: period.storefront_actual_calls_count,
            soft_cap_breached: !!period.storefront_soft_cap_breached_at,
            hard_cap_breached: !!period.storefront_hard_cap_breached_at,
          },
          // Retained for backwards-compat with existing callers.
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

// ── Brand Voice (per-brand Praxis personality) ──────────────
// Stored in shared.brand_voice_config (PR 1, migration 000213). The
// editor lives under AI Control; the data is read by smartcomm's
// Praxis-draft endpoint when generating replies.
async function getBrandVoice({ brand }) {
  return brandVoiceRepo.getByBrand({ brand });
}
async function upsertBrandVoice({ brand, user, request_id, input }) {
  const v = await brandVoiceRepo.upsert({
    brand,
    user_id: user.user_id,
    input,
  });
  await A(
    user,
    "ai_governance.brand_voice.upsert",
    "brand_voice_config",
    brand,
    {
      classify_inbound: v.classify_inbound,
      draft_on_tap: v.draft_on_tap,
    },
    request_id,
  );
  return v;
}

module.exports = {
  listFlags,
  upsertFlag,
  setFlagEnabled,
  setFlagBrandScope,
  setFlagUserCap,
  setFlagRestingMessage,
  listGrants,
  searchGrantUsers,
  grant,
  grantBulk,
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
  listCosTurnTraces,
  spendMeter,
  listActions,
  upsertAction,
  setActionEnabled,
  getBrandVoice,
  upsertBrandVoice,
  listModels,
  upsertModel,
  resolveActiveModel: (args) => modelCatalogue.resolveActiveModel(args),
};

// ── Model catalogue (PR 5) ─────────────────────────────────
// One row per (vendor, model_id) — cost per 1M tokens lives here so
// switching from gemini-2.5-flash → gemini-2.5-flash-lite is a click,
// not a redeploy.
function listModels({ vendor, capability, active_only }) {
  return modelCatalogue.list({ vendor, capability, active_only });
}
async function upsertModel({ user, request_id, input }) {
  const m = await modelCatalogue.upsert({ user_id: user.user_id, input });
  await A(
    user,
    "ai_governance.model.upsert",
    "ai_model_catalogue",
    m.model_id,
    { vendor: m.vendor, is_default: m.is_default },
    request_id,
  );
  return m;
}
