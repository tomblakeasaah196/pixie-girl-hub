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

/**
 * The caller's own audit trail for the last 24 hours.
 * No extra permission required — every authenticated user can see their own actions.
 */
async function myFeed(req, res) {
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const result = await service.myFeed({
    brand: req.brand,
    user_id: req.user.user_id,
    from,
    limit: 20,
  });
  res.json(result);
}

module.exports = { list, getById, forRecord, myFeed };
