/**
 * WhatsApp Calls — HTTP controllers.
 * Thin req/res only — all business logic lives in calls.service.
 */

"use strict";

const service = require("./calls.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function list(req, res) {
  const data = await service.listCalls({
    user: req.user,
    brand: req.brand,
    status: req.query.status,
    contact_id: req.query.contact_id,
    answered_by: req.query.answered_by,
    limit: req.query.limit ? Math.min(parseInt(req.query.limit, 10), 100) : 50,
    offset: req.query.offset ? parseInt(req.query.offset, 10) : 0,
  });
  res.json({ data });
}

async function ringing(req, res) {
  const data = await service.listRingingForUser({
    user: req.user,
    brand: req.brand,
  });
  res.json({ data });
}

async function get(req, res) {
  const data = await service.getCall({
    user: req.user,
    brand: req.brand,
    id: req.params.id,
  });
  res.json(data);
}

async function claim(req, res) {
  const data = await service.claimCall({ ...ctx(req), id: req.params.id });
  res.json(data);
}

async function accept(req, res) {
  const data = await service.acceptCall({
    ...ctx(req),
    id: req.params.id,
    sdp: req.body.sdp,
  });
  res.json(data);
}

async function reject(req, res) {
  const data = await service.rejectCall({ ...ctx(req), id: req.params.id });
  res.json(data);
}

async function hangup(req, res) {
  const data = await service.hangupCall({ ...ctx(req), id: req.params.id });
  res.json(data);
}

async function outcome(req, res) {
  const data = await service.recordOutcome({
    ...ctx(req),
    id: req.params.id,
    outcome: req.body.outcome,
    notes: req.body.notes,
  });
  res.json(data);
}

module.exports = { list, ringing, get, claim, accept, reject, hangup, outcome };
