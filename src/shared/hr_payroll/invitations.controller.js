/**
 * Staff invitations controller (F-15). Admin handlers (create/list/revoke) and
 * public handlers (token preview + accept). HTTP only.
 */

"use strict";

const service = require("./invitations.service");
const { parsePagination } = require("../../utils/pagination");

// ── Admin ──────────────────────────────────────────────────
async function create(req, res) {
  res.status(201).json({
    data: await service.createInvitation({
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}
async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listInvitations({
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function revoke(req, res) {
  res.json({
    data: await service.revokeInvitation({
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
    }),
  });
}
async function provision(req, res) {
  res.status(201).json({
    data: await service.provisionLogin({
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

// ── Public ─────────────────────────────────────────────────
async function preview(req, res) {
  res.json({ data: await service.getByToken({ token: req.query.token }) });
}
async function accept(req, res) {
  res.status(201).json({
    data: await service.acceptInvitation({
      token: req.body.token,
      password: req.body.password,
      display_name: req.body.display_name,
    }),
  });
}

module.exports = { create, list, revoke, provision, preview, accept };
