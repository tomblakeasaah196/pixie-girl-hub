/**
 * Praxis AI Agent (V2.2 §6.29) — HTTP controller.
 */

"use strict";

const service = require("./praxis.service");
const learning = require("./learning.service");
const transcription = require("../../services/transcription.service");
const { AppError } = require("../../utils/errors");

const base = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

// Conversations
async function listConversations(req, res) {
  res.json({ data: await service.listConversations({ user: req.user }) });
}
async function getConversation(req, res) {
  res.json({
    data: await service.getConversation({ user: req.user, id: req.params.id }),
  });
}
async function createConversation(req, res) {
  res.status(201).json({
    data: await service.createConversation({ ...base(req), input: req.body }),
  });
}
async function archiveConversation(req, res) {
  await service.archiveConversation({ user: req.user, id: req.params.id });
  res.status(204).end();
}
async function postMessage(req, res) {
  res.status(201).json({
    data: await service.postMessage({
      ...base(req),
      id: req.params.id,
      input: req.body,
      // Threaded through to the orchestrator so read-safe catalogue actions
      // can execute inline over loopback with the caller's own credentials.
      auth_header: req.headers.authorization,
    }),
  });
}
async function listRunSteps(req, res) {
  res.json({
    data: await service.listRunSteps({ conversation_id: req.params.id }),
  });
}

// Pending actions
async function listPendingActions(req, res) {
  res.json({
    data: await service.listPendingActions({
      user: req.user,
      status: req.query.status,
    }),
  });
}
async function getPendingAction(req, res) {
  res.json({
    data: await service.getPendingAction({ user: req.user, id: req.params.id }),
  });
}
async function confirmAction(req, res) {
  res.json({
    data: await service.confirmAction({
      ...base(req),
      id: req.params.id,
      // The executor re-enters the API over loopback AS this user — full
      // auth/RBAC/validation re-apply on the real endpoint (§6.29).
      auth_header: req.headers.authorization,
    }),
  });
}
async function rejectAction(req, res) {
  res.json({
    data: await service.rejectAction({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
}

// Action catalogue (allowlist)
async function listActions(req, res) {
  res.json({
    data: await service.listEnabledActions({
      module: req.query.module,
      category: req.query.category,
    }),
  });
}

// Self-learning
async function teach(req, res) {
  res.status(201).json({
    data: await learning.teach({
      ...base(req),
      title: req.body.title,
      content: req.body.content,
    }),
  });
}
async function recordFeedback(req, res) {
  res.json({
    data: await learning.recordFeedback({
      ...base(req),
      message_id: req.params.id,
      conversation_id: req.body.conversation_id,
      rating: req.body.rating,
      comment: req.body.comment,
    }),
  });
}

// Voice transcription (§6.29) — the composer records a clip and sends it
// here; server-side Whisper (groq vendor from AI Control, .env fallback) is
// the primary path, the browser's Web Speech API the client-side fallback.
async function transcribeStatus(req, res) {
  res.json({ data: { available: await transcription.isAvailable() } });
}
async function transcribeAudio(req, res) {
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    throw new AppError("VALIDATION_ERROR", "No audio file uploaded.", 400, {
      user_message: "No audio was recorded — try again.",
    });
  }
  const result = await transcription.transcribeBuffer({
    buffer: req.file.buffer,
    contentType: req.file.mimetype,
    filename: req.file.originalname,
  });
  if (!result) {
    // Unconfigured vendor, exhausted quota, or provider outage — the client
    // treats this as "switch the mic to browser recognition".
    throw new AppError(
      "TRANSCRIPTION_UNAVAILABLE",
      "Server-side transcription is unavailable.",
      503,
      {
        user_message:
          "Transcription is unavailable right now — the mic will use your browser's recognition instead.",
      },
    );
  }
  res.json({ data: result });
}

// Training material (uploads)
async function uploadTraining(req, res) {
  res.status(201).json({
    data: await learning.ingestUpload({
      ...base(req),
      file: req.file,
      title: req.body.title,
      note: req.body.note,
    }),
  });
}
async function listTraining(req, res) {
  res.json({ data: await learning.listTrainingSources({ brand: req.brand }) });
}
async function deleteTraining(req, res) {
  res.json({
    data: await learning.deleteTrainingSource({
      ...base(req),
      source_id: req.params.id,
    }),
  });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  archiveConversation,
  postMessage,
  listRunSteps,
  listPendingActions,
  getPendingAction,
  confirmAction,
  rejectAction,
  listActions,
  transcribeStatus,
  transcribeAudio,
  teach,
  recordFeedback,
  uploadTraining,
  listTraining,
  deleteTraining,
};
