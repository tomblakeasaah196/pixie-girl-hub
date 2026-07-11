/**
 * Chief of Staff (PR3) — business logic.
 *
 * A scoped persona over the Praxis runtime: its own conversation `kind`, its
 * own governance feature ('cos_chat'), a catalogue filtered to surface=
 * 'workspace', a batch-plan proposal (instead of Praxis's single pending
 * action), and the failover router for the model call. Reuses praxis.repo for
 * conversations/messages and praxis.executor (via the plan executor) for writes.
 *
 * Degrades to a graceful stub when the 'cos_chat' feature is disabled (from AI
 * Control → Feature Flags), over its cap/budget, or no LLM vendor is configured
 * — the conversation + usage flow stays intact either way. There is no env
 * switch: enablement is owned entirely by AI Control.
 */

"use strict";

const praxisRepo = require("../praxis_ai/praxis.repo");
const cosRepo = require("./cos.repo");
const planExecutor = require("./cos.plan-executor");
const persona = require("./cos.persona");
const planner = require("./cos.planner");
const memory = require("./cos.memory");
const settingsRepo = require("./cos.settings.repo");
const goalsRepo = require("../../shared/goals/goals.repo");
const events = require("./cos.events");
const governance = require("../ai_governance/governance.service");
const modelCatalogue = require("../ai_governance/model-catalogue.repo");
const llmRouter = require("../../services/llm-router");
const transcription = require("../../services/transcription.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError } = require("../../utils/errors");

const KIND = "chief_of_staff";
const FEATURE = "cos_chat";
const HISTORY_TURNS = 10;
const PRAXIS_MAX_TOOLS = 40;

const safeName = (key) =>
  String(key).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);

function normalizeParams(schema) {
  if (schema && typeof schema === "object" && !Array.isArray(schema) && schema.type === "object") {
    return { properties: {}, ...schema };
  }
  return { type: "object", properties: {} };
}

/** OpenAI-style tools from the CoS catalogue rows, keyed by tool name. */
function buildTools(actions) {
  const byName = new Map();
  const tools = [];
  for (const a of actions.slice(0, PRAXIS_MAX_TOOLS)) {
    const name = safeName(a.action_key);
    if (byName.has(name)) continue;
    byName.set(name, a);
    tools.push({
      type: "function",
      function: {
        name,
        description: a.description || a.title || a.action_key,
        parameters: normalizeParams(a.payload_schema),
      },
    });
  }
  return { tools, byName };
}

// ── Conversations ──────────────────────────────────────────
function listConversations({ user }) {
  return praxisRepo.listConversations({ user_id: user.user_id, kind: KIND });
}

async function getConversation({ user, id }) {
  const conv = await praxisRepo.findConversation({ id });
  if (!conv || conv.user_id !== user.user_id || conv.kind !== KIND)
    throw new NotFoundError("Conversation");
  const [messages, plans] = await Promise.all([
    praxisRepo.listMessages({ conversation_id: id }),
    cosRepo.listPlansForConversation({ conversation_id: id }),
  ]);
  const plansWithSteps = await Promise.all(
    plans.map(async (p) => ({
      ...p,
      steps: await cosRepo.listPlanSteps({ plan_id: p.plan_id }),
    })),
  );
  return { ...conv, messages, plans: plansWithSteps };
}

async function createConversation({ user, brand, request_id, input }) {
  const conv = await praxisRepo.createConversation({
    c: {
      user_id: user.user_id,
      business: brand,
      title: input.title,
      is_voice_started: input.is_voice_started,
      kind: KIND,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.conversation.create",
    target_type: "ai_conversation",
    target_id: conv.conversation_id,
    request_id,
  });
  return conv;
}

async function archiveConversation({ user, id }) {
  const conv = await praxisRepo.findConversation({ id });
  if (!conv || conv.user_id !== user.user_id || conv.kind !== KIND)
    throw new NotFoundError("Conversation");
  await praxisRepo.archiveConversation({ id, user_id: user.user_id });
}

// ── The CoS turn ───────────────────────────────────────────
async function recordUsageSafe({ user, brand, convId, completion, ok }) {
  let cost = "0";
  try {
    const model = await modelCatalogue.resolveActiveModel({
      vendor: completion.vendor,
      capability: "chat",
    });
    if (model)
      cost = modelCatalogue.computeCost({
        model,
        input_tokens: completion.usage.prompt_tokens || 0,
        output_tokens: completion.usage.completion_tokens || 0,
      });
  } catch {
    /* best-effort cost */
  }
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        conversation_id: convId,
        provider: completion.vendor,
        model: completion.model,
        call_type: "chat_completion",
        input_tokens: completion.usage.prompt_tokens || 0,
        output_tokens: completion.usage.completion_tokens || 0,
        total_tokens: completion.usage.total_tokens || 0,
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

/** Compact snapshot of the brand's active goals, so status questions are grounded. */
async function goalsSnapshot({ brand }) {
  try {
    const { data } = await goalsRepo.listGoals({ brand, status: "active", page: 1, page_size: 20 });
    if (!data || !data.length) return "";
    return [
      "CURRENT ACTIVE GOALS (context — don't restate unless asked):",
      ...data.map(
        (g) =>
          `• ${g.title} — ${g.health}, ${g.progress_pct ?? 0}% done` +
          (g.target_date ? `, target ${String(g.target_date).slice(0, 10)}` : ""),
      ),
    ].join("\n");
  } catch {
    return "";
  }
}

/** Nearest CoS memory (goals/notes/decisions) for the turn — [] when RAG is off. */
async function memorySnapshot({ user, brand, userText }) {
  try {
    const chunks = await memory.retrieve({ user, brand, queryText: userText, topK: 4 });
    if (!chunks || !chunks.length) return "";
    return [
      "RELEVANT MEMORY (from past goals, notes & decisions):",
      ...chunks.map((c) => `• ${String(c.content).slice(0, 400)}`),
    ].join("\n");
  } catch {
    return "";
  }
}

/**
 * Live CoS turn. Returns { assistant_message, plan } or null to signal the
 * caller to fall back to the stub (no vendor / nothing to offer).
 */
async function runTurn({ client, user, brand, conversation, userMsg, userText }) {
  const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
  const { tools, byName } = buildTools(actions);
  if (!tools.length) return null;

  const prior = await praxisRepo.listMessages({ conversation_id: conversation.conversation_id });
  const history = prior
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.message_id !== userMsg.message_id)
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content || "" }));

  // Ground the turn in the CEO's real goals + semantic memory (wow #7), so
  // "how is X doing?" is answered from history, not invented. Load the CEO's
  // personalisation (PR6) so the persona speaks as her named assistant/tone.
  const [goalsCtx, memCtx, settings] = await Promise.all([
    goalsSnapshot({ brand }),
    memorySnapshot({ user, brand, userText }),
    settingsRepo.get({ user_id: user.user_id }).catch(() => null),
  ]);
  const contextBlock = [goalsCtx, memCtx].filter(Boolean).join("\n\n");

  const messages = [
    {
      role: "system",
      content: persona.systemPrompt({
        brand,
        user,
        settings,
        actionTitles: actions.map((a) => a.title),
      }),
    },
    ...(contextBlock ? [{ role: "system", content: contextBlock }] : []),
    ...history,
    { role: "user", content: userText },
  ];

  let completion;
  try {
    completion = await llmRouter.chatWithFailover({
      capability: "chat",
      messages,
      tools,
      user,
      brand,
      feature_key: FEATURE,
    });
  } catch (err) {
    logger.error({ err: err.message }, "cos: llm-router failed — falling back to stub");
    return null;
  }

  await recordUsageSafe({ user, brand, convId: conversation.conversation_id, completion, ok: true });

  let plan = null;
  if (completion.tool_calls && completion.tool_calls.length) {
    const built = await planner.planFromCompletion({
      client,
      completion,
      byName,
      conversation,
      userMsg,
      user,
      brand,
    });
    if (built) plan = built;
  }

  const replyText =
    (completion.content && completion.content.trim()) ||
    (plan
      ? "Here's the plan I've put together — review the steps and approve to run them."
      : "Okay.");

  const assistant = await praxisRepo.insertMessage({
    client,
    m: {
      conversation_id: conversation.conversation_id,
      role: "assistant",
      content: replyText,
      provider: completion.vendor,
      model: completion.model,
      input_tokens: completion.usage.prompt_tokens || null,
      output_tokens: completion.usage.completion_tokens || null,
    },
  });
  await praxisRepo.touchConversation({
    client,
    id: conversation.conversation_id,
    tokens: completion.usage.total_tokens || 0,
  });
  return { assistant_message: assistant, plan };
}

// The CoS is gated entirely from AI Control (no env switch): the 'cos_chat'
// feature flag turns it on/off, and a configured vendor lets it actually run.
function stubReply(guard) {
  if (guard && !guard.ok) {
    if (guard.resting_message) return guard.resting_message;
    if (guard.reason === "USER_DAILY_CAP")
      return "You've reached today's Chief of Staff limit. It resets tomorrow — or raise the cap in AI Control.";
    if (guard.reason === "BUDGET_HARD_CAP")
      return "The AI budget for this period is spent, so the Chief of Staff is paused. Raise the cap in AI Control → Spend & Budget.";
    return "Your Chief of Staff is switched off. Turn it on in AI Control → Feature Flags (enable “Chief of Staff”) and I'll start planning with you — no redeploy needed.";
  }
  // Enabled, but no usable AI vendor is configured.
  return "Your Chief of Staff is enabled, but no AI vendor is configured yet. Add a vendor key in AI Control → Vendors & Models and I'll get to work.";
}

async function postMessage({ user, brand, request_id, id, input }) {
  const conv = await praxisRepo.findConversation({ id });
  if (!conv || conv.user_id !== user.user_id || conv.kind !== KIND)
    throw new NotFoundError("Conversation");

  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE,
    is_ceo: user.is_ceo,
    business: brand,
  });

  // Voice → text up front (network call, outside the DB transaction).
  let transcribed = input.transcribed_text || null;
  if (!transcribed && input.source_audio_url) {
    transcribed = await transcription.transcribe({ audioUrl: input.source_audio_url });
  }
  const userText = input.content || transcribed || "";

  return transaction(async (client) => {
    const userMsg = await praxisRepo.insertMessage({
      client,
      m: {
        conversation_id: id,
        role: "user",
        input_mode: input.input_mode || "text",
        transcribed_text: transcribed,
        source_audio_url: input.source_audio_url || null,
        content: userText,
      },
    });
    await praxisRepo.touchConversation({ client, id });

    let assistantMsg = null;
    let plan = null;
    if (guard.ok) {
      try {
        const r = await runTurn({
          client,
          user,
          brand,
          conversation: conv,
          userMsg,
          userText,
        });
        if (r) {
          assistantMsg = r.assistant_message;
          plan = r.plan;
        }
      } catch (err) {
        logger.error({ err: err.message }, "cos turn failed — falling back to stub");
      }
    }

    if (!assistantMsg) {
      assistantMsg = await praxisRepo.insertMessage({
        client,
        m: { conversation_id: id, role: "assistant", content: stubReply(guard) },
      });
      await praxisRepo.touchConversation({ client, id });
    }

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "cos.message.post",
      target_type: "ai_conversation",
      target_id: id,
      request_id,
    });
    if (plan) {
      events.emit("plan.proposed", {
        plan_id: plan.plan.plan_id,
        user_id: user.user_id,
        conversation_id: id,
      });
    }
    return {
      user_message: userMsg,
      assistant_message: assistantMsg,
      plan: plan ? { ...plan.plan, steps: plan.steps } : null,
    };
  });
}

// ── Plans ──────────────────────────────────────────────────
async function getPlan({ user, id }) {
  const plan = await cosRepo.findPlan({ id });
  if (!plan || plan.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Plan");
  const steps = await cosRepo.listPlanSteps({ plan_id: id });
  return { ...plan, steps };
}

function confirmPlan({ user, request_id, id, auth_header }) {
  return planExecutor.confirmPlan({ user, request_id, id, auth_header });
}

function rejectPlan({ user, request_id, id, reason }) {
  return planExecutor.rejectPlan({ user, request_id, id, reason });
}

// Re-exported so a caller (or test) can assert the scoped catalogue directly.
function listWorkspaceActions() {
  return governance.listActions({ ai_enabled: true, surface: "workspace" });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  archiveConversation,
  postMessage,
  getPlan,
  confirmPlan,
  rejectPlan,
  listWorkspaceActions,
  // internals exposed for tests
  buildTools,
  runTurn,
};
