/**
 * POS terminal-payment reconciliation — HTTP controller.
 * Translates req/res to service calls. No business logic here.
 */

"use strict";

const service = require("./pos.service");

async function listPending(req, res) {
  const result = await service.listPending({
    brand: req.brand,
    page: parseInt(req.query.page || "1", 10),
    page_size: Math.min(parseInt(req.query.page_size || "25", 10), 100),
  });
  res.json(result);
}

async function listUnresolved(req, res) {
  const result = await service.listUnresolved({
    user: req.user,
    page: parseInt(req.query.page || "1", 10),
    page_size: Math.min(parseInt(req.query.page_size || "25", 10), 100),
  });
  res.json(result);
}

async function getById(req, res) {
  const data = await service.getById({ id: req.params.id });
  res.json({ data });
}

async function suggestions(req, res) {
  const result = await service.suggestions({
    id: req.params.id,
    brand: req.query.brand || null,
    user: req.user,
  });
  // Single-envelope like every other non-paginated endpoint here (getById,
  // match, ignore). The API client auto-unwraps a bare `{ data, meta }`
  // shape (list endpoints) but strips ANY other `{ data: ... }` object down
  // to its `data` field — result already has a `data` key (the candidates)
  // alongside `recon`, so passing it straight through got silently
  // stripped to the bare candidates array, and the frontend's
  // `suggestions.data.data` read `.data` off an array → crash.
  res.json({ data: result });
}

async function match(req, res) {
  const updated = await service.match({
    id: req.params.id,
    brand: req.body.brand,
    order_id: req.body.order_id,
    user: req.user,
    request_id: req.request_id,
  });
  res.json({ data: updated });
}

async function ignore(req, res) {
  const updated = await service.ignore({
    id: req.params.id,
    note: req.body.note,
    user: req.user,
    request_id: req.request_id,
  });
  res.json({ data: updated });
}

module.exports = {
  listPending,
  listUnresolved,
  getById,
  suggestions,
  match,
  ignore,
};
