/**
 * AI usage metering + budget enforcement (V2.2 §6.31) — thin facade.
 *
 * The canonical guards/ledger live in AI Governance (shared.ai_usage +
 * ai_budget_periods, with the budget-rollup trigger). This wraps a call:
 *   pre-check governance.canUseFeature → run callFn → governance.recordUsage.
 * Hard cap / disabled flag → throws; soft-cap warnings are handled in
 * governance. Use this for any ad-hoc AI call outside the Praxis orchestrator
 * (which records usage itself).
 */

"use strict";

const governance = require("../modules/ai_governance/governance.service");
const { AppError } = require("../utils/errors");

async function meteredCall({
  feature_key,
  vendor,
  model,
  user_id,
  business = null,
  is_ceo = false,
  callFn,
}) {
  const guard = await governance.canUseFeature({
    user_id,
    feature_key,
    is_ceo,
  });
  if (!guard.ok)
    throw new AppError(
      "AI_UNAVAILABLE",
      `AI unavailable: ${guard.reason}`,
      guard.reason === "BUDGET_HARD_CAP" ? 402 : 503,
    );

  const result = await callFn();

  try {
    await governance.recordUsage({
      usage: {
        user_id,
        feature_key,
        business,
        provider: vendor,
        model,
        call_type: "chat_completion",
        input_tokens: (result && result.input_tokens) || 0,
        output_tokens: (result && result.output_tokens) || 0,
        total_tokens: (result && result.total_tokens) || 0,
        cost_native: (result && result.cost_ngn) || 0,
        cost_ngn: (result && result.cost_ngn) || 0,
        was_successful: true,
      },
    });
  } catch {
    // metering must never break the call result
  }
  return result;
}

module.exports = { meteredCall };
