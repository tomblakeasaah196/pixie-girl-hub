/**
 * Employee documents service (V2.2 §6.11 — HR & Staff → Employee →
 * Documents).
 *
 * An employee's paper trail: contract, guarantor form, NIN slip, passport
 * photograph and whatever else HR decides to file. Uploads are PDFs or
 * images; each one is filed under a type from the brand's own catalogue
 * (`shared.hr_document_types`), and the required types drive a "still
 * missing" checklist so an incomplete file is visible rather than discovered
 * during a dispute.
 *
 * The files ride the existing documents gateway — documents.service.store()
 * gives us storage, SHA-256 content hashing, HEIC→JPEG conversion, image
 * compression and duplicate collapsing for free. What this service adds is
 * the HR fence: every read and write is scoped to a staff profile that is
 * visible to the caller's brand, and the same rows are excluded from the
 * generic /documents module, which is granted far more widely than
 * `hr_payroll`.
 */

"use strict";

const repo = require("./staff_documents.repo");
const hrRepo = require("./hr_ops.repo");
const documents = require("../documents/documents.service");
const storage = require("../../services/storage.service");
const events = require("./hr.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const {
  NotFoundError,
  ConflictError,
  ValidationError,
} = require("../../utils/errors");

/** Types whose upload guard is 'image' accept only these. */
const IMAGE_MIME = /^image\//i;
const PDF_MIME = /^application\/pdf$/i;

/**
 * Extension for a stored file. shared.documents keeps the storage key, but
 * the browser needs a sensible filename on download.
 */
const EXT_BY_MIME = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/heic": ".heic",
};

function extFor(filename, mime) {
  const fromName = filename && filename.includes(".")
    ? filename.slice(filename.lastIndexOf("."))
    : "";
  return EXT_BY_MIME[String(mime || "").toLowerCase()] || fromName || "";
}

/** Slugify a label into a stable type_key: "Guarantor Form" → guarantor_form. */
function slugify(label) {
  return String(label)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

/**
 * Resolve the staff profile an HR user is acting on, refusing ids that belong
 * to another brand. Every entry point goes through here.
 */
async function requireProfile({ client, brand, profileId }) {
  const profile = await hrRepo.profileById({ client, brand, profileId });
  if (!profile) throw new NotFoundError("Staff profile");
  return profile;
}

/** Resolve the caller's OWN staff profile (My HR self-service). */
async function requireOwnProfile({ client, brand, user }) {
  const profile = await hrRepo.profileForUser({
    client,
    brand,
    userId: user.user_id,
  });
  if (!profile) throw new NotFoundError("Staff profile");
  return profile;
}

// ── Type catalogue ─────────────────────────────────────────

const listTypes = ({ brand, includeArchived = false }) =>
  repo.listTypes({ brand, includeArchived });

/**
 * Create a document type. Called from HR settings and, more often, from the
 * "+ New type" affordance in the upload drawer — HR names a document while
 * filing it and the type is there for every employee afterwards.
 *
 * Re-creating an archived type revives it rather than colliding on the
 * (business, type_key) unique index: "Medical Report" coming back should
 * reattach to the documents already filed under `medical`, not fail.
 */
async function createType({ brand, user, request_id, input }) {
  const label = String(input.label || "").trim();
  if (!label)
    throw new ValidationError(null, "A document type needs a name");
  const type_key = slugify(label);
  if (!type_key)
    throw new ValidationError(
      null,
      "That name has no letters or numbers to build a type from",
    );

  return transaction(async (client) => {
    const existing = await repo.findTypeByKey({ client, brand, typeKey: type_key });
    if (existing) {
      if (existing.is_active)
        throw new ConflictError(`"${existing.label}" already exists`);
      const revived = await repo.updateType({
        client,
        brand,
        typeId: existing.type_id,
        patch: {
          is_active: true,
          label,
          description: input.description ?? existing.description,
          is_required: input.is_required ?? existing.is_required,
          accepts: input.accepts ?? existing.accepts,
        },
      });
      await audit({
        business: brand,
        user_id: user.user_id,
        action_key: "hr.document_type.restore",
        target_type: "hr_document_type",
        target_id: revived.type_id,
        after: { type_key, label },
        request_id,
      });
      return revived;
    }

    const sort_order = await repo.nextTypeSortOrder({ client, brand });
    const created = await repo.insertType({
      client,
      brand,
      row: {
        type_key,
        label,
        description: input.description ?? null,
        is_required: input.is_required ?? false,
        accepts: input.accepts ?? "any",
        sort_order,
        created_by: user.user_id,
      },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr.document_type.create",
      target_type: "hr_document_type",
      target_id: created.type_id,
      after: { type_key, label, is_required: created.is_required },
      request_id,
    });
    events.emit("document_type_created", { brand, type_id: created.type_id });
    return created;
  });
}

/** Rename / re-flag / reorder / archive a type. `type_key` stays fixed. */
async function updateType({ brand, user, request_id, typeId, patch }) {
  return transaction(async (client) => {
    const before = await repo.findTypeById({ client, brand, typeId });
    if (!before) throw new NotFoundError("Document type");
    const updated = await repo.updateType({ client, brand, typeId, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr.document_type.update",
      target_type: "hr_document_type",
      target_id: typeId,
      before: {
        label: before.label,
        is_required: before.is_required,
        is_active: before.is_active,
      },
      after: {
        label: updated.label,
        is_required: updated.is_required,
        is_active: updated.is_active,
      },
      request_id,
    });
    return updated;
  });
}

/**
 * Remove a type. Seeded types and types with documents filed under them are
 * archived instead of deleted — deleting would strand the label those
 * documents are filed under, and shared.documents is immutable by design.
 */
async function removeType({ brand, user, request_id, typeId }) {
  return transaction(async (client) => {
    const type = await repo.findTypeById({ client, brand, typeId });
    if (!type) throw new NotFoundError("Document type");
    const inUse = await repo.countDocumentsOfType({
      client,
      brand,
      typeKey: type.type_key,
    });
    const archiveOnly = type.is_system || inUse > 0;

    if (archiveOnly) {
      const archived = await repo.updateType({
        client,
        brand,
        typeId,
        patch: { is_active: false },
      });
      await audit({
        business: brand,
        user_id: user.user_id,
        action_key: "hr.document_type.archive",
        target_type: "hr_document_type",
        target_id: typeId,
        after: { type_key: type.type_key, documents: inUse },
        request_id,
      });
      return { deleted: false, archived: true, documents: inUse, type: archived };
    }

    await repo.deleteType({ client, brand, typeId });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr.document_type.delete",
      target_type: "hr_document_type",
      target_id: typeId,
      before: { type_key: type.type_key, label: type.label },
      request_id,
    });
    return { deleted: true, archived: false, documents: 0, type: null };
  });
}

// ── Employee documents ─────────────────────────────────────

/**
 * An employee's file: the documents held, plus the required types still
 * missing. The checklist is computed from the live catalogue rather than
 * stored, so marking a type required immediately shows up as a gap on
 * everyone who lacks it.
 */
async function listForEmployee({ brand, profileId }) {
  const [types, docs] = await Promise.all([
    repo.listTypes({ brand }),
    repo.listForProfile({ brand, profileId }),
  ]);
  const held = new Set(docs.map((d) => d.document_type));
  const missing = types
    .filter((t) => t.is_required && !held.has(t.type_key))
    .map((t) => ({
      type_key: t.type_key,
      label: t.label,
      accepts: t.accepts,
    }));
  return {
    documents: docs.map(shape),
    missing_required: missing,
    types,
  };
}

/** API shape — never leaks file_path or content_hash to the client. */
function shape(d) {
  return {
    document_id: d.document_id,
    document_number: d.document_number,
    document_type: d.document_type,
    // A type archived after the fact still has a label; one deleted before
    // this row existed falls back to the raw key so nothing renders blank.
    type_label: d.type_label || d.document_type,
    type_is_required: d.type_is_required ?? false,
    title: d.title,
    mime_type: d.mime_type,
    file_size_bytes: d.file_size_bytes,
    is_image: IMAGE_MIME.test(d.mime_type || ""),
    is_pdf: PDF_MIME.test(d.mime_type || ""),
    uploaded_by: d.uploaded_by,
    uploaded_by_name: d.uploaded_by_name || null,
    created_at: d.created_at,
  };
}

/**
 * File an uploaded document against an employee.
 *
 * The type must exist and be live in this brand's catalogue — a free-text
 * type would fragment the list ("NIN" vs "N.I.N.") and break the missing
 * checklist, which is exactly what the catalogue exists to prevent. New types
 * are created through createType() first (the drawer does this in one step).
 */
async function upload({
  brand,
  user,
  request_id,
  profileId,
  buffer,
  filename,
  mime_type,
  document_type,
  title,
}) {
  const profile = await requireProfile({ brand, profileId });
  const type = await repo.findTypeByKey({ brand, typeKey: document_type });
  if (!type || !type.is_active)
    throw new ValidationError(
      null,
      `Unknown document type "${document_type}"`,
    );

  if (type.accepts === "image" && !IMAGE_MIME.test(mime_type))
    throw new ValidationError(null, `${type.label} must be an image`);
  if (type.accepts === "pdf" && !PDF_MIME.test(mime_type))
    throw new ValidationError(null, `${type.label} must be a PDF`);
  if (!IMAGE_MIME.test(mime_type) && !PDF_MIME.test(mime_type))
    throw new ValidationError(
      null,
      "Employee documents must be a PDF or an image (JPG, PNG, WEBP or HEIC)",
    );

  const doc = await documents.store({
    brand,
    user_id: user.user_id,
    buffer,
    filename,
    mime_type,
    document_type: type.type_key,
    title: String(title || "").trim() || type.label,
    reference_type: repo.STAFF_REF,
    reference_id: profileId,
    request_id,
  });

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "hr.staff_document.upload",
    target_type: "staff_profile",
    target_id: profileId,
    after: {
      document_id: doc.document_id,
      document_type: type.type_key,
      employee_number: profile.employee_number,
    },
    is_sensitive: true,
    request_id,
  });
  events.emit("staff_document_uploaded", {
    brand,
    profile_id: profileId,
    document_id: doc.document_id,
    document_type: type.type_key,
  });

  return shape({ ...doc, type_label: type.label, type_is_required: type.is_required });
}

/**
 * Bytes for one document, scoped to the employee it belongs to. Serves both
 * the download and the in-page preview.
 *
 * A download is audited as a sensitive access and a preview is not: taking a
 * copy of someone's NIN slip off the platform is the event a compliance
 * review cares about, while auditing every preview would bury it under rows
 * generated by scrolling the tab. `user` is optional so internal callers can
 * fetch bytes without an audit subject.
 */
async function fetchFile({
  brand,
  profileId,
  documentId,
  user = null,
  request_id = null,
  mode = "preview",
}) {
  const doc = await repo.findForProfile({ brand, profileId, documentId });
  if (!doc) throw new NotFoundError("Document");
  const buffer = await storage.get(doc.file_path);
  if (mode === "download" && user) {
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "hr.staff_document.download",
      target_type: "staff_profile",
      target_id: profileId,
      after: {
        document_id: documentId,
        document_type: doc.document_type,
        title: doc.title,
      },
      is_sensitive: true,
      request_id,
    });
  }
  return {
    buffer,
    mime_type: doc.mime_type,
    filename: `${doc.title || doc.document_number}${extFor(doc.file_path, doc.mime_type)}`,
  };
}

async function remove({ brand, user, request_id, profileId, documentId }) {
  const doc = await repo.findForProfile({ brand, profileId, documentId });
  if (!doc) throw new NotFoundError("Document");
  await repo.softDeleteForProfile({ brand, profileId, documentId });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "hr.staff_document.delete",
    target_type: "staff_profile",
    target_id: profileId,
    before: {
      document_id: documentId,
      document_type: doc.document_type,
      title: doc.title,
    },
    request_id,
  });
  events.emit("staff_document_deleted", {
    brand,
    profile_id: profileId,
    document_id: documentId,
  });
}

// ── Self-service (My HR) ───────────────────────────────────
// A staff member reads their OWN file back — no hr_payroll permission, and no
// way to reach anyone else's, because the profile is resolved from the token
// rather than the URL. Read-only: uploads stay with HR.

async function listMine({ brand, user }) {
  const profile = await requireOwnProfile({ brand, user });
  const { documents: docs, missing_required } = await listForEmployee({
    brand,
    profileId: profile.profile_id,
  });
  return { documents: docs, missing_required };
}

async function fetchMyFile({ brand, user, documentId, request_id, mode }) {
  const profile = await requireOwnProfile({ brand, user });
  return fetchFile({
    brand,
    profileId: profile.profile_id,
    documentId,
    user,
    request_id,
    mode,
  });
}

module.exports = {
  slugify,
  listTypes,
  createType,
  updateType,
  removeType,
  listForEmployee,
  upload,
  fetchFile,
  remove,
  listMine,
  fetchMyFile,
};
