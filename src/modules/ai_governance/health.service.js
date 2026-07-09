/**
 * AI vendor health service.
 *
 * Three things need to track vendor health:
 *   1. Every live call outcome (green tick / red flag) — throttled write
 *      to ai_vendor_credentials so the chip on the AI Control page turns
 *      red within seconds of a first failure.
 *   2. Boot + hourly cron pings — a synthetic 1-token call recorded in
 *      ai_vendor_health_pings.
 *   3. Manual "Test connection" clicks from the admin — same as cron, but
 *      the timing/error is stamped on the vendor row for the Save gate.
 *
 * On every green→red transition an incident row is written and the admin
 * alert dispatched (email/WhatsApp, batched so a spike doesn't flood).
 *
 * Kept intentionally thin (no HTTP surface — that's governance.controller).
 */

"use strict";

const axios = require("axios");
const gemini = require("../../services/gemini.service");
const repo = require("./governance.repo");
const healthRepo = require("./health.repo");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");

// ── Live call outcome markers (called by ai-run.service) ────────────

/**
 * Update a vendor's rolling health status after a live call. Writes only
 * on state change (red↔green) so the storefront's 20 calls/day don't cause
 * a write storm on ai_vendor_credentials, and skips entirely for "unknown"
 * → "green" transitions when there is no active row (rare boot edge).
 *
 * Fires green→red as an incident + alert; red→green auto-closes.
 * `markCallOutcome` is fire-and-forget from the caller's perspective.
 */
function markCallOutcome({ vendor, ok, latency_ms, error_code, error_message }) {
  Promise.resolve()
    .then(async () => {
      const row = await repo.getVendorRaw({ vendor });
      if (!row) return; // env-only vendor — nothing to update
      const nextStatus = ok ? "green" : "red";
      const prevStatus = row.last_health_status || "unknown";
      // Same-state green: skip the write entirely (write-cheap under load).
      // Same-state red: still write so `last_health_at` advances and ops
      // can see the outage is ongoing without waiting for the hourly cron.
      if (nextStatus === "green" && prevStatus === "green") return;
      await healthRepo.updateHealthState({
        vendor,
        status: nextStatus,
        latency_ms: latency_ms ?? null,
        error: ok ? null : (error_code || error_message || "call failed"),
      });
      if (prevStatus !== nextStatus) {
        await onHealthTransition({
          vendor,
          from: prevStatus,
          to: nextStatus,
          error_code,
          error_message,
          latency_ms,
          source: "live_call",
        });
      }
    })
    .catch((err) => {
      logger.debug({ err: err.message, vendor }, "health: markCallOutcome skipped");
    });
}

// ── Live ping (boot / cron / manual) ────────────────────────────────

/**
 * Synthetic ping. Uses a 1-token completion so we exercise auth + DNS +
 * model resolution end-to-end (a HEAD to the base URL would not).
 *
 * Returns { ok, latency_ms, http_status, error_code, error_message }.
 * Writes a row to ai_vendor_health_pings + updates the vendor's rolling
 * health state.
 */
async function pingVendor({ vendor, source = "manual", checked_by = null }) {
  const started = Date.now();
  let result;
  try {
    if (vendor === "gemini") {
      result = await _pingGemini();
    } else if (vendor === "deepseek" || vendor === "openai" || vendor === "groq") {
      result = await _pingOpenAICompatible({ vendor });
    } else {
      result = {
        ok: false,
        error_code: "UNSUPPORTED_VENDOR",
        error_message: `no ping implemented for ${vendor}`,
      };
    }
  } catch (err) {
    result = {
      ok: false,
      error_code: err.code || "PING_FAILED",
      error_message: String(err.message || "ping crashed").slice(0, 500),
      http_status: null,
    };
  }
  const latency_ms = Date.now() - started;
  const row = await repo.getVendorRaw({ vendor });
  const prevStatus = row?.last_health_status || "unknown";
  const nextStatus = result.ok ? "green" : "red";
  await healthRepo.insertPing({
    vendor,
    source,
    ok: result.ok,
    latency_ms,
    http_status: result.http_status ?? null,
    error_code: result.error_code ?? null,
    error_message: result.error_message ?? null,
    checked_by,
  });
  await healthRepo.updateHealthState({
    vendor,
    status: nextStatus,
    latency_ms,
    error: result.ok ? null : (result.error_code || result.error_message || "ping failed"),
  });
  if (prevStatus !== nextStatus) {
    await onHealthTransition({
      vendor,
      from: prevStatus,
      to: nextStatus,
      error_code: result.error_code,
      error_message: result.error_message,
      latency_ms,
      source,
    });
  }
  return { ok: result.ok, latency_ms, http_status: result.http_status ?? null,
    error_code: result.error_code ?? null, error_message: result.error_message ?? null };
}

async function _pingGemini() {
  const v = await gemini.resolveVendor();
  if (!v || !v.api_key) {
    return {
      ok: false,
      error_code: "GEMINI_NOT_CONFIGURED",
      error_message: "no API key in AI Control or .env",
      http_status: null,
    };
  }
  try {
    const completion = await gemini.chatCompletion({
      vendor: v,
      messages: [{ role: "user", content: "hi" }],
      maxOutputTokens: 8,
      timeoutMs: 15000,
      thinkingBudget: 0,
    });
    return { ok: true, http_status: 200, latency_ms: completion.latency_ms };
  } catch (err) {
    return {
      ok: false,
      error_code: err.code || "GEMINI_CALL_FAILED",
      error_message: String(err.api_message || err.message).slice(0, 500),
      http_status: err.status ?? null,
    };
  }
}

async function _pingOpenAICompatible({ vendor }) {
  // Use governance.getVendorConfig to inherit the same DB→env resolution
  // path llm.service uses. Skips if the row + env both lack a key.
  const governance = require("./governance.service");
  const cfg = await governance.getVendorConfig({ vendor });
  const envKey = _envKeyFor(vendor);
  const key = (cfg && cfg.api_key) || envKey.api_key;
  const endpoint = (cfg && cfg.endpoint_url) || envKey.endpoint_url;
  if (!key || !endpoint) {
    return {
      ok: false,
      error_code: "NOT_CONFIGURED",
      error_message: `no API key configured for ${vendor}`,
      http_status: null,
    };
  }
  const base = endpoint.replace(/\/$/, "");
  // A GET /models is the cheapest, most reliably-implemented health check
  // on OpenAI-compatible providers (DeepSeek/OpenAI/Groq all expose it and
  // it returns fast without spending tokens).
  try {
    const res = await axios.get(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, http_status: res.status };
    }
    return {
      ok: false,
      http_status: res.status,
      error_code: `HTTP_${res.status}`,
      error_message: (res.data?.error?.message || res.data?.message || `HTTP ${res.status}`).toString().slice(0, 500),
    };
  } catch (err) {
    return {
      ok: false,
      http_status: err.response?.status ?? null,
      error_code: err.code || "PING_FAILED",
      error_message: String(err.message).slice(0, 500),
    };
  }
}

function _envKeyFor(vendor) {
  switch (vendor) {
    case "deepseek":
      return { api_key: config.DEEPSEEK_API_KEY, endpoint_url: config.DEEPSEEK_BASE_URL };
    case "openai":
      return { api_key: config.OPENAI_API_KEY, endpoint_url: "https://api.openai.com/v1" };
    case "groq":
      return { api_key: config.GROQ_API_KEY, endpoint_url: "https://api.groq.com/openai/v1" };
    default:
      return {};
  }
}

/**
 * Ping every active vendor in parallel. Fire-and-forget from the caller —
 * used at boot and by the hourly cron. Never throws.
 */
function pingAllVendorsInBackground({ source = "cron" } = {}) {
  Promise.resolve()
    .then(async () => {
      const vendors = await repo.listVendors();
      const active = vendors.filter((v) => v.is_active);
      await Promise.all(
        active.map((v) =>
          pingVendor({ vendor: v.vendor, source }).catch((err) =>
            logger.warn({ err: err.message, vendor: v.vendor }, "health: ping crashed"),
          ),
        ),
      );
    })
    .catch((err) => logger.warn({ err: err.message }, "health: pingAll crashed"));
}

// ── Incidents + alerts ──────────────────────────────────────────────

async function onHealthTransition({
  vendor,
  from,
  to,
  error_code,
  error_message,
  latency_ms,
  source,
}) {
  // green→red: open a vendor_red incident + alert admins.
  // red→green: auto-close the open vendor_red incident + write a
  //            vendor_recovered incident (info severity — no alert spam).
  if (to === "red" && from !== "red") {
    const incident = await healthRepo.createIncident({
      incident_type: "vendor_red",
      vendor,
      severity: "critical",
      summary: `${vendor} health flipped to red (${error_code || "call failed"})`,
      details: { error_code, error_message, latency_ms, from, to, source },
    });
    _dispatchAdminAlert({
      subject: `AI vendor ${vendor} unhealthy`,
      body: `Vendor ${vendor} just flipped from ${from} → red.\n\nReason: ${error_code || "call failed"}\nMessage: ${error_message || "(none)"}\nLatency: ${latency_ms ?? "?"} ms\nSource: ${source}\n\nOpen AI Control → Vendors & Models to investigate.`,
      incident_id: incident?.incident_id,
    });
  } else if (to === "green" && from === "red") {
    await healthRepo.resolveOpenIncidents({ vendor, incident_type: "vendor_red" });
    await healthRepo.createIncident({
      incident_type: "vendor_recovered",
      vendor,
      severity: "info",
      summary: `${vendor} recovered (${latency_ms ?? "?"} ms)`,
      details: { from, to, latency_ms, source },
    });
  }
}

/**
 * Record a failover incident (called by the Praxis orchestrator when
 * DeepSeek→Gemini kicks in). Non-critical because the request succeeded
 * — but ops still needs to know the primary is degraded.
 */
async function recordFailover({ primary_vendor, fallback_vendor, feature_key, business, primary_error }) {
  const incident = await healthRepo.createIncident({
    incident_type: "failover_engaged",
    vendor: primary_vendor,
    fallback_vendor,
    feature_key: feature_key || null,
    business: business || null,
    severity: "warning",
    summary: `${primary_vendor} failed → falling back to ${fallback_vendor}`,
    details: { primary_error: String(primary_error || "").slice(0, 500) },
  });
  // Rate-limit the alert: only wake ops when failover fires more than N
  // times in the last hour (defined in healthRepo — a single failover is
  // routine; a spike is not).
  const recentFailovers = await healthRepo.countRecentFailovers({
    vendor: primary_vendor,
    since_minutes: 60,
  });
  if (recentFailovers >= 3) {
    _dispatchAdminAlert({
      subject: `AI failover spike: ${primary_vendor} → ${fallback_vendor}`,
      body: `${primary_vendor} failed ${recentFailovers}× in the last hour and each time we fell back to ${fallback_vendor}. Latest error: ${primary_error || "(none)"}`,
      incident_id: incident?.incident_id,
    });
  }
  return incident;
}

// ── Admin alert dispatcher ───────────────────────────────────────────
// The email service is optional (SMTP relay is env-configured) — we log
// the alert regardless so it's visible in pm2 logs even without email.
function _dispatchAdminAlert({ subject, body, incident_id }) {
  logger.error({ incident_id, subject, body }, "ADMIN ALERT");
  // Fire-and-forget email — never block the caller.
  Promise.resolve()
    .then(async () => {
      const email = require("../../services/email.service");
      const to = (config.AI_ALERT_EMAIL || "").trim();
      if (!to) return;
      await email.send({
        to,
        subject: `[AI ops] ${subject}`,
        text: body,
      });
    })
    .catch((err) => logger.warn({ err: err.message }, "admin alert email failed"));
}

module.exports = {
  markCallOutcome,
  pingVendor,
  pingAllVendorsInBackground,
  recordFailover,
};
