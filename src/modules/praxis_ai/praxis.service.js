/**
 * Praxis AI Agent (V2.2 §6.29) — business logic.
 *
 * Conversation + message exchange, and the safety-critical pending-action
 * gate: Praxis reads freely but every WRITE it proposes is materialised as a
 * pending action that a human must confirm before it executes. Connections:
 *   - AI Governance gates every turn (canUseFeature) + records usage.
 *   - The action catalogue (ai_enabled) is Praxis's allowlist.
 *   - Live LLM orchestration (intent → action match → draft) is performed by
 *     the agent runtime in src/ai (vendor-credential dependent); here it is a
 *     clearly-marked stub so the data + approval flow is complete and testable.
 */

"use strict";

const repo = require("./praxis.repo");
const events = require("./praxis.events");
const governance = require("../ai_governance/governance.service");
const orchestrator = require("./praxis.orchestrator");
const executor = require("./praxis.executor");
const transcription = require("../../services/transcription.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");

const FEATURE = "praxis_chat";

// ── Conversations ──────────────────────────────────────────
function listConversations({ user }) {
  return repo.listConversations({ user_id: user.user_id });
}
async function getConversation({ user, id }) {
  const conv = await repo.findConversation({ id });
  if (!conv || conv.user_id !== user.user_id)
    throw new NotFoundError("Conversation");
  const [messages, pending] = await Promise.all([
    repo.listMessages({ conversation_id: id }),
    repo.listPendingActions({ conversation_id: id }),
  ]);
  return { ...conv, messages, pending_actions: pending };
}
async function createConversation({ user, brand, request_id, input }) {
  const conv = await repo.createConversation({
    c: {
      user_id: user.user_id,
      business: brand,
      title: input.title,
      is_voice_started: input.is_voice_started,
    },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "praxis.conversation.create",
    target_type: "ai_conversation",
    target_id: conv.conversation_id,
    request_id,
  });
  return conv;
}
async function archiveConversation({ user, id }) {
  const ok = await repo.archiveConversation({ id, user_id: user.user_id });
  if (!ok) throw new NotFoundError("Conversation");
}

/**
 * Post a user message and get Praxis's reply. The live model call is the agent
 * runtime's job (src/ai); this returns a graceful placeholder turn while
 * keeping the conversation + usage flow intact. A real orchestrator would,
 * for write intents, create an ai_pending_actions row instead of answering.
 */
async function postMessage({ user, brand, request_id, id, input }) {
  const conv = await repo.findConversation({ id });
  if (!conv || conv.user_id !== user.user_id)
    throw new NotFoundError("Conversation");

  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE,
    is_ceo: user.is_ceo,
  });
  if (!guard.ok)
    throw new AppError(
      "AI_UNAVAILABLE",
      `Praxis is unavailable: ${guard.reason}`,
      403,
    );

  // Voice input (§6.29): transcribe the audio to text up front — outside the DB
  // transaction, since it's a network call — when the client sent a trusted
  // audio URL but no transcript. No-ops to null when STT isn't configured.
  let transcribed_text = input.transcribed_text || null;
  if (!transcribed_text && input.source_audio_url) {
    transcribed_text = await transcription.transcribe({
      audioUrl: input.source_audio_url,
    });
  }

  return transaction(async (client) => {
    const userMsg = await repo.insertMessage({
      client,
      m: {
        conversation_id: id,
        role: "user",
        input_mode: input.input_mode || "text",
        transcribed_text,
        source_audio_url: input.source_audio_url || null,
        content: input.content,
      },
    });
    await repo.touchConversation({ client, id });

    // ── Live orchestrator (X-2) ──
    // When enabled AND an LLM vendor is configured in AI Control, run the real
    // turn: RAG retrieve → model (with the ai_enabled action allowlist as
    // tools) → propose a pending action for writes / answer reads, recording
    // trace + usage. Otherwise (flag off or no vendor) reply with the graceful
    // stub so the data + approval flow stays intact.
    let assistantMsg = null;
    let pending_action = null;
    if (config.PRAXIS_ORCHESTRATOR_ENABLED) {
      try {
        const result = await orchestrator.orchestrate({
          client,
          user,
          brand,
          conversation: conv,
          userMsg,
        });
        if (result) {
          assistantMsg = result.assistant_message;
          pending_action = result.pending_action || null;
        }
      } catch (err) {
        logger.error(
          { err: err.message },
          "praxis orchestrator failed — falling back to stub",
        );
      }
    }

    if (!assistantMsg) {
      const replyText =
        "Praxis received your message. Live AI orchestration is not yet " +
        "connected in this environment; once an AI vendor is configured in AI " +
        "Control, replies and confirm-to-run actions will appear here.";
      assistantMsg = await repo.insertMessage({
        client,
        m: { conversation_id: id, role: "assistant", content: replyText },
      });
      await repo.touchConversation({ client, id });
      try {
        await governance.recordUsage({
          usage: {
            user_id: user.user_id,
            feature_key: FEATURE,
            business: brand,
            conversation_id: id,
            provider: conv.provider || "stub",
            model: "stub",
            call_type: "chat_completion",
            input_tokens: 0,
            output_tokens: 0,
            total_tokens: 0,
            cost_native: 0,
            cost_ngn: 0,
            was_successful: true,
          },
        });
      } catch (err) {
        logger.error({ err: err.message }, "praxis: usage record failed");
      }
    }

    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "praxis.message.post",
      target_type: "ai_conversation",
      target_id: id,
      request_id,
    });
    // Realtime: let every open tab's Praxis surface show the new confirm
    // card immediately (relay → user:{id}:ai_pending). Thin payload — the
    // client re-queries for the full row.
    if (pending_action) {
      events.emit("pending.created", {
        pending_id: pending_action.pending_id,
        user_id: user.user_id,
        conversation_id: id,
      });
    }
    return {
      user_message: userMsg,
      assistant_message: assistantMsg,
      pending_action,
    };
  });
}

// ── Pending actions (human-in-the-loop gate) ───────────────
function listPendingActions({ user, status }) {
  return repo.listPendingActions({ user_id: user.user_id, status });
}
async function getPendingAction({ user, id }) {
  const p = await repo.findPendingAction({ id });
  if (!p || p.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Pending action");
  return p;
}
/**
 * Confirm a proposed action. This flips it to 'confirmed' and emits the event
 * the agent runtime listens for to execute the underlying catalogued API call;
 * the runtime then calls markExecuted/markFailed. Execution NEVER happens
 * without this explicit human confirmation (V2.2 §6.29 safety gate).
 */
async function confirmAction({ user, request_id, id, auth_header }) {
  const p = await repo.findPendingAction({ id });
  if (!p || p.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Pending action");
  if (p.status !== "proposed")
    throw new AppError("BAD_STATE", `Action is ${p.status}, not proposed`, 422);
  if (new Date(p.expires_at) < new Date()) {
    await repo.setPendingStatus({ id, status: "expired" });
    events.emit("pending.resolved", {
      pending_id: id,
      user_id: user.user_id,
      status: "expired",
    });
    throw new AppError("EXPIRED", "This proposed action has expired", 410);
  }
  await repo.setPendingStatus({
    id,
    status: "confirmed",
    fields: {
      confirmed_by_user_id: user.user_id,
      confirmed_at: new Date().toISOString(),
    },
  });
  await audit({
    business: p.business,
    user_id: user.user_id,
    action_key: "praxis.action.confirm",
    target_type: "ai_pending_action",
    target_id: id,
    after: { action_key: p.action_key },
    request_id,
  });
  events.emit("action.confirmed", {
    pending_id: id,
    action_key: p.action_key,
    business: p.business,
  });

  // ── Execute (the wiring the spec promises) ────────────────
  // The confirmed action now RUNS: the executor calls the real catalogued
  // endpoint over loopback with the confirming user's own Authorization
  // header, so auth/brand/RBAC/validation/audit all re-apply. Success →
  // 'executed' with the trimmed result; any failure → 'failed' with the
  // endpoint's error, never a half-updated state.
  let updated;
  try {
    const exec = await executor.executeAction({
      pending: p,
      authHeader: auth_header,
      requestId: request_id,
    });
    if (exec.ok) {
      updated = await markExecuted({ id, execution_result: exec.result });
    } else {
      updated = await markFailed({
        id,
        execution_error: JSON.stringify(exec.result).slice(0, 2000),
      });
    }
  } catch (err) {
    logger.error(
      { err: err.message, pending_id: id, action_key: p.action_key },
      "praxis action execution failed",
    );
    updated = await markFailed({
      id,
      execution_error: String(err.user_message || err.message).slice(0, 2000),
    });
  }
  events.emit("pending.resolved", {
    pending_id: id,
    user_id: user.user_id,
    status: updated.status,
  });
  return updated;
}
async function rejectAction({ user, request_id, id, reason }) {
  const p = await repo.findPendingAction({ id });
  if (!p || p.proposed_by_user_id !== user.user_id)
    throw new NotFoundError("Pending action");
  if (p.status !== "proposed")
    throw new AppError("BAD_STATE", `Action is ${p.status}`, 422);
  const updated = await repo.setPendingStatus({
    id,
    status: "rejected",
    fields: {
      rejected_at: new Date().toISOString(),
      rejection_reason: reason || null,
    },
  });
  await audit({
    business: p.business,
    user_id: user.user_id,
    action_key: "praxis.action.reject",
    target_type: "ai_pending_action",
    target_id: id,
    request_id,
  });
  events.emit("pending.resolved", {
    pending_id: id,
    user_id: user.user_id,
    status: "rejected",
  });
  return updated;
}
/** Called by the agent runtime after it executes a confirmed action. */
async function markExecuted({ id, execution_result, audit_log_id }) {
  return repo.setPendingStatus({
    id,
    status: "executed",
    fields: {
      executed_at: new Date().toISOString(),
      execution_result: execution_result || null,
      audit_log_id: audit_log_id || null,
    },
  });
}
async function markFailed({ id, execution_error }) {
  return repo.setPendingStatus({
    id,
    status: "failed",
    fields: {
      executed_at: new Date().toISOString(),
      execution_error: execution_error || null,
    },
  });
}

// ── Trace + action catalogue (read) ────────────────────────
function listRunSteps({ conversation_id }) {
  return repo.listRunSteps({ conversation_id });
}
/** The agent's allowlist: catalogue entries Praxis is permitted to use. */
function listEnabledActions(args) {
  return governance.listActions({ ...args, ai_enabled: true });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  archiveConversation,
  postMessage,
  listPendingActions,
  getPendingAction,
  confirmAction,
  rejectAction,
  markExecuted,
  markFailed,
  listRunSteps,
  listEnabledActions,
};
