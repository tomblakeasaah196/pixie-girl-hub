"use strict";

const service = require("./social-platforms.service");

const ctx = (req) => ({ user: req.user, request_id: req.request_id });

async function listPlatforms(req, res) {
  const includeInactive = req.query.active !== "true";
  res.json({ data: await service.listPlatforms({ includeInactive }) });
}

async function createPlatform(req, res) {
  res.status(201).json({
    data: await service.createPlatform({ ...ctx(req), input: req.body }),
  });
}

async function updatePlatform(req, res) {
  res.json({
    data: await service.updatePlatform({
      ...ctx(req),
      key: req.params.key,
      input: req.body,
    }),
  });
}

async function setActive(req, res) {
  res.json({
    data: await service.setActive({
      ...ctx(req),
      key: req.params.key,
      is_active: req.body.is_active,
    }),
  });
}

module.exports = { listPlatforms, createPlatform, updatePlatform, setActive };
