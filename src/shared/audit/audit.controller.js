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
 * The caller's own audit trail. Paginated 10/page, capped at 3 pages (30 rows
 * total). No extra permission required — every authenticated user can see
 * their own actions, and the dashboard uses this to spot activity that wasn't
 * theirs so they can rotate credentials.
 */
async function myFeed(req, res) {
  const page = Math.max(1, Number.parseInt(req.query.page ?? "1", 10) || 1);
  const result = await service.myFeed({
    user_id: req.user.user_id,
    page,
    page_size: 10,
    max_total: 30,
  });
  res.json(result);
}

module.exports = { list, getById, forRecord, myFeed };
