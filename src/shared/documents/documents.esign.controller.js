/**
 * Documents & Signatures (V2.2 §6.13) — e-signature HTTP controllers.
 * Admin actions are brand-scoped + permission-gated; the *ByToken handlers
 * are reached from the public router (no auth) and identify the signer by
 * their unguessable signing_token.
 */

"use strict";

const service = require("./documents.esign.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});
const reqMeta = (req) => ({
  ip: req.ip,
  ua: req.get("user-agent"),
  device: req.get("x-device"),
});

// ── Admin ──────────────────────────────────────────────
async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listRequests({
      brand: req.brand,
      filters: {
        status: req.query.status,
        request_type: req.query.request_type,
      },
      page,
      page_size,
    }),
  );
}
const getById = async (req, res) =>
  res.json({
    data: await service.getRequest({ brand: req.brand, id: req.params.id }),
  });
const create = async (req, res) =>
  res.status(201).json({
    data: await service.createRequest({ ...base(req), input: req.body }),
  });
const send = async (req, res) =>
  res.json({
    data: await service.sendRequest({ ...base(req), id: req.params.id }),
  });
const cancel = async (req, res) =>
  res.json({
    data: await service.cancelRequest({ ...base(req), id: req.params.id }),
  });
const voidRequest = async (req, res) =>
  res.json({
    data: await service.voidRequest({
      ...base(req),
      id: req.params.id,
      reason: req.body?.reason,
    }),
  });
const verify = async (req, res) =>
  res.json({
    data: await service.verifyChain({ brand: req.brand, id: req.params.id }),
  });

// ── Public (token-based, no auth) ──────────────────────
const viewByToken = async (req, res) =>
  res.json({
    data: await service.viewByToken({
      token: req.params.token,
      ...reqMeta(req),
    }),
  });
const signByToken = async (req, res) =>
  res.json({
    data: await service.signByToken({
      token: req.params.token,
      ...reqMeta(req),
      captured_signature_path: req.body?.captured_signature_path,
      signature_image_byte_size: req.body?.signature_image_byte_size,
    }),
  });
const declineByToken = async (req, res) =>
  res.json({
    data: await service.declineByToken({
      token: req.params.token,
      ...reqMeta(req),
      reason: req.body?.reason,
    }),
  });

module.exports = {
  list,
  getById,
  create,
  send,
  cancel,
  voidRequest,
  verify,
  viewByToken,
  signByToken,
  declineByToken,
};
