/**
 * Audit log (V2.2 §3) — HTTP controller (read-only).
 */

"use strict";

const service = require("./audit.service");
const { parsePagination } = require("../../utils/pagination");

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.list({
      brand: req.brand,
      user_id: req.query.user_id,
      module: req.query.module,
      action: req.query.action,
      table_name: req.query.table_name,
      record_id: req.query.record_id,
      is_sensitive:
        req.query.is_sensitive === undefined
          ? undefined
          : req.query.is_sensitive === "true",
      from: req.query.from,
      to: req.query.to,
      page,
      page_size,
    }),
  );
}
async function getById(req, res) {
  res.json({
    data: await service.getById({ brand: req.brand, id: req.params.id }),
  });
}
async function forRecord(req, res) {
  res.json({
    data: await service.forRecord({
      brand: req.brand,
      table_name: req.params.table_name,
      record_id: req.params.record_id,
    }),
  });
}

module.exports = { list, getById, forRecord };
