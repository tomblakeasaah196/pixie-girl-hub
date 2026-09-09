/**
 * Employee documents controller (V2.2 §6.11). HTTP only — delegates to
 * staff_documents.service.
 *
 * The employee a document belongs to always comes from the URL (:id), and the
 * self-service handlers resolve the profile from req.user, so no request body
 * can point a read or a write at another person's file.
 */

"use strict";

const service = require("./staff_documents.service");
const { compressUpload } = require("../../services/media-compression.service");
const { AppError } = require("../../utils/errors");

const ctx = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

/** Stream bytes back, inline for preview and as an attachment for download. */
function sendFile(res, { buffer, mime_type, filename }, disposition) {
  res.set("Content-Type", mime_type);
  res.set(
    "Content-Disposition",
    `${disposition}; filename="${filename.replace(/"/g, "")}"`,
  );
  // Employee documents are PII: keep them out of shared caches, and let the
  // browser reuse them only within the tab session that fetched them.
  res.set("Cache-Control", "private, no-store");
  res.send(buffer);
}

// ── Type catalogue ─────────────────────────────────────────
async function listTypes(req, res) {
  res.json({
    data: await service.listTypes({
      brand: req.brand,
      includeArchived: req.query.include_archived === "true",
    }),
  });
}

async function createType(req, res) {
  res.status(201).json({ data: await service.createType({ ...ctx(req), input: req.body }) });
}

async function updateType(req, res) {
  res.json({
    data: await service.updateType({
      ...ctx(req),
      typeId: req.params.typeId,
      patch: req.body,
    }),
  });
}

async function removeType(req, res) {
  res.json({
    data: await service.removeType({ ...ctx(req), typeId: req.params.typeId }),
  });
}

// ── Employee documents ─────────────────────────────────────
async function list(req, res) {
  res.json({
    data: await service.listForEmployee({
      brand: req.brand,
      profileId: req.params.id,
    }),
  });
}

async function upload(req, res) {
  if (!req.file)
    throw new AppError("NO_FILE", "Multipart field 'file' is required", 400);
  // Images are optimised (and HEIC → JPEG converted) before storage so a
  // 12 MB phone photo of a NIN slip doesn't stay 12 MB; PDFs pass through.
  const shrunk = await compressUpload(req.file);
  res.status(201).json({
    data: await service.upload({
      ...ctx(req),
      profileId: req.params.id,
      buffer: shrunk.buffer,
      filename: shrunk.filename,
      mime_type: shrunk.mime_type,
      document_type: req.body.document_type,
      title: req.body.title,
    }),
  });
}

async function download(req, res) {
  const file = await service.fetchFile({
    brand: req.brand,
    profileId: req.params.id,
    documentId: req.params.documentId,
    user: req.user,
    request_id: req.request_id,
    mode: "download",
  });
  sendFile(res, file, "attachment");
}

async function preview(req, res) {
  const file = await service.fetchFile({
    brand: req.brand,
    profileId: req.params.id,
    documentId: req.params.documentId,
    mode: "preview",
  });
  sendFile(res, file, "inline");
}

async function remove(req, res) {
  await service.remove({
    ...ctx(req),
    profileId: req.params.id,
    documentId: req.params.documentId,
  });
  res.status(204).end();
}

// ── Self-service (My HR) ───────────────────────────────────
async function listMine(req, res) {
  res.json({ data: await service.listMine({ brand: req.brand, user: req.user }) });
}

async function downloadMine(req, res) {
  const file = await service.fetchMyFile({
    brand: req.brand,
    user: req.user,
    documentId: req.params.documentId,
    request_id: req.request_id,
    mode: "download",
  });
  sendFile(res, file, "attachment");
}

async function previewMine(req, res) {
  const file = await service.fetchMyFile({
    brand: req.brand,
    user: req.user,
    documentId: req.params.documentId,
    mode: "preview",
  });
  sendFile(res, file, "inline");
}

module.exports = {
  listTypes,
  createType,
  updateType,
  removeType,
  list,
  upload,
  download,
  preview,
  remove,
  listMine,
  downloadMine,
  previewMine,
};
