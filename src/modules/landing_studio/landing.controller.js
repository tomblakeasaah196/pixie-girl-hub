/**
 * Landing Studio — admin controller (thin HTTP handlers).
 * Brand comes from brandContextMiddleware (req.brand).
 */

"use strict";

const service = require("./landing.service");

async function get(req, res) {
  const data = await service.getStudio({ brand: req.brand });
  res.json({ data });
}

async function save(req, res) {
  const data = await service.saveDraft({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    config: req.body.config,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.json({ data });
}

async function publish(req, res) {
  const data = await service.publish({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    ip: req.ip,
    user_agent: req.headers["user-agent"],
  });
  res.json({ data });
}

async function uploadImage(req, res) {
  const data = await service.uploadImage({ brand: req.brand, file: req.file });
  res.status(201).json({ data });
}

module.exports = { get, save, publish, uploadImage };
