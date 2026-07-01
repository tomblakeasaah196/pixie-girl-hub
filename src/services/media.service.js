/**
 * Media service (V2.2 §6.4 self-hosted media). The producer side of the media
 * pipeline: store an uploaded file, register a `pending` media_asset, and
 * enqueue it for FFmpeg processing (→ poster/thumbnail/transcode → ready).
 * The ready asset is then attachable to a product via the catalogue
 * video-library (W-13).
 */

"use strict";

const path = require("path");
const crypto = require("crypto");
const storage = require("./storage.service");
const { normalizeImageInput } = require("./media-compression.service");
const mediaRepo = require("../jobs/processors/media.repo");
const { enqueue } = require("../jobs/queue");
const { audit } = require("../middleware/audit");
const { AppError } = require("../utils/errors");

const MEDIA_QUEUE = "media-processing";

function assetKindFor(mime) {
  if (!mime) return "document";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

/** Enqueue an existing pending asset for (re)processing. */
function enqueueProcessing({ brand, asset_id }) {
  return enqueue(MEDIA_QUEUE, "process", { brand, asset_id });
}

/**
 * Store an uploaded buffer, create the media_asset row (pending), and enqueue
 * processing. Returns the created asset (status 'pending').
 */
async function registerUpload({ brand, user, file, meta = {} }) {
  if (!file || !file.buffer)
    throw new AppError("NO_FILE", "A file upload is required", 422);

  // The raw upload is what the media pipeline serves directly (only a thumb is
  // derived). A HEIC would be stored unrenderable, so decode it to JPEG first;
  // video and non-HEIC images pass through untouched.
  file = await normalizeImageInput(file);

  const kind = assetKindFor(file.mimetype);
  const ext = path.extname(file.originalname || "").toLowerCase() || "";
  const key = path.posix.join(
    "media",
    brand,
    "raw",
    `${crypto.randomBytes(16).toString("hex")}${ext}`,
  );
  const stored = await storage.put(file.buffer, {
    key,
    contentType: file.mimetype,
  });

  const asset = await mediaRepo.insertAsset({
    brand,
    asset: {
      asset_kind: kind,
      storage_path: stored.key,
      mime_type: file.mimetype || "application/octet-stream",
      original_byte_size: file.size ?? file.buffer.length,
      source_kind: "direct_upload",
      caption: meta.caption,
      alt_text: meta.alt_text,
      uploaded_by: user ? user.user_id : null,
    },
  });

  await enqueueProcessing({ brand, asset_id: asset.asset_id });

  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "media.upload",
    target_type: "media_asset",
    target_id: asset.asset_id,
    after: { asset_kind: kind, storage_path: stored.key },
  });

  return asset;
}

/**
 * Register an already-fetched remote buffer (e.g. UGC downloaded from a
 * source URL) as a pending media_asset and enqueue it. Like registerUpload
 * but without a multer file or an acting user.
 */
async function registerRemoteAsset({ brand, buffer, mimetype, source }) {
  if (!buffer || !buffer.length)
    throw new AppError("NO_BYTES", "No media bytes to register", 422);
  // A remotely-fetched HEIC (rare, but possible from UGC) would be unrenderable
  // if stored as-is — decode it to JPEG; everything else passes through.
  const normalized = await normalizeImageInput({
    buffer,
    mimetype,
    originalname: (source && source.filename) || undefined,
  });
  buffer = normalized.buffer;
  mimetype = normalized.mimetype;
  const kind = assetKindFor(mimetype);
  const key = path.posix.join(
    "media",
    brand,
    "ugc",
    `${crypto.randomBytes(16).toString("hex")}`,
  );
  const stored = await storage.put(buffer, { key, contentType: mimetype });
  const asset = await mediaRepo.insertAsset({
    brand,
    asset: {
      asset_kind: kind,
      storage_path: stored.key,
      mime_type: mimetype || "application/octet-stream",
      original_byte_size: buffer.length,
      source_kind: (source && source.source_kind) || "ugc_form_submission",
      source_external_url: source && source.source_external_url,
      source_creator_handle: source && source.source_creator_handle,
      source_creator_contact_id: source && source.source_creator_contact_id,
      caption: source && source.caption,
    },
  });
  await enqueueProcessing({ brand, asset_id: asset.asset_id });
  return asset;
}

module.exports = {
  registerUpload,
  registerRemoteAsset,
  enqueueProcessing,
  assetKindFor,
};
