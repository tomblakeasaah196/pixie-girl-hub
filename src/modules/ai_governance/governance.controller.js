/**
 * AI Governance (V2.2 §6.31) — HTTP controller (the "AI Control" surface).
 */

"use strict";

const service = require("./governance.service");
const health = require("./health.service");
const healthRepo = require("./health.repo");
const gemini = require("../../services/gemini.service");

const base = (req) => ({ user: req.user, request_id: req.request_id });

// Flags
async function listFlags(req, res) {
  res.json({ data: await service.listFlags() });
}
async function upsertFlag(req, res) {
  res.status(201).json({
    data: await service.upsertFlag({ ...base(req), input: req.body }),
  });
}
async function toggleFlag(req, res) {
  res.json({
    data: await service.setFlagEnabled({
      ...base(req),
      feature_key: req.params.feature_key,
      is_enabled: req.body.is_enabled,
    }),
  });
}

// Grants
async function listGrants(req, res) {
  res.json({
    data: await service.listGrants({
      user_id: req.query.user_id,
      feature_key: req.query.feature_key,
    }),
  });
}
async function grant(req, res) {
  res
    .status(201)
    .json({ data: await service.grant({ ...base(req), input: req.body }) });
}
async function revokeGrant(req, res) {
  await service.revokeGrant({
    ...base(req),
    grant_id: req.params.grant_id,
    reason: req.body.reason,
  });
  res.status(204).end();
}

// Vendors
async function listVendors(req, res) {
  res.json({ data: await service.listVendors() });
}
async function upsertVendor(req, res) {
  res.status(201).json({
    data: await service.upsertVendor({ ...base(req), input: req.body }),
  });
}
async function rotateVendor(req, res) {
  res.json({
    data: await service.rotateVendorKey({
      ...base(req),
      vendor: req.params.vendor,
      api_key: req.body.api_key,
    }),
  });
}
async function setVendorActive(req, res) {
  res.json({
    data: await service.setVendorActive({
      ...base(req),
      vendor: req.params.vendor,
      is_active: req.body.is_active,
    }),
  });
}

// Budget
async function activeBudget(req, res) {
  res.json({ data: await service.getActivePeriod() });
}
async function listBudgets(req, res) {
  res.json({ data: await service.listPeriods() });
}
async function openBudget(req, res) {
  res.status(201).json({
    data: await service.openPeriod({ ...base(req), input: req.body }),
  });
}
async function setBudgetCaps(req, res) {
  res.json({
    data: await service.setCaps({
      ...base(req),
      period_id: req.params.period_id,
      soft_cap_ngn: req.body.soft_cap_ngn,
      hard_cap_ngn: req.body.hard_cap_ngn,
    }),
  });
}

// Usage
async function listUsage(req, res) {
  res.json({
    data: await service.listUsage({
      feature_key: req.query.feature_key,
      user_id: req.query.user_id,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}
async function spendMeter(req, res) {
  res.json({
    data: await service.spendMeter({
      from: req.query.from,
      to: req.query.to,
      feature_key: req.query.feature_key,
      vendor: req.query.vendor,
    }),
  });
}

// Action catalogue
async function listActions(req, res) {
  res.json({
    data: await service.listActions({
      module: req.query.module,
      category: req.query.category,
      ai_enabled:
        req.query.ai_enabled === undefined
          ? undefined
          : req.query.ai_enabled === "true",
      is_write:
        req.query.is_write === undefined
          ? undefined
          : req.query.is_write === "true",
    }),
  });
}
async function upsertAction(req, res) {
  res.status(201).json({
    data: await service.upsertAction({ ...base(req), input: req.body }),
  });
}
async function toggleAction(req, res) {
  res.json({
    data: await service.setActionEnabled({
      ...base(req),
      action_key: req.params.action_key,
      ai_enabled: req.body.ai_enabled,
    }),
  });
}

async function listModels(req, res) {
  res.json({
    data: await service.listModels({
      vendor: req.query.vendor,
      capability: req.query.capability,
      active_only: req.query.include_inactive !== "true",
    }),
  });
}
async function upsertModel(req, res) {
  res.status(201).json({
    data: await service.upsertModel({
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

// ── Test connection (Q2) ───────────────────────────────────
// Body may include an api_key/endpoint_url/model override so the admin
// can Test-then-Save without committing the new value first — but only
// the CEO+ai_governance.edit role can even reach this route.
async function testVendor(req, res) {
  const vendor = req.params.vendor;
  const started = Date.now();
  // If overrides were supplied we do a one-shot ping using those values;
  // otherwise the persisted vendor row (or .env fallback) is used.
  const override =
    req.body && (req.body.api_key || req.body.endpoint_url || req.body.model)
      ? {
          api_key: (req.body.api_key || "").trim() || null,
          endpoint_url: (req.body.endpoint_url || "").trim() || null,
          model: (req.body.model || "").trim() || null,
        }
      : null;
  let result;
  try {
    if (override && vendor === "gemini") {
      // Ad-hoc gemini ping bypassing the saved row.
      const v = {
        source: "override",
        vendor: "gemini",
        api_key: override.api_key,
        endpoint_url: override.endpoint_url || gemini.DEFAULT_BASE_URL,
        default_model: override.model || gemini.DEFAULT_MODEL,
      };
      const completion = await gemini.chatCompletion({
        vendor: v,
        messages: [{ role: "user", content: "hi" }],
        maxOutputTokens: 8,
        thinkingBudget: 0,
        timeoutMs: 15000,
      });
      result = {
        ok: true,
        latency_ms: completion.latency_ms,
        http_status: 200,
      };
    } else {
      result = await health.pingVendor({
        vendor,
        source: "manual",
        checked_by: req.user?.user_id || null,
      });
    }
  } catch (err) {
    result = {
      ok: false,
      latency_ms: Date.now() - started,
      error_code: err.code || "PING_FAILED",
      error_message: String(err.api_message || err.message || "test failed").slice(0, 500),
      http_status: err.status ?? null,
    };
  }
  // Stamp test outcome on the vendor row (Save-gate reads this).
  await healthRepo.markTestOutcome({
    vendor,
    ok: result.ok,
    latency_ms: result.latency_ms,
    error: result.ok ? null : (result.error_code || result.error_message || "test failed"),
    user_id: req.user?.user_id || null,
  });
  res.json({ data: result });
}

async function listVendorHealth(req, res) {
  // Reuses the standard vendor list; the DB columns added in 000309 come
  // through automatically.
  res.json({ data: await service.listVendors() });
}
async function listHealthPings(req, res) {
  res.json({
    data: await healthRepo.recentPings({
      vendor: req.query.vendor || null,
      limit: Math.min(200, Number(req.query.limit) || 50),
    }),
  });
}
async function listIncidents(req, res) {
  res.json({
    data: await healthRepo.listIncidents({
      vendor: req.query.vendor || null,
      limit: Math.min(200, Number(req.query.limit) || 100),
    }),
  });
}
async function pingVendorNow(req, res) {
  const r = await health.pingVendor({
    vendor: req.params.vendor,
    source: "manual",
    checked_by: req.user?.user_id || null,
  });
  res.json({ data: r });
}
async function recentErrors(req, res) {
  res.json({
    data: await healthRepo.recentErrors({
      vendor: req.query.vendor || null,
      limit: Math.min(200, Number(req.query.limit) || 50),
    }),
  });
}
async function successRate(req, res) {
  const hours = Math.max(1, Math.min(720, Number(req.query.hours) || 24));
  res.json({ data: await healthRepo.vendorSuccessRate({ since_hours: hours }) });
}

async function getBrandVoice(req, res) {
  res.json(await service.getBrandVoice({ brand: req.brand }));
}
async function upsertBrandVoice(req, res) {
  res.json({
    data: await service.upsertBrandVoice({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

module.exports = {
  listFlags,
  upsertFlag,
  toggleFlag,
  listGrants,
  grant,
  revokeGrant,
  listVendors,
  upsertVendor,
  rotateVendor,
  setVendorActive,
  testVendor,
  listVendorHealth,
  listHealthPings,
  listIncidents,
  pingVendorNow,
  recentErrors,
  successRate,
  activeBudget,
  listBudgets,
  openBudget,
  setBudgetCaps,
  listUsage,
  spendMeter,
  listActions,
  upsertAction,
  toggleAction,
  getBrandVoice,
  upsertBrandVoice,
  listModels,
  upsertModel,
};
