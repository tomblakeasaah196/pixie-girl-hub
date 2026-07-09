/**
 * AI run wrapper — one helper every AI-touching call site uses so the
 * observability + failover story is uniform.
 *
 * Why this exists (post-Jul-2026 outage):
 *   - Storefront/Shade Finder/Praxis each rolled their own metering, and
 *     each only wrote the ledger row on SUCCESS — a 5-day Gemini outage
 *     produced zero ledger rows and no alert of any kind.
 *   - Failover was scattered too, so failures didn't consistently record
 *     an incident row (needed to alert admins).
 *
 * What this wraps:
 *   1. Vendor resolution (AI Control → .env).
 *   2. The Gemini call itself.
 *   3. Cost math using the vendor's per-1k rates.
 *   4. A ledger row on BOTH success and failure (Q5: log all calls).
 *   5. A health-state transition on the vendor row (green ↔ red).
 *   6. An incident row + admin alert on green→red flips (Q6) and on
 *      failover engagement (Q4).
 *
 * Callers keep their own quotas, prompts, and result parsing — this helper
 * is only about the metered network call.
 */

"use strict";

const gemini = require("./gemini.service");
const health = require("../modules/ai_governance/health.service");
const governance = require("../modules/ai_governance/governance.service");
const { logger } = require("../config/logger");
const { money, toCurrencyString } = require("../utils/money");

function costOf({ vendor, input_tokens, output_tokens }) {
  if (!vendor) return "0.0000";
  return toCurrencyString(
    money(input_tokens || 0)
      .div(1000)
      .times(money(vendor.cost_per_1k_input_tokens || 0))
      .plus(
        money(output_tokens || 0)
          .div(1000)
          .times(money(vendor.cost_per_1k_output_tokens || 0)),
      ),
  );
}

/**
 * One metered Gemini call.
 *
 * @param {object} args
 * @param {string} args.feature_key           ai_feature_flags row key (drives budget + ledger)
 * @param {string} [args.business]            'pixiegirl' | 'faitlynhair' | null (attributes spend per brand)
 * @param {string} [args.user_id]             null for public/storefront calls
 * @param {string} [args.call_type='chat_completion']
 * @param {object} args.gemini                Gemini call args (system, messages, model, temperature, …)
 * @returns {Promise<object>}                 The Gemini completion (text, input_tokens, output_tokens, model, vendor, latency_ms)
 *
 * On failure: logs a ledger row with was_successful=false + error_code + error_message,
 * records a health transition + incident if applicable, then re-throws the original error
 * so caller-specific fallback (WhatsApp handoff, degraded response) still runs.
 */
async function runGeminiCall({
  feature_key,
  business = null,
  user_id = null,
  call_type = "chat_completion",
  conversation_id = null,
  gemini: geminiArgs,
}) {
  const vendor = await gemini.resolveVendor();
  const startedAt = Date.now();
  try {
    const completion = await gemini.chatCompletion({
      vendor,
      ...geminiArgs,
    });
    const cost = costOf({
      vendor,
      input_tokens: completion.input_tokens,
      output_tokens: completion.output_tokens,
    });
    // Write success row + health-transition (green) in the background — never
    // block the caller on ledger IO.
    _recordUsageSafe({
      user_id,
      feature_key,
      business,
      conversation_id,
      call_type,
      provider: "gemini",
      model: completion.model,
      input_tokens: completion.input_tokens,
      output_tokens: completion.output_tokens,
      cost_native: cost,
      cost_ngn: cost,
      latency_ms: completion.latency_ms,
      was_successful: true,
      error_code: null,
      error_message: null,
    });
    health.markCallOutcome({
      vendor: "gemini",
      ok: true,
      latency_ms: completion.latency_ms,
    });
    return completion;
  } catch (err) {
    const latency_ms = err.latency_ms ?? Date.now() - startedAt;
    const error_code =
      err.code ||
      (err.status ? `HTTP_${err.status}` : null) ||
      "AI_CALL_FAILED";
    const error_message = String(
      err.api_message || err.message || "gemini call failed",
    ).slice(0, 500);
    _recordUsageSafe({
      user_id,
      feature_key,
      business,
      conversation_id,
      call_type,
      provider: "gemini",
      model: (geminiArgs && geminiArgs.model) || (vendor && vendor.default_model) || "gemini-2.5-flash",
      input_tokens: 0,
      output_tokens: 0,
      cost_native: "0.0000",
      cost_ngn: "0.0000",
      latency_ms,
      was_successful: false,
      error_code,
      error_message,
    });
    health.markCallOutcome({
      vendor: "gemini",
      ok: false,
      latency_ms,
      error_code,
      error_message,
    });
    throw err;
  }
}

/** Fire-and-forget ledger write; failures logged but never bubbled. */
function _recordUsageSafe(usage) {
  Promise.resolve()
    .then(() => governance.recordUsage({ usage }))
    .catch((err) => {
      logger.debug(
        { err: err.message, feature_key: usage.feature_key },
        "ai-run: ledger insert skipped",
      );
    });
}

module.exports = {
  runGeminiCall,
  costOf,
};
