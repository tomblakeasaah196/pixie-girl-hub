/**
 * Contacts (V2.2 §6.12) — HTTP controllers.
 */

"use strict";

const service = require("./contacts.service");
const io = require("./contacts-io.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

function sendCsv(res, buffer, filename) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

function requireFile(req, res) {
  if (req.file) return true;
  res.status(400).json({
    error: { code: "NO_FILE", message: "Multipart field 'file' is required" },
    request_id: req.request_id,
  });
  return false;
}

// ── Bulk import / export (clients & suppliers) ───────────
async function importTemplate(req, res) {
  const kind =
    io.normaliseKind(req.query.kind) === "suppliers" ? "suppliers" : "clients";
  sendCsv(res, io.template({ kind }), `${kind}-import-template.csv`);
}

async function importContacts(req, res) {
  if (!requireFile(req, res)) return;
  const kind = req.body?.kind ?? req.query.kind;
  res.status(201).json({
    data: await io.importContacts({
      ...base(req),
      kind,
      buffer: req.file.buffer,
      filename: req.file.originalname,
    }),
  });
}

async function exportContacts(req, res) {
  const { kind, from, to } = req.query;
  sendCsv(
    res,
    await io.exportContacts({ kind, from, to }),
    io.exportFilename({ kind, from, to }),
  );
}

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  // Accept both backend-native param names (q, contact_type, priority_level)
  // and the friendlier UI aliases (search, type, priority) for compatibility.
  res.json({
    data: await service.list({
      filters: {
        q: req.query.q ?? req.query.search,
        priority_level: req.query.priority_level ?? req.query.priority,
        assigned_to: req.query.assigned_to,
        contact_type: req.query.contact_type ?? req.query.type,
      },
      page,
      page_size,
    }),
  });
}
async function getById(req, res) {
  res.json({ data: await service.getById({ id: req.params.id }) });
}
async function getTimeline(req, res) {
  const { page, page_size } = parsePagination(req.query);
  const kinds = req.query.kinds
    ? String(req.query.kinds)
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
    : null;
  res.json({
    data: await service.getTimeline({
      brand: req.brand,
      id: req.params.id,
      kinds,
      category: req.query.category,
      page,
      page_size,
    }),
  });
}
async function getSummary(req, res) {
  res.json({
    data: await service.getSummary({ brand: req.brand, id: req.params.id }),
  });
}
async function create(req, res) {
  res
    .status(201)
    .json({ data: await service.create({ ...base(req), input: req.body }) });
}
async function update(req, res) {
  res.json({
    data: await service.update({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function remove(req, res) {
  await service.remove({ ...base(req), id: req.params.id });
  res.status(204).end();
}

// Segments
async function listSegments(req, res) {
  res.json({ data: await service.listSegments({ brand: req.brand }) });
}
async function getSegment(req, res) {
  res.json({
    data: await service.getSegment({ brand: req.brand, id: req.params.segId }),
  });
}
async function createSegment(req, res) {
  res.status(201).json({
    data: await service.createSegment({ ...base(req), input: req.body }),
  });
}
async function updateSegment(req, res) {
  res.json({
    data: await service.updateSegment({
      ...base(req),
      id: req.params.segId,
      patch: req.body,
    }),
  });
}
async function deleteSegment(req, res) {
  await service.deleteSegment({ ...base(req), id: req.params.segId });
  res.status(204).end();
}

// Addresses (under a contact)
const listAddresses = async (req, res) =>
  res.json({ data: await service.listAddresses({ id: req.params.id }) });
const addAddress = async (req, res) =>
  res.status(201).json({
    data: await service.addAddress({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const updateAddress = async (req, res) =>
  res.json({
    data: await service.updateAddress({
      ...base(req),
      id: req.params.id,
      address_id: req.params.addressId,
      patch: req.body,
    }),
  });
const deleteAddress = async (req, res) => {
  await service.deleteAddress({
    ...base(req),
    id: req.params.id,
    address_id: req.params.addressId,
  });
  res.status(204).end();
};

async function milestones(req, res) {
  res.json({ data: await service.milestones({ days: req.query.days }) });
}

async function stats(req, res) {
  res.json({ data: await service.stats({ brand: req.brand }) });
}

async function listTags(req, res) {
  res.json({
    data: await service.listTags({ brand: req.brand, id: req.params.id }),
  });
}
async function addTag(req, res) {
  res.status(201).json({
    data: await service.addTag({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function removeTag(req, res) {
  await service.removeTag({
    ...base(req),
    id: req.params.id,
    tag_id: req.params.tagId,
  });
  res.status(204).end();
}

module.exports = {
  stats,
  listTags,
  addTag,
  removeTag,
  milestones,
  importTemplate,
  importContacts,
  exportContacts,
  list,
  getById,
  getTimeline,
  getSummary,
  create,
  update,
  remove,
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
};
