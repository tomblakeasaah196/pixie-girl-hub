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
const modelCatalogue = require("../ai_governance/model-catalogue.repo");
const embeddings = require("../../services/embeddings.service");
const llm = require("../../services/llm.service");
const gemini = require("../../services/gemini.service");
const queryAgent = require("./query-agent");
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
    "For questions about CURRENT business data (sales, revenue, orders, stock, operations, KPIs), call the matching `query_*` tool to fetch LIVE figures — never guess or invent numbers.",
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
  // §8.2 Query Agent: expose the read-only query catalogue as tools too, so the
  // model can answer questions about LIVE data (not just embedded docs).
  const allTools = [...tools, ...queryAgent.tools()];
  const messages = [
    { role: "system", content: systemPrompt({ brand, contextChunks }) },
    ...history,
    { role: "user", content: userText },
  ];

  let completion;
  const tLlm = Date.now();
  try {
    completion = await llm.chat({ vendor, messages, tools: allTools });
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
  let costNgn = computeCost(vendor, usage);
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
    let args = {};
    try {
      args =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments || "{}")
          : toolCall.function.arguments || {};
    } catch {
      args = {};
    }
    if (queryAgent.isQueryTool(toolCall.function.name)) {
      // §8.2 Query Agent — permission-scoped live-data read + summary (no write).
      const qr = await queryAgent.run({
        vendor,
        user,
        brand,
        messages,
        completion,
        toolCall,
        args,
      });
      if (qr.replyText) replyText = qr.replyText;
      const fu = qr.usage || {};
      if (fu.total_tokens) {
        usage.prompt_tokens =
          (usage.prompt_tokens || 0) + (fu.prompt_tokens || 0);
        usage.completion_tokens =
          (usage.completion_tokens || 0) + (fu.completion_tokens || 0);
        usage.total_tokens = (usage.total_tokens || 0) + (fu.total_tokens || 0);
        costNgn = computeCost(vendor, usage);
      }
      await repo.insertRunStep({
        client,
        s: {
          conversation_id: convId,
          message_id: userMsg.message_id,
          agent: "orchestrator",
          step_number: ++step,
          step_type: "call_action",
          output: { query: qr.queryKey || null, denied: qr.denied || false },
          status: "completed",
        },
      });
    } else {
      const action = byName.get(toolCall.function.name);
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
              action.min_confidence !== null &&
              action.min_confidence !== undefined
                ? action.min_confidence
                : 0.8,
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

// ──────────────────────────────────────────────────────────────────
// Smartcomm draft — single-turn brand-voice reply for the composer
// "Draft with Praxis" button (PR 3 / PR 5).
//
// Different shape from `orchestrate`:
//   - No RAG, no tools, no pending actions. Single chat completion.
//   - Tries the primary vendor (PRAXIS_LLM_VENDOR, default deepseek),
//     falls back to the configured fallback (PRAXIS_LLM_FALLBACK_VENDOR,
//     default gemini) on retryable failure.
//   - Costs read from ai_model_catalogue, not the legacy vendor.cost_*.
//   - Returns { text, usage } in the shape smartcomm.praxis-draft.js
//     expects (provider/model/input_tokens/output_tokens/cost_ngn).
// ──────────────────────────────────────────────────────────────────

const PRIMARY_VENDOR = () => config.PRAXIS_LLM_VENDOR || "deepseek";
const FALLBACK_VENDOR = () => config.PRAXIS_LLM_FALLBACK_VENDOR || "gemini";

function buildSmartcommPrompt(ctx) {
  const lines = [];
  lines.push(
    `You are drafting a customer-service reply on behalf of the ${ctx.brand} business.`,
    "Write ONE concise message ready to send — no preamble, no quotation marks, no 'Sure, here is...'. Just the reply text.",
  );
  if (ctx.tone) lines.push(`Tone: ${ctx.tone}.`);
  if (ctx.voice_summary) lines.push(`Voice: ${ctx.voice_summary}`);
  if (ctx.platform && ctx.platform !== "internal") {
    lines.push(
      `Channel: ${ctx.platform}. Keep it short, mobile-friendly, conversational.`,
    );
  }
  if (ctx.preferred_channel) {
    lines.push(`Customer prefers replies on: ${ctx.preferred_channel}.`);
  }
  if (ctx.primary_emojis && ctx.primary_emojis.length) {
    lines.push(
      `Brand emoji palette (use sparingly): ${ctx.primary_emojis.join(" ")}`,
    );
  }
  const dos = (ctx.do_donts && ctx.do_donts.do) || [];
  const donts = (ctx.do_donts && ctx.do_donts.dont) || [];
  if (dos.length) lines.push(`Always: ${dos.join("; ")}.`);
  if (donts.length) lines.push(`Never: ${donts.join("; ")}.`);
  if (ctx.sample_transcripts && ctx.sample_transcripts.length) {
    lines.push("Tone-match examples:");
    for (const s of ctx.sample_transcripts.slice(0, 3)) {
      if (s.customer && s.staff) {
        lines.push(`- Customer: "${s.customer}"\n  Brand: "${s.staff}"`);
      }
    }
  }
  if (ctx.signature_html) {
    // Strip HTML for the system prompt — model treats signatures literally.
    const sig = String(ctx.signature_html)
      .replace(/<[^>]+>/g, "")
      .trim();
    if (sig) lines.push(`End with this signature: ${sig}`);
  }
  return lines.join("\n");
}

function transcriptToMessages(transcript, customerName) {
  if (!transcript) {
    return [
      {
        role: "user",
        content: `(${customerName} just opened the conversation — write a warm opener.)`,
      },
    ];
  }
  // Convert "Customer: ..." / "Staff: ..." lines to message objects so
  // the model sees genuine roles, not one block of text.
  const out = [];
  for (const line of transcript.split("\n")) {
    const m = /^(Customer|Staff|System|[A-Z][a-zA-Z]+):\s*(.*)$/.exec(line);
    if (!m) {
      if (out.length) out[out.length - 1].content += "\n" + line;
      else out.push({ role: "user", content: line });
      continue;
    }
    const isCustomer = m[1] === "Customer";
    out.push({
      role: isCustomer ? "user" : "assistant",
      content: m[2],
    });
  }
  // Ensure the last message is from the customer so the model knows to
  // reply, not echo us.
  if (out.length && out[out.length - 1].role !== "user") {
    out.push({
      role: "user",
      content: `(Now write the next reply from ${customerName}'s brand.)`,
    });
  }
  return out;
}

async function callVendor(vendorName, { system, messages }) {
  if (vendorName === "gemini") {
    if (!gemini.isConfigured()) {
      const e = new Error("GEMINI_NOT_CONFIGURED");
      e.code = "VENDOR_NOT_CONFIGURED";
      e.retryable = false;
      throw e;
    }
    const model = await modelCatalogue.resolveActiveModel({
      vendor: "gemini",
      capability: "chat",
    });
    const result = await gemini.chatCompletion({
      system,
      messages,
      model: model ? model.model_id : undefined,
      temperature: 0.6,
      maxOutputTokens: 600,
    });
    return { ...result, modelRow: model };
  }
  // Default: OpenAI-compatible vendors via llm.service.
  const vendor = await llm.resolveVendor(vendorName);
  if (!vendor) {
    const e = new Error(`${vendorName.toUpperCase()}_NOT_CONFIGURED`);
    e.code = "VENDOR_NOT_CONFIGURED";
    e.retryable = false;
    throw e;
  }
  const model = await modelCatalogue.resolveActiveModel({
    vendor: vendorName,
    capability: "chat",
  });
  const completion = await llm.chat({
    vendor,
    model: model ? model.model_id : vendor.default_model,
    messages: [{ role: "system", content: system }, ...messages],
    temperature: 0.6,
  });
  return {
    text: completion.content || "",
    input_tokens: (completion.usage && completion.usage.prompt_tokens) || 0,
    output_tokens:
      (completion.usage && completion.usage.completion_tokens) || 0,
    model: completion.model,
    vendor: vendorName,
    modelRow: model,
  };
}

/**
 * Generate a single Smartcomm reply draft. Vendor fallback is built in:
 * primary fails → fallback tried automatically. The cost calculation
 * uses the model catalogue (so switching `gemini-2.5-flash` →
 * `gemini-2.5-flash-lite` in the UI immediately reduces the per-call
 * spend).
 *
 * Throws `AI_UNAVAILABLE` only when BOTH vendors fail to produce a
 * draft. Caller (smartcomm.praxis-draft) catches and surfaces the
 * deterministic stub.
 *
 * @param {object} args
 * @param {object} args.user
 * @param {string} args.brand
 * @param {object} args.context  — see smartcomm.praxis-draft.js promptContext
 */
async function generateSmartcommDraft({ user, brand, context }) {
  const system = buildSmartcommPrompt(context);
  const messages = transcriptToMessages(
    context.transcript,
    context.customer_name || "the customer",
  );

  const primary = PRIMARY_VENDOR();
  const fallback = FALLBACK_VENDOR();

  // Primary attempt
  let result = null;
  let lastError = null;
  try {
    result = await callVendor(primary, { system, messages });
  } catch (err) {
    lastError = err;
    if (!err.retryable && err.code === "VENDOR_NOT_CONFIGURED") {
      logger.warn(
        { vendor: primary, err: err.message },
        "smartcomm draft: primary vendor not configured; trying fallback",
      );
    } else {
      logger.warn(
        { vendor: primary, err: err.message },
        "smartcomm draft: primary vendor failed; trying fallback",
      );
    }
  }

  // Fallback
  if (!result && primary !== fallback) {
    try {
      result = await callVendor(fallback, { system, messages });
    } catch (err) {
      lastError = err;
      logger.error(
        { vendor: fallback, err: err.message },
        "smartcomm draft: fallback vendor also failed",
      );
    }
  }

  if (!result) {
    const e = new Error(
      `Both ${primary} and ${fallback} failed: ${lastError ? lastError.message : "no result"}`,
    );
    e.code = "AI_UNAVAILABLE";
    throw e;
  }

  const costNgn = result.modelRow
    ? modelCatalogue.computeCost({
        model: result.modelRow,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
      })
    : "0";

  // Persist usage row on the AI ledger so the spend meter sees it.
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        provider: result.vendor,
        model: result.model,
        call_type: "smartcomm_draft",
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        total_tokens: (result.input_tokens || 0) + (result.output_tokens || 0),
        cost_native: costNgn,
        cost_ngn: costNgn,
        was_successful: true,
      },
    });
  } catch (err) {
    logger.warn(
      { err: err.message },
      "smartcomm draft: usage record failed (continuing)",
    );
  }

  return {
    text: result.text,
    usage: {
      provider: result.vendor,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      total_tokens: (result.input_tokens || 0) + (result.output_tokens || 0),
      cost_native: costNgn,
      cost_ngn: costNgn,
      was_successful: true,
    },
  };
}

module.exports = { orchestrate, generateSmartcommDraft };
