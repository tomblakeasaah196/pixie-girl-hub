/**
 * Workspace Notes (Chief of Staff, PR1) — business logic.
 * Personal markdown notes, optionally linked to a goal/milestone. Owner-scoped.
 */

"use strict";

const repo = require("./notes.repo");
const events = require("./goals.events"); // note.* rides the goals emitter
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");

const A = (brand, user, action_key, target_id, after, request_id) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type: "note",
    target_id,
    after,
    request_id,
  });

function listNotes(args) {
  return repo.listNotes(args);
}

async function getNote({ brand, user, id }) {
  const note = await repo.findNote({ brand, user_id: user.user_id, id });
  if (!note) throw new NotFoundError("Note");
  return note;
}

async function createNote({ brand, user, request_id, input }) {
  const note = await repo.createNote({
    n: { ...input, business: brand, user_id: user.user_id },
  });
  await A(brand, user, "notes.create", note.note_id, { title: note.title }, request_id);
  events.emit("note.created", { brand, note_id: note.note_id, user_id: user.user_id });
  return note;
}

async function updateNote({ brand, user, request_id, id, patch }) {
  const before = await repo.findNote({ brand, user_id: user.user_id, id });
  if (!before) throw new NotFoundError("Note");
  const note = await repo.updateNote({ brand, user_id: user.user_id, id, patch });
  await A(brand, user, "notes.update", id, note, request_id);
  events.emit("note.updated", { brand, note_id: id, user_id: user.user_id });
  return note;
}

async function deleteNote({ brand, user, request_id, id }) {
  const ok = await repo.softDeleteNote({ brand, user_id: user.user_id, id });
  if (!ok) throw new NotFoundError("Note");
  await A(brand, user, "notes.delete", id, null, request_id);
  events.emit("note.updated", { brand, note_id: id, user_id: user.user_id });
}

module.exports = { listNotes, getNote, createNote, updateNote, deleteNote };
