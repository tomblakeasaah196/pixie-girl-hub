/**
 * Documents (V2.2 §6.13) — the SINGLE gateway for files.
 *
 * EVERY uploaded or generated file in the platform MUST be persisted via
 * `store()`: it writes bytes through the storage abstraction AND registers a
 * row in shared.documents (number, SHA-256 hash, size, mime, reference, actor)
 * so the file is archived, auditable and discoverable. Modules then reference
 * the returned `document_id` rather than holding raw paths.
 *
 * Other modules import this service and call `store(...)` — they must not
 * call services/storage.service directly.
 */

"use strict";

const crypto = require("crypto");
const path = require("path");
const repo = require("./documents.repo");
const events = require("./documents.events");
const storage = require("../../services/storage.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");
const {
  isHeic,
  compressImage,
  filenameForMime,
} = require("../../services/media-compression.service");

const EXT_BY_MIME = {
  "application/pdf": ".pdf",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "text/csv": ".csv",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    ".docx",
};

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
function extFor(filename, mime) {
  return (filename && path.extname(filename)) || EXT_BY_MIME[mime] || "";
}

// A document is auto-grouped by business area via one category tag derived
// from its type, so every file is discoverable by domain without manual work.
const CATEGORY_BY_TYPE = {
  invoice: "finance",
  receipt: "finance",
  settlement: "finance",
  intercompany_invoice: "finance",
  payslip: "hr",
  quotation: "sales",
  contract: "commercial",
  agreement: "commercial",
  nda: "legal",
  certificate: "compliance",
  stylist_certificate: "stylists",
  stylist_payout_remittance: "stylists",
  delivery_note: "logistics",
  purchase_order: "purchasing",
  production_summary: "production",
  report: "reports",
  id_document: "identity",
  image: "media",
  export: "exports",
  document: "general",
  other: "general",
};
const CATEGORY_COLOUR = "#A8631D"; // bronze — distinguishes the auto category chip

function categoryTagFor(document_type) {
  return CATEGORY_BY_TYPE[document_type] || "general";
}

/** Normalise free-form tags: trim, lowercase, drop empties, cap length/count. */
function normaliseTags(tags) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(tags) ? tags : []) {
    const name = String(raw).trim().toLowerCase().slice(0, 40);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Persist a file. Pass a Buffer (from an upload or generated in-process).
 * @returns {Promise<{document_id, document_number, title, mime_type, file_size_bytes, url, reference_type, reference_id}>}
 */
async function store({
  brand,
  user_id = null,
  buffer,
  filename,
  mime_type = "application/octet-stream",
  document_type = "document",
  title,
  reference_type = null,
  reference_id = null,
  tags = [],
  client,
  request_id = null,
}) {
  if (!Buffer.isBuffer(buffer))
    throw new AppError("INVALID_FILE", "store() requires a Buffer", 400);

  // Safety net for the whole documents gateway: a HEIC/HEIF buffer that
  // reached store() without its caller converting it (a phone receipt, a
  // message attachment, any future caller) would otherwise be persisted as an
  // unrenderable file — browsers can't decode HEIC. Decode it to JPEG here so
  // *every* documents.store() path lands a viewable image. Non-HEIC buffers
  // (already-compressed images, PDFs, spreadsheets, video) are left untouched.
  if (isHeic(mime_type, filename, buffer)) {
    const converted = await compressImage(buffer, mime_type, filename);
    buffer = converted.buffer;
    mime_type = converted.mime_type;
    filename = filenameForMime(filename, converted.mime_type);
  }

  const run = async (c) => {
    const document_number = await repo.nextNumber({ client: c, brand });
    const key = `${brand}/documents/${document_number}${extFor(filename, mime_type)}`;
    const stored = await storage.put(buffer, { key, contentType: mime_type });
    const doc = await repo.insert({
      client: c,
      row: {
        document_number,
        business: brand,
        document_type,
        title: title || filename || document_number,
        file_path: stored.key,
        file_size_bytes: buffer.length,
        mime_type,
        content_hash: sha256(buffer),
        reference_type,
        reference_id,
        uploaded_by: user_id,
      },
    });
    // Tags: the auto category tag (by type) + any user tags. The documents row
    // is immutable, so labels live in shared.document_tags.
    const userTags = normaliseTags(tags);
    const category = categoryTagFor(document_type);
    await repo.addTags({
      client: c,
      document_id: doc.document_id,
      business: brand,
      tagged_by: user_id,
      tags: [
        { name: category, colour: CATEGORY_COLOUR },
        ...userTags
          .filter((t) => t !== category)
          .map((name) => ({ name, colour: "#64748B" })),
      ],
    });
    await repo.attachTags({ client: c, rows: [doc] });
    await audit({
      business: brand,
      user_id,
      action_key: "documents.store",
      target_type: "document",
      target_id: doc.document_id,
      after: { document_number, document_type, reference_type, reference_id },
      request_id,
    });
    events.emit("stored", {
      brand,
      document_id: doc.document_id,
      reference_type,
      reference_id,
    });
    return { ...doc, url: stored.public_url };
  };

  return client ? run(client) : transaction(run);
}

async function getById({ brand, id }) {
  const d = await repo.findById({ brand, id });
  if (!d) throw new NotFoundError("Document");
  await repo.attachTags({ rows: [d] });
  return d;
}

function list({ brand, filters, page, page_size }) {
  const offset = (page - 1) * page_size;
  return repo.findAll({ brand, filters, page, page_size, offset });
}

const listForReference = ({ brand, reference_type, reference_id }) =>
  repo.listByReference({ brand, reference_type, reference_id });

async function download({ brand, id }) {
  const d = await repo.findById({ brand, id });
  if (!d) throw new NotFoundError("Document");
  const buffer = await storage.get(d.file_path);
  return {
    buffer,
    mime_type: d.mime_type,
    filename: `${d.document_number}${extFor(null, d.mime_type)}`,
    title: d.title,
  };
}

async function remove({ brand, user, request_id, id }) {
  const ok = await repo.softDelete({ brand, id });
  if (!ok) throw new NotFoundError("Document");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "documents.delete",
    target_type: "document",
    target_id: id,
    request_id,
  });
  events.emit("deleted", { brand, id });
}

module.exports = { store, getById, list, listForReference, download, remove };
