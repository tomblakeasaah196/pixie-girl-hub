/**
 * Praxis live orchestrator (X-2 / V2.2 §6.29).
 *
 * One conversational turn:
 *   1. RAG retrieve — embed the user's text and pull the nearest active,
 *      in-scope knowledge chunks (ai_embeddings).
 *   2. LLM call — system prompt + retrieved context + recent history + the
 *      ai_enabled action catalogue exposed as tools.
 *   3. Decide —
 *        • a tool call  → materialise an ai_pending_actions row (the §6.29
 *          human-in-the-loop gate); nothing executes until a human confirms.
 *        • plain text   → a read answer.
 *   4. Trace every step (ai_run_steps) and record real token usage + cost
 *      (governance ledger; vendor per-1k rates).
 *
 * All vendor creds come from AI Control (governance.getVendorConfig). When no
 * vendor is configured `resolveVendor` returns null and the caller falls back
 * to the graceful stub — so this is safe to leave wired in every environment.
 */

"use strict";

const repo = require("./praxis.repo");
const governance = require("../ai_governance/governance.service");
const embeddings = require("../../services/embeddings.service");
const llm = require("../../services/llm.service");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");

const FEATURE = "praxis_chat";
const HISTORY_TURNS = 10;

const safeName = (key) =>
  String(key)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);

function buildTools(actions) {
  const byName = new Map();
  const tools = [];
  for (const a of actions.slice(0, config.PRAXIS_MAX_TOOLS)) {
    const name = safeName(a.action_key);
    byName.set(name, a);
    tools.push({
      type: "function",
      function: {
        name,
        description: a.description || a.title || a.action_key,
        parameters:
          a.payload_schema && typeof a.payload_schema === "object"
            ? a.payload_schema
            : { type: "object", properties: {} },
      },
    });
  }
  return { tools, byName };
}

function systemPrompt({ brand, contextChunks }) {
  const ctx = contextChunks.length
    ? "Relevant knowledge:\n" +
      contextChunks.map((c, i) => `[${i + 1}] ${c.source_text}`).join("\n\n")
    : "No specific knowledge was retrieved for this query.";
  return [
    `You are Praxis, the AI operations assistant for the ${brand} business in Pixie Girl Hub.`,
    "Answer read/lookup questions directly and concisely using the knowledge below.",
    "For any action that CHANGES data (create/update/delete/approve/send), DO NOT claim it is done — instead call the matching tool with precise arguments. A human must confirm before it runs.",
    "Never invent IDs or amounts. If you lack a required value, ask for it.",
    "",
    ctx,
  ].join("\n");
}

function computeCost(vendor, usage) {
  const inRate = money(vendor.cost_per_1k_input_tokens || 0);
  const outRate = money(vendor.cost_per_1k_output_tokens || 0);
  const cost = money(usage.prompt_tokens || 0)
    .div(1000)
    .times(inRate)
    .plus(
      money(usage.completion_tokens || 0)
        .div(1000)
        .times(outRate),
    );
  return toCurrencyString(cost);
}

/**
 * Run a live turn. Returns { assistant_message, pending_action } on success, or
 * null when no LLM vendor is configured (caller should use the stub).
 * Inserts DB rows via the passed transaction `client`.
 */
async function orchestrate({ client, user, brand, conversation, userMsg }) {
  const vendor = await llm.resolveVendor(conversation.provider);
  if (!vendor) return null;

  const convId = conversation.conversation_id;
  const userText = userMsg.content || userMsg.transcribed_text || "";
  let step = 0;
  const t0 = Date.now();

  // 1) RAG retrieve (best-effort; skipped if embeddings not configured)
  let contextChunks = [];
  try {
    const vecs = await embeddings.embed(userText);
    if (vecs && vecs[0] && config.PRAXIS_RAG_TOP_K > 0) {
      contextChunks = await repo.retrieveContext({
        queryVector: `[${vecs[0].join(",")}]`,
        business: brand,
        limit: config.PRAXIS_RAG_TOP_K,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message }, "praxis: retrieval failed (continuing)");
  }
  await repo.insertRunStep({
    client,
    s: {
      conversation_id: convId,
      message_id: userMsg.message_id,
      agent: "orchestrator",
      step_number: ++step,
      step_type: "retrieve",
      output: { chunks: contextChunks.length },
      status: "completed",
      duration_ms: Date.now() - t0,
    },
  });

  // 2) Build prompt + tools, call the model
  const priorMessages = await repo.listMessages({ conversation_id: convId });
  const history = priorMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content || "" }));
  const actions = await governance.listActions({ ai_enabled: true });
  const { tools, byName } = buildTools(actions);
  const messages = [
    { role: "system", content: systemPrompt({ brand, contextChunks }) },
    ...history,
    { role: "user", content: userText },
  ];

  let completion;
  const tLlm = Date.now();
  try {
    completion = await llm.chat({ vendor, messages, tools });
  } catch (err) {
    logger.error({ err: err.message }, "praxis: LLM call failed");
    await repo.insertRunStep({
      client,
      s: {
        conversation_id: convId,
        message_id: userMsg.message_id,
        agent: "orchestrator",
        step_number: ++step,
        step_type: "call_model",
        status: "failed",
        error_message: err.message,
        duration_ms: Date.now() - tLlm,
      },
    });
    const assistant = await repo.insertMessage({
      client,
      m: {
        conversation_id: convId,
        role: "assistant",
        content:
          "I couldn't reach the AI service just now. Please try again in a moment.",
        provider: vendor.vendor,
        model: vendor.default_model,
      },
    });
    await repo.touchConversation({ client, id: convId });
    await recordUsageSafe({
      user,
      brand,
      convId,
      vendor,
      model: vendor.default_model,
      usage: {},
      cost_ngn: "0",
      ok: false,
    });
    return { assistant_message: assistant, pending_action: null };
  }

  const usage = completion.usage || {};
  const costNgn = computeCost(vendor, usage);
  await repo.insertRunStep({
    client,
    s: {
      conversation_id: convId,
      message_id: userMsg.message_id,
      agent: "orchestrator",
      step_number: ++step,
      step_type: "call_model",
      output: { has_tool_call: completion.tool_calls.length > 0 },
      tokens_used: usage.total_tokens || null,
      cost_ngn: costNgn,
      status: "completed",
      duration_ms: Date.now() - tLlm,
    },
  });

  // 3) Decide: tool call (write → pending action) or plain answer (read)
  let pending = null;
  let replyText = completion.content || "";

  const toolCall = completion.tool_calls[0];
  if (toolCall && toolCall.function) {
    const action = byName.get(toolCall.function.name);
    let args = {};
    try {
      args =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments || "{}")
          : toolCall.function.arguments || {};
    } catch {
      args = {};
    }
    if (action) {
      const human_summary =
        replyText || `Proposed: ${action.title || action.action_key}`;
      pending = await repo.createPendingAction({
        client,
        p: {
          conversation_id: convId,
          message_id: userMsg.message_id,
          proposed_by_user_id: user.user_id,
          action_id: action.action_id,
          action_key: action.action_key,
          business: brand,
          method: action.method,
          route: action.route,
          payload: args,
          human_summary,
          confidence:
            action.min_confidence !== null ? action.min_confidence : 0.8,
        },
      });
      replyText =
        human_summary +
        "\n\nThis is a proposed action — confirm it to run, or reject it.";
      await repo.insertRunStep({
        client,
        s: {
          conversation_id: convId,
          message_id: userMsg.message_id,
          agent: "orchestrator",
          step_number: ++step,
          step_type: "match_action",
          output: { action_key: action.action_key },
          matched_action_id: action.action_id,
          status: "completed",
        },
      });
    }
  }

  if (!replyText) replyText = "Done.";

  const assistant = await repo.insertMessage({
    client,
    m: {
      conversation_id: convId,
      role: "assistant",
      content: replyText,
      pending_action_id: pending ? pending.pending_id : null,
      input_tokens: usage.prompt_tokens || null,
      output_tokens: usage.completion_tokens || null,
      provider: vendor.vendor,
      model: completion.model,
    },
  });
  await repo.touchConversation({
    client,
    id: convId,
    tokens: usage.total_tokens || 0,
    cost_ngn: costNgn,
  });

  await recordUsageSafe({
    user,
    brand,
    convId,
    vendor,
    model: completion.model,
    usage,
    cost_ngn: costNgn,
    ok: true,
  });

  return { assistant_message: assistant, pending_action: pending };
}

async function recordUsageSafe({
  user,
  brand,
  convId,
  vendor,
  model,
  usage,
  cost_ngn,
  ok,
}) {
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        conversation_id: convId,
        provider: vendor.vendor,
        model,
        call_type: "chat_completion",
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        cost_native: cost_ngn,
        cost_ngn,
        was_successful: ok,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, "praxis: usage record failed");
  }
}

module.exports = { orchestrate };
