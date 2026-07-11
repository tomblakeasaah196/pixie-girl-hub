/**
 * Chief of Staff (PR5) — RAG memory.
 *
 * Keeps a semantic memory of the CEO's goals / milestones / notes / decisions in
 * the SHARED knowledge corpus (via cos.memory.repo), so the CoS can answer
 * "how is X doing?" / "what did I decide about Y?" from real history instead of
 * only the current turn. On any goal/note/decision change we (re)build a compact
 * text chunk and enqueue the shared ai-embed worker; on delete we forget it.
 *
 * Everything here is BEST-EFFORT and degrades cleanly: with no embeddings vendor
 * configured the chunk text is still written (so a later re-embed pass indexes
 * it) and retrieval simply returns [] — the caller then falls back to a
 * deterministic answer from live goal data. Indexing never throws into a write
 * path.
 */

"use strict";

const repo = require("./cos.memory.repo");
const embeddings = require("../../services/embeddings.service");
const rag = require("../../ai/rag-pipeline");
const { enqueue } = require("../../jobs/queue-producer");
const { logger } = require("../../config/logger");

const clip = (s, n) => (s === null || s === undefined ? "" : String(s).slice(0, n));

// ── Pure chunk-text builders (unit-tested, no I/O) ─────────

/** Human-readable memory of a goal + its milestones. */
function goalChunkText({ goal, milestones = [] }) {
  const lines = [
    `GOAL: ${clip(goal.title, 200)}`,
    `Status: ${goal.status} · Priority: ${goal.priority} · Health: ${goal.health} · Progress: ${goal.progress_pct ?? 0}%`,
  ];
  if (goal.target_date) lines.push(`Target date: ${String(goal.target_date).slice(0, 10)}`);
  if (goal.description) lines.push(`About: ${clip(goal.description, 1200)}`);
  if (milestones.length) {
    lines.push("Milestones:");
    for (const m of milestones) {
      const when = m.target_date ? ` (by ${String(m.target_date).slice(0, 10)})` : "";
      lines.push(`  - [${m.status}] ${clip(m.title, 160)}${when}`);
    }
  }
  return lines.join("\n");
}

/** Memory of a note (optionally under a goal). */
function noteChunkText({ note, goalTitle }) {
  const head = note.title ? `NOTE: ${clip(note.title, 200)}` : "NOTE";
  const link = goalTitle ? `\nUnder goal: ${clip(goalTitle, 160)}` : "";
  return `${head}${link}\n${clip(note.body, 4000)}`;
}

/** Memory of a captured decision. */
function decisionChunkText({ text, goalTitle }) {
  const link = goalTitle ? `\nContext: ${clip(goalTitle, 160)}` : "";
  return `DECISION: ${clip(text, 3000)}${link}`;
}

/** Consistent metadata envelope carrying the owner (the retrieval scope key). */
function chunkMetadata({ user_id, subject_type, subject_id }) {
  return { user_id: String(user_id), subject_type, subject_id, kind: "cos_memory" };
}

// ── Indexing (best-effort) ─────────────────────────────────

async function indexChunk({ source_type, source_ref, business, title, content, user_id, ingested_by }) {
  try {
    const { chunk_id, changed } = await repo.upsertChunk({
      source_type,
      source_ref,
      business,
      title,
      content,
      metadata: chunkMetadata({
        user_id,
        subject_type: source_type.replace("cos_", ""),
        subject_id: source_ref,
      }),
      ingested_by: ingested_by || user_id || null,
    });
    // Only (re)embed when the text actually moved — saves vendor calls on the
    // many goal.updated events. No-ops when no embeddings provider is set.
    if (changed) {
      await enqueue("ai-embed", "embed", {
        source_table: "ai_knowledge_chunks",
        source_id: chunk_id,
        source_text: content,
        business: business || null,
        required_permissions: [],
        sensitivity: "restricted",
      });
    }
    return chunk_id;
  } catch (err) {
    logger.warn({ err: err.message, source_type, source_ref }, "cos memory: index failed (deferred)");
    return null;
  }
}

function indexGoal({ goal, milestones = [], user_id, brand }) {
  const owner = user_id || goal.owner_user_id || goal.created_by;
  if (!goal || !goal.goal_id || !owner) return Promise.resolve(null);
  return indexChunk({
    source_type: "cos_goal",
    source_ref: goal.goal_id,
    business: brand || goal.business,
    title: clip(goal.title, 240) || "Goal",
    content: goalChunkText({ goal, milestones }),
    user_id: owner,
  });
}

function indexNote({ note, goalTitle, user_id, brand }) {
  const owner = user_id || note.user_id;
  if (!note || !note.note_id || !owner) return Promise.resolve(null);
  return indexChunk({
    source_type: "cos_note",
    source_ref: note.note_id,
    business: brand || note.business,
    title: clip(note.title, 240) || "Note",
    content: noteChunkText({ note, goalTitle }),
    user_id: owner,
  });
}

function indexDecision({ decision_id, text, goalTitle, user_id, brand }) {
  if (!decision_id || !text || !user_id) return Promise.resolve(null);
  return indexChunk({
    source_type: "cos_decision",
    source_ref: decision_id,
    business: brand,
    title: `Decision: ${clip(text, 120)}`,
    content: decisionChunkText({ text, goalTitle }),
    user_id,
  });
}

function forgetGoal({ goal_id }) {
  return repo.deleteChunksForSubject({ source_type: "cos_goal", source_ref: goal_id }).catch(() => 0);
}
function forgetNote({ note_id }) {
  return repo.deleteChunksForSubject({ source_type: "cos_note", source_ref: note_id }).catch(() => 0);
}

// ── Retrieval ──────────────────────────────────────────────

function isEnabled() {
  return embeddings.isConfigured();
}

/**
 * Nearest CoS memory chunks for a natural-language query, scoped to this user +
 * brand. Returns [] when embeddings are off or nothing scores — the caller then
 * answers deterministically from live goal data.
 */
async function retrieve({ user, brand, queryText, topK = 6 }) {
  if (!queryText || !isEnabled()) return [];
  let vec;
  try {
    vec = await rag.embedText(queryText);
  } catch (err) {
    logger.debug({ err: err.message }, "cos memory: query embed failed");
    return [];
  }
  if (!vec) return [];
  return repo.retrieveCosChunks({
    queryVector: `[${vec.join(",")}]`,
    business: brand,
    user_id: user.user_id,
    topK,
  });
}

module.exports = {
  // indexing
  indexGoal,
  indexNote,
  indexDecision,
  forgetGoal,
  forgetNote,
  // retrieval
  retrieve,
  isEnabled,
  // pure builders (exposed for tests)
  goalChunkText,
  noteChunkText,
  decisionChunkText,
  chunkMetadata,
};
