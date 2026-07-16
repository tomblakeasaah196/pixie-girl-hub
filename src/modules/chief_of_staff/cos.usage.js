/**
 * Chief of Staff — best-effort usage metering.
 *
 * Extracted so both the chat turn (cos.service) and the self-repair round
 * (cos.repair) record their LLM spend on the governance ledger under the same
 * 'cos_chat' feature. Never throws into a caller — a metering hiccup must not
 * fail a turn or a plan execution.
 */

"use strict";

const governance = require("../ai_governance/governance.service");
const modelCatalogue = require("../ai_governance/model-catalogue.repo");
const { logger } = require("../../config/logger");

const FEATURE = "cos_chat";

async function recordUsageSafe({ user, brand, convId, completion, ok, feature_key = FEATURE }) {
  let cost = "0";
  try {
    const model = await modelCatalogue.resolveActiveModel({
      vendor: completion.vendor,
      capability: "chat",
    });
    if (model)
      cost = modelCatalogue.computeCost({
        model,
        input_tokens: (completion.usage && completion.usage.prompt_tokens) || 0,
        output_tokens: (completion.usage && completion.usage.completion_tokens) || 0,
      });
  } catch {
    /* best-effort cost */
  }
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key,
        business: brand,
        conversation_id: convId || null,
        provider: completion.vendor,
        model: completion.model,
        call_type: "chat_completion",
        input_tokens: (completion.usage && completion.usage.prompt_tokens) || 0,
        output_tokens: (completion.usage && completion.usage.completion_tokens) || 0,
        total_tokens: (completion.usage && completion.usage.total_tokens) || 0,
        cost_native: cost,
        cost_ngn: cost,
        was_successful: ok,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, "cos: usage record failed");
  }
  return cost;
}

module.exports = { recordUsageSafe, FEATURE };
