/**
 * Chief of Staff (PR3) — HTTP controller. Thin req/res only.
 */

"use strict";

const service = require("./cos.service");
const feedback = require("./cos.feedback.service");
const followups = require("./cos.followups.service");
const meeting = require("./cos.meeting");
const scheduler = require("./cos.scheduler");
const templates = require("./cos.templates");
const overview = require("./cos.overview");
const settings = require("./cos.settings.service");
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
async function saveConversationToNote(req, res) {
  const result = await service.saveConversationAsNote({
    ...base(req),
    id: req.params.id,
  });
  res.status(result.action === "created" ? 201 : 200).json({ data: result });
}
async function postMessage(req, res) {
  res.status(201).json({
    data: await service.postMessage({
      ...base(req),
      id: req.params.id,
      input: req.body,
      // Threaded to the plan executor: it re-enters the API over loopback AS
      // this user, so auth/brand/RBAC/validation re-apply on every step.
      auth_header: req.headers.authorization,
    }),
  });
}

// Feedback on a reply (training loop). message_id is on the path; the
// conversation is derived + ownership-checked server-side.
async function recordFeedback(req, res) {
  res.json({
    data: await feedback.recordFeedback({
      ...base(req),
      message_id: req.params.messageId,
      rating: req.body.rating,
      comment: req.body.comment,
    }),
  });
}

// Plans (batch-plan confirm gate)
async function getPlan(req, res) {
  res.json({
    data: await service.getPlan({ user: req.user, id: req.params.planId }),
  });
}
async function confirmPlan(req, res) {
  // 202: execution happens on the worker (cos-plan-exec queue); the response
  // carries the plan in 'executing' state and completion arrives over the
  // cos_plan:executed realtime push.
  res.status(202).json({
    data: await service.confirmPlan({
      ...base(req),
      id: req.params.planId,
    }),
  });
}
async function rejectPlan(req, res) {
  res.json({
    data: await service.rejectPlan({
      ...base(req),
      id: req.params.planId,
      reason: req.body.reason,
    }),
  });
}
async function continuePlan(req, res) {
  res.json({
    data: await service.continuePlan({
      ...base(req),
      id: req.params.planId,
      // Read tools execute over loopback AS this user during the build.
      auth_header: req.headers.authorization,
    }),
  });
}
async function updatePlanStep(req, res) {
  res.json({
    data: await service.updatePlanStep({
      ...base(req),
      planId: req.params.planId,
      stepId: req.params.stepId,
      payload: req.body.payload,
    }),
  });
}

// Follow-ups (accountability state machine)
async function listFollowups(req, res) {
  res.json({
    data: await followups.listOpen({
      user: req.user,
      subject_type: req.query.subject_type,
      subject_id: req.query.subject_id,
    }),
  });
}
async function respondFollowup(req, res) {
  res.json({
    data: await followups.respond({
      ...base(req),
      id: req.params.id,
      answer: req.body.answer,
      auth_header: req.headers.authorization,
    }),
  });
}
async function reasonFollowup(req, res) {
  res.json({
    data: await followups.reason({
      ...base(req),
      id: req.params.id,
      reason: req.body.reason,
    }),
  });
}
async function actFollowup(req, res) {
  res.json({
    data: await followups.act({
      ...base(req),
      id: req.params.id,
      action: req.body.action,
      auth_header: req.headers.authorization,
    }),
  });
}
async function snoozeFollowup(req, res) {
  res.json({
    data: await followups.snooze({
      ...base(req),
      id: req.params.id,
      until: req.body.until,
    }),
  });
}
async function dismissFollowup(req, res) {
  res.json({
    data: await followups.dismiss({ ...base(req), id: req.params.id }),
  });
}

// ── Intelligence (PR5) ─────────────────────────────────────
// Meeting prep brief for a calendar event.
async function getPrep(req, res) {
  res.json({
    data: await meeting.prep({
      user: req.user,
      brand: req.brand,
      event_id: req.params.eventId,
    }),
  });
}

// Smart scheduling.
async function findFocus(req, res) {
  res.json({
    data: await scheduler.findFocus({
      user: req.user,
      brand: req.brand,
      duration: req.body.duration,
      within: req.body.within,
    }),
  });
}
async function scheduleLoad(req, res) {
  res.json({
    data: await scheduler.load({
      user: req.user,
      brand: req.brand,
      date: req.query.date,
    }),
  });
}
async function batchReschedule(req, res) {
  res.json({
    data: await scheduler.batchReschedule({
      user: req.user,
      brand: req.brand,
      match: req.body.match,
      days: req.body.days,
    }),
  });
}

// Cross-brand overview (CEO-only; the router guard already enforces requireCeo).
async function crossBrandOverview(req, res) {
  res.json({ data: await overview.crossBrand({ user: req.user }) });
}

// Playbook templates.
async function listTemplates(req, res) {
  res.json({ data: await templates.list({ user: req.user }) });
}
async function saveTemplate(req, res) {
  res.status(201).json({
    data: await templates.saveFromGoal({
      ...base(req),
      goal_id: req.body.goal_id,
      name: req.body.name,
      description: req.body.description,
    }),
  });
}
async function instantiateTemplate(req, res) {
  res.status(201).json({
    data: await templates.instantiate({
      ...base(req),
      template_id: req.params.id,
      start_date: req.body.start_date,
      name: req.body.name,
    }),
  });
}

// ── Settings / personalisation (PR6) ───────────────────────
async function getSettings(req, res) {
  res.json({ data: await settings.get({ user: req.user }) });
}
async function updateSettings(req, res) {
  res.json({
    data: await settings.update({ ...base(req), patch: req.body }),
  });
}
async function uploadSettingsAvatar(req, res) {
  if (!req.file || !req.file.buffer) {
    throw new AppError("NO_FILE", "No image file was uploaded.", 400, {
      user_message: "Choose an image to upload.",
    });
  }
  res.json({
    data: await settings.uploadAvatar({
      ...base(req),
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
    }),
  });
}

module.exports = {
  listConversations,
  getConversation,
  createConversation,
  archiveConversation,
  postMessage,
  saveConversationToNote,
  recordFeedback,
  getPlan,
  confirmPlan,
  rejectPlan,
  continuePlan,
  updatePlanStep,
  listFollowups,
  respondFollowup,
  reasonFollowup,
  actFollowup,
  snoozeFollowup,
  dismissFollowup,
  // intelligence (PR5)
  getPrep,
  findFocus,
  scheduleLoad,
  batchReschedule,
  crossBrandOverview,
  listTemplates,
  saveTemplate,
  instantiateTemplate,
  // settings (PR6)
  getSettings,
  updateSettings,
  uploadSettingsAvatar,
};
