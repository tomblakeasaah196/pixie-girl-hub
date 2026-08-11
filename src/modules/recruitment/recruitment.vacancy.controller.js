/**
 * Vacancy controller — thin HTTP handlers (req/res only). Admin surface is
 * brand-scoped (req.brand via brandContextMiddleware) and gated on the
 * `recruitment` permission module upstream.
 */

"use strict";

const service = require("./recruitment.vacancy.service");

// ── Conversational intake ──────────────────────────────────
async function followups(req, res) {
  res.json({ data: await service.suggestFollowups({ intake: req.body.intake }) });
}

// ── Vacancies ──────────────────────────────────────────────
async function create(req, res) {
  res.status(201).json({
    data: await service.createVacancy({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}
async function list(req, res) {
  res.json({ data: await service.listVacancies({ brand: req.brand, status: req.query.status }) });
}
async function get(req, res) {
  res.json({ data: await service.getVacancy({ brand: req.brand, id: req.params.id }) });
}
async function update(req, res) {
  res.json({
    data: await service.updateVacancy({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function setStatus(req, res) {
  res.json({
    data: await service.setStatus({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      status: req.body.status,
    }),
  });
}
async function remove(req, res) {
  await service.deleteVacancy({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.status(204).end();
}
async function options(req, res) {
  res.json({ data: await service.formOptions({ brand: req.brand }) });
}

// ── Screening questions ────────────────────────────────────
async function generateQuestions(req, res) {
  res.status(201).json({
    data: await service.generateQuestions({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
    }),
  });
}
async function listQuestions(req, res) {
  res.json({ data: await service.listQuestions({ id: req.params.id }) });
}
async function answerQuestions(req, res) {
  res.json({
    data: await service.answerQuestions({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      answers: req.body.answers,
    }),
  });
}

// ── Applications ───────────────────────────────────────────
async function listApplications(req, res) {
  res.json({
    data: await service.listApplications({
      brand: req.brand,
      vacancy_id: req.params.id,
      stage: req.query.stage,
    }),
  });
}
async function addApplication(req, res) {
  res.status(201).json({
    data: await service.addApplicationManual({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      vacancy_id: req.params.id,
      input: req.body,
    }),
  });
}
async function scoreAll(req, res) {
  res.json({
    data: await service.scoreAllApplicants({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      vacancy_id: req.params.id,
    }),
  });
}
async function getApplication(req, res) {
  res.json({
    data: await service.getApplicationDetail({ brand: req.brand, id: req.params.appId, user: req.user }),
  });
}
async function updateStage(req, res) {
  res.json({
    data: await service.updateStage({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.appId,
      stage: req.body.stage,
    }),
  });
}
async function addNote(req, res) {
  res.status(201).json({
    data: await service.addNote({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.appId,
      body: req.body.body,
    }),
  });
}
async function setRating(req, res) {
  res.json({
    data: await service.setRating({
      brand: req.brand,
      user: req.user,
      id: req.params.appId,
      stars: req.body.stars,
    }),
  });
}
async function setQuestionRating(req, res) {
  res.json({
    data: await service.setQuestionRating({
      brand: req.brand,
      user: req.user,
      id: req.params.appId,
      question_id: req.params.questionId,
      stars: req.body.stars,
      note: req.body.note,
    }),
  });
}
async function scoreApplication(req, res) {
  res.json({
    data: await service.scoreApplication({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.appId,
    }),
  });
}
async function moveToOffered(req, res) {
  res.status(201).json({
    data: await service.moveToOffered({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.appId,
    }),
  });
}
async function downloadFile(req, res) {
  const { buffer, mime_type, filename } = await service.getApplicationFile({
    brand: req.brand,
    id: req.params.appId,
    kind: req.params.kind,
    media_id: req.query.media_id,
  });
  const disposition = req.query.download ? "attachment" : "inline";
  res.set("Content-Type", mime_type);
  res.set("Content-Disposition", `${disposition}; filename="${filename}"`);
  res.set("Cache-Control", "private, no-store");
  res.send(buffer);
}

module.exports = {
  followups,
  create,
  list,
  get,
  update,
  setStatus,
  remove,
  options,
  generateQuestions,
  listQuestions,
  answerQuestions,
  listApplications,
  addApplication,
  scoreAll,
  getApplication,
  updateStage,
  addNote,
  setRating,
  setQuestionRating,
  scoreApplication,
  moveToOffered,
  downloadFile,
};
