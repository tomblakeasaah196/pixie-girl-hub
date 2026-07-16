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
const praxisExecutor = require("../praxis_ai/praxis.executor");
const cosRepo = require("./cos.repo");
const planExecutor = require("./cos.plan-executor");
const persona = require("./cos.persona");
const planner = require("./cos.planner");
const planRounds = require("./cos.plan-rounds");
const memory = require("./cos.memory");
const settingsRepo = require("./cos.settings.repo");
const feedbackRepo = require("./cos.feedback.repo");
const traceRepo = require("./cos.trace.repo");
const goalsRepo = require("../../shared/goals/goals.repo");
const notesRepo = require("../../shared/goals/notes.repo");
const tasksRepo = require("../../shared/tasks/tasks.repo");
const events = require("./cos.events");
const governance = require("../ai_governance/governance.service");
const { recordUsageSafe } = require("./cos.usage");
const llmRouter = require("../../services/llm-router");
const transcription = require("../../services/transcription.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { AppError, NotFoundError } = require("../../utils/errors");

const KIND = "chief_of_staff";
const FEATURE = "cos_chat";
// Messages of context per turn. 10 starved long brainstorms — the model
// re-asked answered questions once early turns fell off. 60 (≈30 exchanges)
// with per-message clamping keeps the token cost bounded; worst case
// 60 × 8000 chars ≈ 120k tokens, comfortably inside modern context windows
// and far below it in practice.
const HISTORY_TURNS = 60;
const HISTORY_MSG_MAX_CHARS = 8000;
const PRAXIS_MAX_TOOLS = 60;

// Stub replies (see stubReply) must not consume history slots nor read as
// things "the assistant said" — they're feature-gate noise, not conversation.
const STUB_PREFIXES = [
  "Your Chief of Staff is switched off",
  "Your Chief of Staff is enabled, but no AI vendor",
  "You've reached today's Chief of Staff limit",
  "The AI budget for this period is spent",
];
const isStubText = (text) =>
  STUB_PREFIXES.some((p) => String(text || "").startsWith(p));

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
  const [messages, plans, savedNote, feedbackRows] = await Promise.all([
    praxisRepo.listMessages({ conversation_id: id }),
    cosRepo.listPlansForConversation({ conversation_id: id }),
    notesRepo.findNoteByCosConversation({
      user_id: user.user_id,
      conversation_id: id,
    }),
    feedbackRepo
      .listForConversation({ conversation_id: id, user_id: user.user_id })
      .catch(() => []),
  ]);
  // Hydrate each reply with any rating the CEO already gave it, so the thumbs
  // reflect prior feedback across reloads (the training loop's UI state).
  const feedbackByMsg = new Map(feedbackRows.map((f) => [f.message_id, f]));
  const messagesWithFeedback = messages.map((m) => {
    const f = feedbackByMsg.get(m.message_id);
    return f ? { ...m, feedback: { rating: f.rating, comment: f.comment } } : m;
  });
  const plansWithSteps = await Promise.all(
    plans.map(async (p) => ({
      ...p,
      steps: await cosRepo.listPlanSteps({ plan_id: p.plan_id }),
    })),
  );
  // saved_note lets the UI say "Update notes" instead of "Save to notes",
  // deep-link to the note in the Notes tab, and skip the "Save this?" prompt.
  const saved_note = savedNote
    ? {
        note_id: savedNote.note_id,
        title: savedNote.title,
        updated_at: savedNote.updated_at,
      }
    : null;
  return { ...conv, messages: messagesWithFeedback, plans: plansWithSteps, saved_note };
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
// recordUsageSafe now lives in cos.usage (shared with the self-repair round).

// How many teammates to inline in the persona before telling the model to fall
// back to search_users — keeps the prompt bounded on a bigger org.
const ROSTER_MAX = 40;
// How many recent CEO corrections to inject as standing instructions.
const CORRECTIONS_MAX = 5;

/** Assignable teammates for the persona (identity source for `assigned_to`). */
async function rosterSnapshot({ brand }) {
  try {
    const roster = await tasksRepo.listAssignableUsers({ brand, limit: ROSTER_MAX + 1 });
    const truncated = roster.length > ROSTER_MAX;
    return { roster: roster.slice(0, ROSTER_MAX), truncated };
  } catch {
    return { roster: [], truncated: false };
  }
}

/** The CEO's recent corrections (feedback loop) as plain strings for the persona. */
async function correctionsSnapshot({ user }) {
  try {
    return await feedbackRepo.recentCorrections({ user_id: user.user_id, limit: CORRECTIONS_MAX });
  } catch {
    return [];
  }
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
 * READ tool support: a call whose catalogue action is is_write=false runs
 * IMMEDIATELY during the turn over the same loopback executor the plan uses —
 * auth/brand/RBAC/Zod re-apply, so a read can never see more than the CEO.
 */
function makeReadHelpers({ byName, brand, auth_header, request_id }) {
  const actionFor = (call) =>
    byName.get((call && call.function && call.function.name) || "");
  const isRead = (call) => {
    const a = actionFor(call);
    return !!a && a.is_write === false;
  };
  const executeRead = async (call) => {
    const a = actionFor(call);
    if (!a || a.is_write !== false)
      throw new AppError("COS_NOT_A_READ", "Only read actions execute immediately", 422);
    let payload = {};
    try {
      payload = JSON.parse(call.function.arguments || "{}");
    } catch {
      payload = {};
    }
    const exec = await praxisExecutor.executeAction({
      pending: { method: a.method, route: a.route, payload, business: brand },
      authHeader: auth_header,
      requestId: request_id,
    });
    return exec.ok ? exec.result : { error: exec.result, http_status: exec.http_status };
  };
  return { isRead, executeRead: auth_header ? executeRead : null };
}

/**
 * Live CoS turn. The LLM loop (and any immediate reads) runs OUTSIDE any DB
 * transaction — only the final persistence (plan + assistant message) is
 * transactional, so a slow vendor chain never pins a pooled connection.
 * Returns { assistant_message, plan } or null to signal the caller to fall
 * back to the stub (no vendor / nothing to offer).
 */
async function runTurn({ user, brand, conversation, userMsg, userText, auth_header, request_id }) {
  const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
  const { tools, byName } = buildTools(actions);
  if (!tools.length) return null;

  const prior = await praxisRepo.listMessages({ conversation_id: conversation.conversation_id });
  const usable = prior.filter(
    (m) =>
      m.message_id !== userMsg.message_id &&
      (m.role === "user" || (m.role === "assistant" && !isStubText(m.content))),
  );
  const history = usable
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: (m.content || "").slice(0, HISTORY_MSG_MAX_CHARS) }));

  // Stub replay (#9): if the last assistant reply before this turn was a
  // feature-off stub, the CEO's earlier messages were never actually
  // answered — tell the model so it picks them up instead of ignoring them.
  const priorAssistant = prior
    .filter((m) => m.role === "assistant" && m.message_id !== userMsg.message_id)
    .pop();
  const wasResting = priorAssistant && isStubText(priorAssistant.content);

  // Ground the turn in the CEO's real goals + semantic memory (wow #7), so
  // "how is X doing?" is answered from history, not invented. Load the CEO's
  // personalisation (PR6), the assignable team (identity source for
  // assigned_to), and her recent corrections (the training loop).
  const [goalsCtx, memCtx, settings, rosterCtx, corrections] = await Promise.all([
    goalsSnapshot({ brand }),
    memorySnapshot({ user, brand, userText }),
    settingsRepo.get({ user_id: user.user_id }).catch(() => null),
    rosterSnapshot({ brand }),
    correctionsSnapshot({ user }),
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
        roster: rosterCtx.roster,
        rosterTruncated: rosterCtx.truncated,
        corrections,
      }),
    },
    ...(contextBlock ? [{ role: "system", content: contextBlock }] : []),
    ...(wasResting
      ? [
          {
            role: "system",
            content:
              "NOTE: Until now you were offline (feature disabled) and your earlier replies in this conversation were automatic stubs — the CEO's earlier messages were never really answered. You are online now. If her current message is brief or refers back, pick up her most recent substantive request and respond to it fully.",
          },
        ]
      : []),
    ...history,
    { role: "user", content: userText },
  ];

  const { isRead, executeRead } = makeReadHelpers({ byName, brand, auth_header, request_id });

  // Live turn progress → realtime (PR2-D). Best-effort; a phone/desktop that
  // joined user:{id}:goals sees "Reading your goals…", "Queued 4 steps…" instead
  // of a dead spinner during a multi-round build.
  const emitProgress = (phase, extra = {}) => {
    try {
      events.emit("turn.progress", {
        user_id: user.user_id,
        conversation_id: conversation.conversation_id,
        phase,
        ...extra,
      });
    } catch {
      /* best-effort */
    }
  };
  emitProgress("grounding");

  // Bounded multi-round build: reads execute immediately and feed real data
  // back; writes accumulate until the whole narrated plan is emitted — so
  // "goal + milestones + tasks + events + note" actually arrives as one plan.
  const turnStartedAt = Date.now();
  let rounds;
  try {
    rounds = await planRounds.runPlanRounds({
      chat: (msgs) =>
        llmRouter.chatWithFailover({
          capability: "chat",
          messages: msgs,
          tools,
          user,
          brand,
          feature_key: FEATURE,
        }),
      messages,
      isRead,
      executeRead,
      onProgress: (info) => emitProgress("building", info),
    });
  } catch (err) {
    logger.error({ err: err.message }, "cos: llm-router failed — falling back to stub");
    return null;
  }

  for (const completion of rounds.completions) {
    await recordUsageSafe({
      user,
      brand,
      convId: conversation.conversation_id,
      completion,
      ok: true,
    });
  }

  let replyText =
    rounds.content ||
    (rounds.tool_calls.length
      ? "Here's the plan I've put together — review the steps and approve to run them."
      : "Okay.");
  // The model promised action twice and still queued nothing — say so plainly
  // rather than shipping "let me fire it all in now" over an empty turn. The
  // needs_reprompt flag rides back to the UI, which renders a one-tap
  // "Continue" button instead of making the CEO type "go ahead" herself.
  const needsReprompt = !rounds.tool_calls.length && rounds.broken_promise;
  if (needsReprompt) {
    replyText +=
      "\n\n_(Nothing has been queued yet — no steps were proposed. Tap Continue (or say “go ahead”) and I'll lay out the full plan for your approval.)_";
  }

  const last = rounds.completions[rounds.completions.length - 1];
  const totalTokens = rounds.completions.reduce(
    (s, c) => s + ((c.usage && c.usage.total_tokens) || 0),
    0,
  );
  const latencyMs = Date.now() - turnStartedAt;
  emitProgress("finalising");

  // Persistence only — short transaction, no network inside.
  const result = await transaction(async (client) => {
    let plan = null;
    if (rounds.tool_calls.length) {
      const built = await planner.planFromCompletion({
        client,
        completion: { content: rounds.content, tool_calls: rounds.tool_calls },
        byName,
        conversation,
        userMsg,
        user,
        brand,
        complete: rounds.complete,
      });
      if (built) plan = built;
    }

    const assistant = await praxisRepo.insertMessage({
      client,
      m: {
        conversation_id: conversation.conversation_id,
        role: "assistant",
        content: replyText,
        provider: last.vendor,
        model: last.model,
        input_tokens: (last.usage && last.usage.prompt_tokens) || null,
        output_tokens: (last.usage && last.usage.completion_tokens) || null,
      },
    });
    if (plan) {
      // Anchor the card under the reply that proposed it (#5).
      const anchored = await cosRepo.setPlanAnchor({
        client,
        id: plan.plan.plan_id,
        message_id: assistant.message_id,
      });
      if (anchored) plan.plan = anchored;
    }
    await praxisRepo.touchConversation({
      client,
      id: conversation.conversation_id,
      tokens: totalTokens,
    });
    return { assistant_message: assistant, plan, needs_reprompt: needsReprompt };
  });

  // Best-effort turn trace (metadata only — no message content). Written AFTER
  // the transaction commits so a trace hiccup can never roll back the reply.
  try {
    await traceRepo.insertTrace({
      t: {
        conversation_id: conversation.conversation_id,
        message_id: result.assistant_message.message_id,
        user_id: user.user_id,
        business: brand,
        outcome: result.plan ? "plan" : result.needs_reprompt ? "reprompt" : "chat",
        rounds: rounds.completions.length,
        tool_calls: rounds.tool_calls.length,
        reads: rounds.reads || 0,
        vendors: [...new Set(rounds.completions.map((c) => c.vendor).filter(Boolean))],
        models: [...new Set(rounds.completions.map((c) => c.model).filter(Boolean))],
        input_tokens: rounds.completions.reduce((s, c) => s + ((c.usage && c.usage.prompt_tokens) || 0), 0),
        output_tokens: rounds.completions.reduce((s, c) => s + ((c.usage && c.usage.completion_tokens) || 0), 0),
        total_tokens: totalTokens,
        latency_ms: latencyMs,
        plan_id: result.plan ? result.plan.plan.plan_id : null,
      },
    });
  } catch (err) {
    logger.debug({ err: err.message }, "cos: turn trace insert failed");
  }
  return result;
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

async function postMessage({ user, brand, request_id, id, input, auth_header }) {
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

  // Transaction split (#13): the user's message commits in its own short
  // transaction BEFORE any LLM work, so a slow vendor chain never pins a
  // pooled connection and a mid-turn crash can no longer lose what the CEO
  // typed. runTurn opens a second short transaction for the reply + plan.
  const userMsg = await transaction(async (client) => {
    const m = await praxisRepo.insertMessage({
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
    return m;
  });

  let assistantMsg = null;
  let plan = null;
  let needsReprompt = false;
  if (guard.ok) {
    try {
      const r = await runTurn({
        user,
        brand,
        conversation: conv,
        userMsg,
        userText,
        auth_header,
        request_id,
      });
      if (r) {
        assistantMsg = r.assistant_message;
        plan = r.plan;
        needsReprompt = !!r.needs_reprompt;
      }
    } catch (err) {
      logger.error({ err: err.message }, "cos turn failed — falling back to stub");
    }
  }

  if (!assistantMsg) {
    assistantMsg = await transaction(async (client) => {
      const m = await praxisRepo.insertMessage({
        client,
        m: { conversation_id: id, role: "assistant", content: stubReply(guard) },
      });
      await praxisRepo.touchConversation({ client, id });
      return m;
    });
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
    for (const supersededId of plan.superseded || []) {
      events.emit("plan.resolved", {
        plan_id: supersededId,
        user_id: user.user_id,
        status: "cancelled",
      });
    }
  }
  // A response that stopped short always carries a machine-readable way to
  // pick up where it ended, so the UI can offer one-tap continuation:
  //   - reprompt: the model promised action but queued nothing → the button
  //     re-sends a canned "go ahead" for the CEO.
  //   - continue_plan: the plan persisted incomplete (round/step budget) →
  //     the plan card's "Continue building" targets POST /plans/:id/continue.
  let continuation = null;
  if (needsReprompt) {
    continuation = {
      kind: "reprompt",
      label: "Continue",
      suggested_reply:
        "Go ahead — continue exactly where you left off and queue every remaining step.",
    };
  } else if (plan && plan.plan.is_complete === false) {
    continuation = {
      kind: "continue_plan",
      label: "Continue building",
      plan_id: plan.plan.plan_id,
    };
  }

  return {
    user_message: userMsg,
    assistant_message: assistantMsg,
    plan: plan ? { ...plan.plan, steps: plan.steps } : null,
    continuation,
  };
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

/**
 * Resume building a truncated plan (is_complete=false): another bounded round
 * loop appends the owed steps to the SAME plan. LLM calls run OUTSIDE the DB
 * transaction; only the append is transactional. Idempotent-friendly — a plan
 * already marked complete returns as-is with no model call.
 */
async function continuePlan({ user, brand, request_id, id, auth_header }) {
  const plan = await cosRepo.findPlan({ id });
  if (!plan || plan.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Plan");
  if (plan.status !== "proposed")
    throw new AppError(
      "BAD_STATE",
      `Plan is ${plan.status} — only a proposed plan can keep building`,
      422,
      { user_message: "This plan can no longer be extended — ask me to re-plan instead." },
    );
  if (new Date(plan.expires_at) < new Date()) {
    await cosRepo.setPlanStatus({ id, status: "expired" });
    events.emit("plan.resolved", { plan_id: id, user_id: user.user_id, status: "expired" });
    throw new AppError("EXPIRED", "This plan has expired — ask me to re-plan.", 410);
  }

  const existing = await cosRepo.listPlanSteps({ plan_id: id });
  if (plan.is_complete) return { ...plan, steps: existing };

  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE,
    is_ceo: user.is_ceo,
    business: brand,
  });
  if (!guard.ok) {
    throw new AppError("AI_UNAVAILABLE", stubReply(guard), 409, {
      user_message: stubReply(guard),
    });
  }

  const conversation = await praxisRepo.findConversation({ id: plan.conversation_id });
  if (!conversation || conversation.user_id !== user.user_id)
    throw new NotFoundError("Conversation");

  const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
  const { tools, byName } = buildTools(actions);
  if (!tools.length)
    throw new AppError("AI_UNAVAILABLE", "No workspace actions are enabled.", 409, {
      user_message: "No workspace actions are enabled right now — check AI Control.",
    });

  const prior = await praxisRepo.listMessages({ conversation_id: plan.conversation_id });
  const history = prior
    .filter(
      (m) => m.role === "user" || (m.role === "assistant" && !isStubText(m.content)),
    )
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: (m.content || "").slice(0, HISTORY_MSG_MAX_CHARS) }));

  const [settings, rosterCtx, corrections] = await Promise.all([
    settingsRepo.get({ user_id: user.user_id }).catch(() => null),
    rosterSnapshot({ brand }),
    correctionsSnapshot({ user }),
  ]);
  const queued = existing
    .map((s) => `${s.plan_step}. ${s.human_summary || s.action_key}`)
    .join("\n");
  const messages = [
    {
      role: "system",
      content: persona.systemPrompt({
        brand,
        user,
        settings,
        actionTitles: actions.map((a) => a.title),
        roster: rosterCtx.roster,
        rosterTruncated: rosterCtx.truncated,
        corrections,
      }),
    },
    ...history,
    {
      role: "user",
      content:
        `Continue building the plan titled “${plan.title}”. Steps already queued (keep their numbering for {{step:N.field}} tokens):\n` +
        `${queued}\n\n` +
        `Emit ONLY the remaining steps as tool calls, continuing from step ${existing.length}. ` +
        "Never repeat a queued step. If nothing is missing, reply with exactly DONE and no tool calls.",
    },
  ];

  const { isRead, executeRead } = makeReadHelpers({ byName, brand, auth_header, request_id });
  const rounds = await planRounds.runPlanRounds({
    chat: (msgs) =>
      llmRouter.chatWithFailover({
        capability: "chat",
        messages: msgs,
        tools,
        user,
        brand,
        feature_key: FEATURE,
      }),
    messages,
    stepOffset: existing.length,
    detectFromContent: false,
    isRead,
    executeRead,
  });
  for (const completion of rounds.completions) {
    await recordUsageSafe({ user, brand, convId: plan.conversation_id, completion, ok: true });
  }

  const built = planner.buildSteps({ toolCalls: rounds.tool_calls, byName });
  const updated = await transaction(async (client) => {
    if (built.length) {
      await planner.persistSteps({
        client,
        plan_id: id,
        conversation_id: plan.conversation_id,
        message_id: null,
        user,
        brand,
        steps: built,
        startIndex: existing.length,
      });
    }
    return cosRepo.setPlanBuildState({ client, id, is_complete: rounds.complete });
  });

  await audit({
    business: plan.business,
    user_id: user.user_id,
    action_key: "cos.plan.continue",
    target_type: "ai_pending_plan",
    target_id: id,
    after: { steps_added: built.length, is_complete: rounds.complete },
    request_id,
  });

  const steps = await cosRepo.listPlanSteps({ plan_id: id });
  return { ...updated, steps };
}

/**
 * Edit a step's payload while it can still change — during review before
 * approval ('proposed'), or after a step failure ('partially_failed', e.g.
 * rename a duplicate goal title, then "Retry remaining"). The summary is
 * regenerated so the card reflects the edit.
 */
const STEP_EDITABLE_PLAN_STATES = ["proposed", "partially_failed"];

async function updatePlanStep({ user, request_id, planId, stepId, payload }) {
  const plan = await cosRepo.findPlan({ id: planId });
  if (!plan || plan.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Plan");
  if (!STEP_EDITABLE_PLAN_STATES.includes(plan.status))
    throw new AppError(
      "BAD_STATE",
      `Plan is ${plan.status} — steps are only editable while the plan is proposed or after a step failure`,
      422,
      { user_message: "This plan is already running or resolved — its steps can't be edited." },
    );

  const steps = await cosRepo.listPlanSteps({ plan_id: planId });
  const step = steps.find((s) => s.pending_id === stepId);
  if (!step) throw new NotFoundError("Plan step");

  const actions = await governance.listActions({ ai_enabled: true, surface: "workspace" });
  const action =
    actions.find((a) => a.action_key === step.action_key) || { title: step.action_key };
  const human_summary = planner.summariseStep(action, payload);

  const updated = await cosRepo.updateStepPayload({
    id: stepId,
    plan_id: planId,
    payload,
    human_summary,
  });
  if (!updated)
    throw new AppError(
      "BAD_STATE",
      "Step is no longer editable (already confirmed or executed)",
      422,
      { user_message: "That step already ran — it can't be edited any more." },
    );

  await audit({
    business: plan.business,
    user_id: user.user_id,
    action_key: "cos.plan.step.update",
    target_type: "ai_pending_action",
    target_id: stepId,
    after: { payload, human_summary },
    request_id,
  });

  const refreshed = await cosRepo.listPlanSteps({ plan_id: planId });
  return { ...plan, steps: refreshed };
}

// ── Save conversation to Workspace Notes ──────────────────
//
// Produces a Markdown recap of the current thread and upserts it into
// shared.workspace_notes with source='cos' + source_conversation_id.
// Re-summarising updates the same row (migration 000329 enforces this via a
// partial unique index). Overwrite is deliberate — the confirmed policy is
// "CoS summary wins" even when the user has hand-edited the note in between.

const NOTE_SAVE_HISTORY_TURNS = 40;
const NOTE_SUMMARY_TEMPERATURE = 0.2;
const NOTE_TITLE_MAX = 80;

const NOTE_SYSTEM_PROMPT = [
  "You are the Chief of Staff writing a personal note for the CEO.",
  "Distil the conversation into a keepsake that will make sense weeks later.",
  "",
  "Return your response using EXACTLY this shape and nothing else:",
  "",
  "### TITLE",
  "<one short title, plain text, no quotes, under 80 characters>",
  "",
  "### BODY",
  "<Markdown body>",
  "",
  "The BODY MUST use Markdown with these sections (skip any that would be empty):",
  "  ## Overview",
  "  ## Decisions",
  "  ## Next steps",
  "  ## Open questions",
  "",
  "Rules:",
  "  - Write in the CEO's voice ('I …'), not the assistant's.",
  "  - Be concrete — dates, names, numbers over adjectives.",
  "  - Use dash bullets ('- ') for lists, not numbered lists.",
  "  - No preamble, no closing pleasantries, no code fences.",
].join("\n");

function buildConversationTranscript(messages) {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-NOTE_SAVE_HISTORY_TURNS)
    .map((m) => {
      const who = m.role === "user" ? "CEO" : "Chief of Staff";
      const text = (m.content || m.transcribed_text || "").trim();
      return text ? `${who}: ${text}` : null;
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Split the model's response into { title, body }. Falls back to sensible
 * defaults if the model ignores the shape — a saved note is better than a
 * hard failure the CEO has to re-summarise their way out of.
 */
function parseNoteResponse(raw) {
  const text = String(raw || "").trim();
  const bodyMatch = /###\s*BODY\s*\n([\s\S]*)$/i.exec(text);
  const body = bodyMatch ? bodyMatch[1].trim() : text;
  // Title = the first non-empty line after the TITLE marker. Guard against an
  // empty TITLE section, where the capture would otherwise grab the BODY
  // marker (or the body's first heading) as the title.
  const titleMatch = /###\s*TITLE\s*\n+([^\n]+)/i.exec(text);
  let title = titleMatch ? titleMatch[1].trim() : "";
  if (title.startsWith("#")) title = "";
  title = title.replace(/^["'`]+|["'`]+$/g, "").slice(0, NOTE_TITLE_MAX);
  if (!title) title = "Chief of Staff note";
  return { title, body };
}

async function saveConversationAsNote({ user, brand, request_id, id }) {
  const conv = await praxisRepo.findConversation({ id });
  if (!conv || conv.user_id !== user.user_id || conv.kind !== KIND)
    throw new NotFoundError("Conversation");

  const messages = await praxisRepo.listMessages({ conversation_id: id });
  const transcript = buildConversationTranscript(messages);
  if (!transcript) {
    throw new AppError(
      "COS_NOTE_EMPTY",
      "There's nothing in this conversation to save yet.",
      422,
      { user_message: "Say something first — then I can save it to Notes." },
    );
  }

  // Governance guard reuses the CoS chat budget/flag — a note write is a chat
  // completion in disguise, so it belongs to the same envelope.
  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE,
    is_ceo: user.is_ceo,
    business: brand,
  });
  if (!guard.ok) {
    throw new AppError("AI_UNAVAILABLE", stubReply(guard), 409, {
      user_message: stubReply(guard),
    });
  }

  let completion;
  try {
    completion = await llmRouter.chatWithFailover({
      capability: "chat",
      messages: [
        { role: "system", content: NOTE_SYSTEM_PROMPT },
        { role: "user", content: transcript },
      ],
      user,
      brand,
      feature_key: FEATURE,
      temperature: NOTE_SUMMARY_TEMPERATURE,
    });
  } catch (err) {
    logger.error(
      { err: err.message, conversation_id: id },
      "cos: save-note llm-router failed",
    );
    throw new AppError(
      "AI_UNAVAILABLE",
      "Couldn't reach the AI to summarise this conversation.",
      503,
      { user_message: "Couldn't reach the AI just now — try again in a moment." },
    );
  }

  await recordUsageSafe({ user, brand, convId: id, completion, ok: true });
  const { title, body } = parseNoteResponse(completion.content);

  const { note, action } = await notesRepo.upsertCosNote({
    business: brand,
    user_id: user.user_id,
    conversation_id: id,
    title,
    body,
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: action === "created" ? "cos.note.create" : "cos.note.update",
    target_type: "workspace_note",
    target_id: note.note_id,
    request_id,
  });

  return { note, action };
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
  continuePlan,
  updatePlanStep,
  saveConversationAsNote,
  listWorkspaceActions,
  // internals exposed for tests
  buildTools,
  runTurn,
  parseNoteResponse,
};
