/**
 * Chief of Staff — feedback service (Phase 1: the training loop).
 *
 * The CEO rates a reply 👍/👎; a 👎 can carry a correction. The signal is stored
 * on shared.ai_message_feedback, and a correction becomes durable CoS memory
 * (owner-scoped, restricted) AND — via recentCorrections in the persona — a
 * standing instruction the very next turn respects. Ownership is enforced: only
 * the CEO's own CoS assistant replies can be rated.
 */

"use strict";

const praxisRepo = require("../praxis_ai/praxis.repo");
const feedbackRepo = require("./cos.feedback.repo");
const memory = require("./cos.memory");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { AppError, NotFoundError } = require("../../utils/errors");

const KIND = "chief_of_staff";

async function recordFeedback({ user, brand, request_id, message_id, rating, comment }) {
  const msg = await praxisRepo.findMessage({ id: message_id });
  if (!msg) throw new NotFoundError("Message");

  const conv = await praxisRepo.findConversation({ id: msg.conversation_id });
  if (!conv || conv.user_id !== user.user_id || conv.kind !== KIND)
    throw new NotFoundError("Message");

  if (msg.role !== "assistant")
    throw new AppError(
      "COS_FEEDBACK_TARGET",
      "Only the assistant's replies can be rated.",
      422,
      { user_message: "You can only rate the Chief of Staff's replies." },
    );

  const trimmed = comment && comment.trim() ? comment.trim() : null;

  // A 👎 with a correction becomes durable, owner-scoped memory + a standing
  // instruction. Best-effort: a memory hiccup must not lose the rating signal.
  let taught_chunk_id = null;
  if (rating === "down" && trimmed) {
    try {
      taught_chunk_id = await memory.indexCorrection({
        message_id,
        text: trimmed,
        user_id: user.user_id,
        brand,
      });
    } catch (err) {
      logger.warn({ err: err.message, message_id }, "cos feedback: correction index failed");
    }
  }

  await feedbackRepo.upsertFeedback({
    message_id,
    conversation_id: msg.conversation_id,
    user_id: user.user_id,
    rating,
    comment: trimmed,
    taught_chunk_id,
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "cos.message.feedback",
    target_type: "ai_message",
    target_id: message_id,
    after: { rating, taught: Boolean(trimmed) },
    request_id,
  });

  // "learned" is true whenever a correction was captured — it reaches the next
  // turn via recentCorrections even if no embeddings vendor is configured.
  return { ok: true, rating, learned: rating === "down" && Boolean(trimmed) };
}

module.exports = { recordFeedback };
