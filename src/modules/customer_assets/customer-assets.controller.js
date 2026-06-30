/**
 * Customer assets (Stylist Studio §6.24) — HTTP controller.
 */

"use strict";

const service = require("./customer-assets.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listAssets(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.list({
      brand: req.brand,
      status: req.query.status,
      owner_contact_id: req.query.owner_contact_id,
      page,
      page_size,
    }),
  );
}
async function getAsset(req, res) {
  res.json({
    data: await service.get({ brand: req.brand, id: req.params.id }),
  });
}
async function checkIn(req, res) {
  res
    .status(201)
    .json({ data: await service.checkIn({ ...base(req), input: req.body }) });
}
async function checkOut(req, res) {
  res.json({
    data: await service.checkOut({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
    }),
  });
}

module.exports = { listAssets, getAsset, checkIn, checkOut };
