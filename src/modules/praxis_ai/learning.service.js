/**
 * Praxis self-learning (§8.5). The model's weights never change — instead its
 * KNOWLEDGE grows and corrects itself from use (retrieval-augmented learning):
 *
 *   • teach(fact)        — a trusted user stores a durable fact/rule.
 *   • recordFeedback()   — 👍/👎 on an answer; a 👎 WITH a correction from a
 *                          trusted user becomes a knowledge chunk.
 *
 * Taught facts + corrections are written to shared.ai_knowledge_chunks
 * (source_type 'custom') and embedded IMMEDIATELY, so they're retrievable on
 * the very next turn — no reindex needed. Only the CEO can teach/correct, so
 * the corpus can't be poisoned by arbitrary users.
 */

"use strict";

const crypto = require("crypto");
const { query } = require("../../config/database");
const embeddings = require("../../services/embeddings.service");
const embedJob = require("../../jobs/processors/ai-embed-processor");
const storage = require("../../services/storage.service");
const { audit } = require("../../middleware/audit");
const { logger } = require("../../config/logger");
const { AppError } = require("../../utils/errors");

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const tok = (s) => Math.max(1, Math.ceil((s || "").length / 4));
const CHUNK_TARGET = 1400; // chars per chunk (matches the doc ingester)

/** Split long text into ~CHUNK_TARGET-char chunks on paragraph boundaries. */
function chunkText(text) {
  const clean = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_TARGET) return [clean];
  const paras = clean.split(/\n\s*\n/);
  const out = [];
  let acc = "";
  for (const p of paras) {
    if ((acc + "\n\n" + p).length > CHUNK_TARGET && acc) {
      out.push(acc.trim());
      acc = p;
    } else {
      acc = acc ? `${acc}\n\n${p}` : p;
    }
  }
  if (acc.trim()) out.push(acc.trim());
  return out;
}

const TEXT_MIME = /^(text\/|application\/(json|xml|csv|x-yaml|yaml))/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|ya?ml|html?|xml|log)$/i;

/**
 * Best-effort text extraction from an uploaded buffer. Returns "" when a type
 * can't be extracted here (image/audio/video/office) — those are still trained
 * on their title + note. PDF uses pdf-parse if it's installed (lazy require);
 * everything else that looks textual is decoded as UTF-8.
 */
async function extractText(buffer, mime, filename) {
  const m = (mime || "").toLowerCase();
  const name = filename || "";
  if (TEXT_MIME.test(m) || TEXT_EXT.test(name)) {
    return buffer.toString("utf8");
  }
  if (m === "application/pdf" || /\.pdf$/i.test(name)) {
    try {
      // Optional dep — degrade gracefully if not installed.
      // eslint-disable-next-line global-require
      const pdfParse = require("pdf-parse");
      const parsed = await pdfParse(buffer);
      return parsed.text || "";
    } catch (e) {
      logger.warn({ err: e.message }, "praxis train: PDF text extraction unavailable");
      return "";
    }
  }
  return ""; // images/audio/video/office → trained via title + note
}

/** Only trusted users teach Praxis — prevents corpus poisoning. */
function canTeach(user) {
  return Boolean(user && user.is_ceo === true);
}

/**
 * Insert a knowledge chunk and embed it now (best-effort). `source_ref` is
 * deterministic for corrections (so re-correcting replaces), random for facts.
 */
async function insertAndEmbed({ brand, title, content, source_ref, replace }) {
  if (replace) {
    await query(`DELETE FROM shared.ai_knowledge_chunks WHERE source_ref = $1`, [
      source_ref,
    ]);
  }
  const { rows } = await query(
    `INSERT INTO shared.ai_knowledge_chunks
       (source_type, source_ref, business, title, content, token_count,
        required_permissions, sensitivity, content_hash)
     VALUES ('custom',$1,$2,$3,$4,$5,'{}','normal',$6)
     RETURNING chunk_id`,
    [source_ref, brand || null, title.slice(0, 240), content, tok(content), sha256(content)],
  );
  const chunk_id = rows[0].chunk_id;
  try {
    if (embeddings.isConfigured()) {
      await embedJob({
        id: `learn:${chunk_id}`,
        data: {
          source_table: "ai_knowledge_chunks",
          source_id: chunk_id,
          source_text: content,
          business: brand || null,
          required_permissions: [],
          sensitivity: "normal",
        },
      });
    }
  } catch (e) {
    // If embedding fails now, the next `npm run ai:reindex` backfills it.
    logger.warn({ err: e.message }, "praxis learn: immediate embed failed (will backfill)");
  }
  return chunk_id;
}

async function teach({ user, brand, request_id, title, content }) {
  if (!canTeach(user)) {
    throw new AppError("FORBIDDEN", "Only the CEO can teach Praxis.", 403);
  }
  const chunk_id = await insertAndEmbed({
    brand,
    title: title || "Taught fact",
    content,
    source_ref: `taught/${crypto.randomUUID()}`,
  });
  await audit({
    business: brand || null,
    user_id: user.user_id,
    action_key: "praxis.teach",
    target_type: "ai_knowledge_chunk",
    target_id: chunk_id,
    after: { title: title || null },
    request_id,
  });
  return { chunk_id };
}

async function recordFeedback({
  user,
  brand,
  request_id,
  message_id,
  conversation_id,
  rating,
  comment,
}) {
  // A trusted 👎 with a correction becomes durable knowledge.
  let taught_chunk_id = null;
  if (rating === "down" && comment && comment.trim() && canTeach(user)) {
    taught_chunk_id = await insertAndEmbed({
      brand,
      title: "Correction (from CEO)",
      content: `Correction: ${comment.trim()}`,
      source_ref: `correction/${message_id}`,
      replace: true, // re-correcting the same answer supersedes the old one
    });
  }

  await query(
    `INSERT INTO shared.ai_message_feedback
       (message_id, conversation_id, user_id, rating, comment, taught_chunk_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (message_id, user_id)
     DO UPDATE SET rating = EXCLUDED.rating,
                   comment = EXCLUDED.comment,
                   taught_chunk_id = COALESCE(EXCLUDED.taught_chunk_id,
                                              shared.ai_message_feedback.taught_chunk_id),
                   updated_at = now()`,
    [message_id, conversation_id || null, user.user_id, rating, comment || null, taught_chunk_id],
  );

  await audit({
    business: brand || null,
    user_id: user.user_id,
    action_key: "praxis.feedback",
    target_type: "ai_message",
    target_id: message_id,
    after: { rating, taught: Boolean(taught_chunk_id) },
    request_id,
  });
  return { ok: true, taught_chunk_id };
}

/**
 * Ingest an uploaded file as training material: store it, extract what text we
 * can, chunk + embed (title + note + extracted text) so Praxis can retrieve it,
 * and record the source in ai_training_sources for the UI to list/delete.
 * CEO-gated (same trust boundary as teach) to prevent corpus poisoning.
 */
async function ingestUpload({ user, brand, request_id, file, title, note }) {
  if (!canTeach(user)) {
    throw new AppError("FORBIDDEN", "Only the CEO can train Praxis.", 403);
  }
  if (!file || !file.buffer) {
    throw new AppError("NO_FILE", "No file was uploaded.", 400);
  }

  const displayTitle = (title || file.originalname || "Uploaded material").slice(0, 200);
  let storage_key = null;
  let status = "stored";
  let chunk_count = 0;
  let extract_chars = 0;
  let error = null;

  // 1) Store the raw file so it can be re-processed later (e.g. once OCR lands).
  try {
    const key = `ai-training/${brand || "global"}/${crypto.randomUUID()}-${(file.originalname || "file").replace(/[^\w.\-]+/g, "_")}`;
    const stored = await storage.put(file.buffer, {
      key,
      contentType: file.mimetype,
    });
    storage_key = stored.key;
  } catch (e) {
    logger.warn({ err: e.message }, "praxis train: file store failed (continuing)");
  }

  // 2) Extract text + build the trainable content (always includes title/note,
  //    so even non-extractable media contributes something searchable).
  let extracted = "";
  try {
    extracted = await extractText(file.buffer, file.mimetype, file.originalname);
  } catch (e) {
    error = `extract: ${e.message}`;
  }
  extract_chars = extracted.length;

  // 3) Insert the source row first so chunks can reference its id.
  const { rows: srcRows } = await query(
    `INSERT INTO shared.ai_training_sources
       (business, uploaded_by, title, note, kind, original_filename, mime_type,
        storage_key, byte_size, status, extract_chars)
     VALUES ($1,$2,$3,$4,'file',$5,$6,$7,$8,'stored',$9)
     RETURNING source_id`,
    [
      brand || null,
      user.user_id,
      displayTitle,
      note || null,
      file.originalname || null,
      file.mimetype || null,
      storage_key,
      file.size || file.buffer.length,
      extract_chars,
    ],
  );
  const source_id = srcRows[0].source_id;

  // 4) Chunk + embed. The header line anchors retrieval to the source.
  const header = `Training material: ${displayTitle}${note ? ` — ${note}` : ""}`;
  const bodyChunks = chunkText(extracted);
  const pieces = bodyChunks.length ? bodyChunks : [header];
  try {
    for (let i = 0; i < pieces.length; i++) {
      const content = i === 0 ? `${header}\n\n${pieces[i]}` : pieces[i];
      await insertAndEmbed({
        brand,
        title: displayTitle,
        content: content.slice(0, 8000),
        source_ref: `upload/${source_id}#${i}`,
      });
      chunk_count += 1;
    }
    status = "embedded";
  } catch (e) {
    status = "failed";
    error = `${error ? error + "; " : ""}embed: ${e.message}`;
  }

  await query(
    `UPDATE shared.ai_training_sources
        SET status = $2, chunk_count = $3, error = $4, updated_at = now()
      WHERE source_id = $1`,
    [source_id, status, chunk_count, error],
  );

  await audit({
    business: brand || null,
    user_id: user.user_id,
    action_key: "praxis.train_upload",
    target_type: "ai_training_source",
    target_id: source_id,
    after: { title: displayTitle, chunks: chunk_count, status },
    request_id,
  });

  return { source_id, title: displayTitle, status, chunk_count, extract_chars };
}

async function listTrainingSources({ brand }) {
  const { rows } = await query(
    `SELECT s.source_id, s.title, s.note, s.kind, s.original_filename,
            s.mime_type, s.byte_size, s.status, s.chunk_count, s.extract_chars,
            s.error, s.created_at, u.display_name AS uploaded_by_name
       FROM shared.ai_training_sources s
       LEFT JOIN shared.users u ON u.user_id = s.uploaded_by
      WHERE (s.business IS NULL OR s.business = $1)
      ORDER BY s.created_at DESC
      LIMIT 200`,
    [brand || null],
  );
  return rows;
}

async function deleteTrainingSource({ user, brand, request_id, source_id }) {
  if (!canTeach(user)) {
    throw new AppError("FORBIDDEN", "Only the CEO can manage Praxis training.", 403);
  }
  const { rows } = await query(
    `SELECT source_id, storage_key FROM shared.ai_training_sources
      WHERE source_id = $1 AND (business IS NULL OR business = $2)`,
    [source_id, brand || null],
  );
  if (!rows.length) {
    throw new AppError("NOT_FOUND", "Training source not found.", 404);
  }

  // Remove the derived knowledge: find its chunks, drop their embeddings, then
  // the chunks themselves.
  const { rows: chunks } = await query(
    `SELECT chunk_id FROM shared.ai_knowledge_chunks
      WHERE source_ref LIKE $1`,
    [`upload/${source_id}#%`],
  );
  const chunkIds = chunks.map((c) => c.chunk_id);
  if (chunkIds.length) {
    await query(
      `DELETE FROM shared.ai_embeddings
        WHERE source_table = 'ai_knowledge_chunks' AND source_id = ANY($1::uuid[])`,
      [chunkIds],
    );
    await query(
      `DELETE FROM shared.ai_knowledge_chunks WHERE chunk_id = ANY($1::uuid[])`,
      [chunkIds],
    );
  }
  if (rows[0].storage_key) {
    try {
      await storage.delete(rows[0].storage_key);
    } catch {
      /* file may already be gone — ignore */
    }
  }
  await query(`DELETE FROM shared.ai_training_sources WHERE source_id = $1`, [
    source_id,
  ]);

  await audit({
    business: brand || null,
    user_id: user.user_id,
    action_key: "praxis.train_delete",
    target_type: "ai_training_source",
    target_id: source_id,
    request_id,
  });
  return { ok: true, removed_chunks: chunkIds.length };
}

module.exports = {
  teach,
  recordFeedback,
  canTeach,
  ingestUpload,
  listTrainingSources,
  deleteTrainingSource,
};
