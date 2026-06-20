/**
 * Documents (V2.2 §6.13) — HTTP controllers. Direct uploads arrive as
 * multipart/form-data (field name `file`); generated files are registered
 * by other modules via the service, not here.
 */

"use strict";

const service = require("./documents.service");
const { parsePagination } = require("../../utils/pagination");
const { AppError } = require("../../utils/errors");

async function upload(req, res) {
  if (!req.file)
    throw new AppError("NO_FILE", "Multipart field 'file' is required", 400);
  const doc = await service.store({
    brand: req.brand,
    user_id: req.user.user_id,
    buffer: req.file.buffer,
    filename: req.file.originalname,
    mime_type: req.file.mimetype,
    document_type: req.body.document_type || "document",
    title: req.body.title,
    reference_type: req.body.reference_type,
    reference_id: req.body.reference_id,
    tags: req.body.tags,
    request_id: req.request_id,
  });
  res.status(201).json({ data: doc });
}

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.list({
      brand: req.brand,
      filters: {
        document_type: req.query.document_type,
        reference_type: req.query.reference_type,
        reference_id: req.query.reference_id,
        q: req.query.q,
        tag: req.query.tag,
      },
      page,
      page_size,
    }),
  );
}

async function getById(req, res) {
  res.json({
    data: await service.getById({ brand: req.brand, id: req.params.id }),
  });
}

async function download(req, res) {
  const { buffer, mime_type, filename } = await service.download({
    brand: req.brand,
    id: req.params.id,
  });
  res.set("Content-Type", mime_type);
  res.set("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

async function remove(req, res) {
  await service.remove({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.status(204).end();
}

module.exports = { upload, list, getById, download, remove };
