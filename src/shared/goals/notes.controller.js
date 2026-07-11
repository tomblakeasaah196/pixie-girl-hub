/**
 * Workspace Notes (Chief of Staff, PR1) — HTTP controller. Thin req/res only.
 */

"use strict";

const service = require("./notes.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listNotes(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listNotes({
      brand: req.brand,
      user_id: req.user.user_id,
      goal_id: req.query.goal_id,
      pinned:
        req.query.pinned === undefined
          ? undefined
          : req.query.pinned === "true",
      search: req.query.q,
      page,
      page_size,
    }),
  );
}
async function getNote(req, res) {
  res.json({ data: await service.getNote({ ...base(req), id: req.params.id }) });
}
async function createNote(req, res) {
  res.status(201).json({
    data: await service.createNote({ ...base(req), input: req.body }),
  });
}
async function updateNote(req, res) {
  res.json({
    data: await service.updateNote({ ...base(req), id: req.params.id, patch: req.body }),
  });
}
async function deleteNote(req, res) {
  await service.deleteNote({ ...base(req), id: req.params.id });
  res.status(204).end();
}

module.exports = { listNotes, getNote, createNote, updateNote, deleteNote };
