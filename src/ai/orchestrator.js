/**
 * Praxis Orchestrator (V2.2 §8.2) — thin facade.
 *
 * The live orchestrator turn (RAG retrieve → LLM with the ai_enabled action
 * catalogue as tools → propose a pending action for writes / answer reads →
 * trace + usage) is implemented in modules/praxis_ai/praxis.orchestrator and
 * driven by praxis.service.postMessage (which gates on governance + the
 * PRAXIS_ORCHESTRATOR_ENABLED flag, falling back to a graceful stub when no
 * vendor is configured). This forwards to it so `src/ai` stays a coherent path.
 */

"use strict";

const praxis = require("../modules/praxis_ai/praxis.service");

/**
 * Handle one user turn in a conversation. Returns
 * { user_message, assistant_message, pending_action }.
 */
async function handle({
  user,
  brand,
  message_text,
  conversation_id,
  request_id,
}) {
  return praxis.postMessage({
    user,
    brand,
    request_id: request_id || null,
    id: conversation_id,
    input: { content: message_text, input_mode: "text" },
  });
}

module.exports = { handle };
