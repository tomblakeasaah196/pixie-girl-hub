/**
 * Social Media Management (V2.2 §6.14) — HTTP controller.
 */

"use strict";

const service = require("./social.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listAccounts(req, res) {
  res.json({ data: await service.listAccounts({ brand: req.brand }) });
}
async function connectAccount(req, res) {
  res.status(201).json({
    data: await service.connectAccount({ ...base(req), input: req.body }),
  });
}
async function revokeAccount(req, res) {
  await service.revokeAccount({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function listPosts(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listPosts({
      brand: req.brand,
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function getPost(req, res) {
  res.json({
    data: await service.getPost({ brand: req.brand, id: req.params.id }),
  });
}
async function createPost(req, res) {
  res.status(201).json({
    data: await service.createPost({ ...base(req), input: req.body }),
  });
}
async function publishPost(req, res) {
  res.json({
    data: await service.publishPost({
      ...base(req),
      id: req.params.id,
      external_post_id: req.body.external_post_id,
    }),
  });
}
async function reschedulePost(req, res) {
  res.json({
    data: await service.reschedule({
      ...base(req),
      id: req.params.id,
      scheduled_for: req.body.scheduled_for,
    }),
  });
}
async function recordMetrics(req, res) {
  res.json({
    data: await service.recordMetrics({
      brand: req.brand,
      id: req.params.id,
      metric_date: req.body.metric_date,
      metrics: req.body.metrics,
    }),
  });
}
async function refreshMetrics(req, res) {
  res.json({
    data: await service.refreshMetrics({ brand: req.brand, id: req.params.id }),
  });
}
async function ingestInboundDM(req, res) {
  res.status(201).json({
    data: await service.ingestInboundDM({ ...base(req), input: req.body }),
  });
}

module.exports = {
  listAccounts,
  connectAccount,
  revokeAccount,
  listPosts,
  getPost,
  createPost,
  publishPost,
  reschedulePost,
  recordMetrics,
  refreshMetrics,
  ingestInboundDM,
};
