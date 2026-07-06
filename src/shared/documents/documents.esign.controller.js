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
      signature_data_url: req.body?.signature_data_url,
      pin: req.body?.pin,
      save_signature: req.body?.save_signature,
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

// Token-scoped document preview — streams the PDF the signer is being asked
// to sign. The unguessable token is the authorisation.
const previewDocument = async (req, res) => {
  const doc = await service.documentForToken({ token: req.params.token });
  res.setHeader("Content-Type", doc.mime_type || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${(doc.filename || "document").replace(/["\\]/g, "")}"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.send(doc.buffer);
};

// Token-scoped download of the signed document (original + signature
// certificate). 409 while the signed copy is still being prepared.
const signedDocument = async (req, res) => {
  const doc = await service.signedDocumentForToken({ token: req.params.token });
  res.setHeader("Content-Type", doc.mime_type || "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${(doc.filename || "signed-document.pdf").replace(/["\\]/g, "")}"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.send(doc.buffer);
};

// Public verification by short code — proves a signature is genuine + intact.
const verifyByCode = async (req, res) =>
  res.json({
    data: await service.verifyByCode({ code: req.params.code }),
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
  previewDocument,
  signedDocument,
  verifyByCode,
};
