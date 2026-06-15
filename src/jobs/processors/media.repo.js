/**
 * Media pipeline repository — per-brand media_assets + ugc_ingestion_queue
 * (V2.2 §6.4, template/000037). Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");
const { t } = require("../../config/brands");

const ex = (c) => (c ? c.query.bind(c) : query);

// ── media_assets ───────────────────────────────────────────
async function findAsset({ client, brand, asset_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "media_assets")} WHERE asset_id = $1`,
    [asset_id],
  );
  return rows[0] || null;
}

async function insertAsset({ client, brand, asset }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "media_assets")}
       (asset_kind, storage_path, mime_type, original_byte_size, source_kind,
        source_external_url, source_creator_handle, source_creator_contact_id,
        caption, alt_text, uploaded_by, processing_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending')
     RETURNING *`,
    [
      asset.asset_kind,
      asset.storage_path,
      asset.mime_type,
      asset.original_byte_size,
      asset.source_kind,
      asset.source_external_url || null,
      asset.source_creator_handle || null,
      asset.source_creator_contact_id || null,
      asset.caption || null,
      asset.alt_text || null,
      asset.uploaded_by || null,
    ],
  );
  return rows[0];
}

async function setProcessing({ client, brand, asset_id }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "media_assets")}
        SET processing_status = 'processing', updated_at = now()
      WHERE asset_id = $1 AND processing_status IN ('pending','failed')
      RETURNING *`,
    [asset_id],
  );
  return rows[0] || null;
}

async function setReady({ client, brand, asset_id, fields }) {
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "media_assets")}
        SET processing_status = 'ready',
            storage_path        = COALESCE($2, storage_path),
            compressed_byte_size = $3,
            width               = $4,
            height              = $5,
            duration_sec        = $6,
            poster_path         = $7,
            thumbnail_path      = $8,
            compressed_at       = now(),
            ffmpeg_log          = $9,
            updated_at          = now()
      WHERE asset_id = $1
      RETURNING *`,
    [
      asset_id,
      fields.storage_path || null,
      fields.compressed_byte_size !== null &&
      fields.compressed_byte_size !== undefined
        ? fields.compressed_byte_size
        : null,
      fields.width !== null && fields.width !== undefined ? fields.width : null,
      fields.height !== null && fields.height !== undefined
        ? fields.height
        : null,
      fields.duration_sec !== null && fields.duration_sec !== undefined
        ? fields.duration_sec
        : null,
      fields.poster_path || null,
      fields.thumbnail_path || null,
      fields.ffmpeg_log || null,
    ],
  );
  return rows[0] || null;
}

async function setFailed({ client, brand, asset_id, log }) {
  await ex(client)(
    `UPDATE ${t(brand, "media_assets")}
        SET processing_status = 'failed', ffmpeg_log = $2, updated_at = now()
      WHERE asset_id = $1`,
    [asset_id, log || null],
  );
}

// ── ugc_ingestion_queue ────────────────────────────────────
async function listQueuedUgc({ brand, limit = 20 }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "ugc_ingestion_queue")}
      WHERE processing_status = 'queued'
      ORDER BY created_at LIMIT $1`,
    [limit],
  );
  return rows;
}

async function setUgcStatus({
  client,
  brand,
  ingestion_id,
  status,
  fields = {},
}) {
  const set = ["processing_status = $2"];
  const params = [ingestion_id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "ugc_ingestion_queue")}
        SET ${set.join(", ")}
      WHERE ingestion_id = $1
      RETURNING *`,
    params,
  );
  return rows[0] || null;
}

module.exports = {
  findAsset,
  insertAsset,
  setProcessing,
  setReady,
  setFailed,
  listQueuedUgc,
  setUgcStatus,
};
