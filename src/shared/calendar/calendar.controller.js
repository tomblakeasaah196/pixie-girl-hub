/**
 * Calendar (V2.2 §6.18) — HTTP controller.
 */

"use strict";

const service = require("./calendar.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listEvents(req, res) {
  res.json({
    data: await service.listEvents({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
      event_type: req.query.event_type,
      reference_type: req.query.reference_type,
      reference_id: req.query.reference_id,
    }),
  });
}
async function getEvent(req, res) {
  res.json({
    data: await service.getEvent({ brand: req.brand, id: req.params.id }),
  });
}
async function createEvent(req, res) {
  res.status(201).json({
    data: await service.createEvent({ ...base(req), input: req.body }),
  });
}
async function updateEvent(req, res) {
  res.json({
    data: await service.updateEvent({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function deleteEvent(req, res) {
  await service.deleteEvent({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function addParticipant(req, res) {
  res.status(201).json({
    data: await service.addParticipant({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function respondParticipant(req, res) {
  res.json({
    data: await service.respondParticipant({
      ...base(req),
      id: req.params.id,
      participant_id: req.params.participant_id,
      status: req.body.status,
    }),
  });
}

async function listForReference(req, res) {
  res.json({
    data: await service.listForReference({
      brand: req.brand,
      reference_type: req.query.reference_type,
      reference_id: req.query.reference_id,
    }),
  });
}
async function removeParticipant(req, res) {
  await service.removeParticipant({
    ...base(req),
    id: req.params.id,
    participant_id: req.params.participant_id,
  });
  res.status(204).end();
}

module.exports = {
  listEvents,
  listForReference,
  getEvent,
  createEvent,
  updateEvent,
  deleteEvent,
  addParticipant,
  respondParticipant,
  removeParticipant,
};
