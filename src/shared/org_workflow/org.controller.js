/**
 * Organisation & Workflow Builder (V2.2 §6.27)
 * HTTP controller — translates req/res to service calls. No business logic.
 * Covers org_units (the generic /org resource) and org_positions.
 */

"use strict";

const service = require("./org.service");
const chartPdf = require("./org.chart-pdf");

// ── org_units ──────────────────────────────────────────────

async function list(req, res) {
  const result = await service.list({
    brand: req.brand,
    filters: req.query,
    page: parseInt(req.query.page || "1", 10),
    page_size: Math.min(parseInt(req.query.page_size || "25", 10), 100),
  });
  res.json(result);
}

async function getById(req, res) {
  const item = await service.getById({ brand: req.brand, id: req.params.id });
  res.json({ data: item });
}

async function create(req, res) {
  const created = await service.create({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json({ data: created });
}

async function update(req, res) {
  const updated = await service.update({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
    patch: req.body,
  });
  res.json({ data: updated });
}

async function archive(req, res) {
  await service.archive({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.status(204).end();
}

// ── org_positions ──────────────────────────────────────────

async function listPositions(req, res) {
  const result = await service.listPositions({
    brand: req.brand,
    unit_id: req.query.unit_id,
  });
  res.json(result);
}

async function getPosition(req, res) {
  const item = await service.getPosition({
    brand: req.brand,
    id: req.params.position_id,
  });
  res.json({ data: item });
}

async function createPosition(req, res) {
  const created = await service.createPosition({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json({ data: created });
}

async function updatePosition(req, res) {
  const updated = await service.updatePosition({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.position_id,
    patch: req.body,
  });
  res.json({ data: updated });
}

async function deletePosition(req, res) {
  await service.deletePosition({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.position_id,
  });
  res.status(204).end();
}

// ── Full organigramme (all departments, one PDF) ───────────

async function exportFullChartPdf(req, res) {
  const result = await chartPdf.exportFullChartPdf({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
  });
  res.json({ data: result });
}

// ── org_position_dotted_lines ──────────────────────────────

async function listDottedLines(req, res) {
  res.json(
    await service.listDottedLines({
      brand: req.brand,
      position_id: req.params.position_id,
    }),
  );
}

async function createDottedLine(req, res) {
  const created = await service.createDottedLine({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json({ data: created });
}

async function updateDottedLine(req, res) {
  const updated = await service.updateDottedLine({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    dotted_id: req.params.dotted_id,
    patch: req.body,
  });
  res.json({ data: updated });
}

async function deleteDottedLine(req, res) {
  await service.deleteDottedLine({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    dotted_id: req.params.dotted_id,
  });
  res.status(204).end();
}

module.exports = {
  list,
  getById,
  create,
  update,
  archive,
  listPositions,
  getPosition,
  createPosition,
  updatePosition,
  deletePosition,
  exportFullChartPdf,
  listDottedLines,
  createDottedLine,
  updateDottedLine,
  deleteDottedLine,
};
