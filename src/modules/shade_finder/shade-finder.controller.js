/**
 * Shade Finder — HTTP controllers (thin; all logic in the service).
 *
 * Public endpoints — brand resolves from X-Brand-Context / ?brand exactly
 * like the other storefront public controllers; the guest principal comes
 * from the shade-guest token (requireGuest in the routes).
 */

"use strict";

const { VALID_BRANDS } = require("../../config/brands");
const { AppError } = require("../../utils/errors");
const service = require("./shade-finder.service");

function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  const brand = String(h || "pixiegirl").toLowerCase();
  // VALID_BRANDS is a live Set (config/brands) — membership is .has(), not
  // .includes(). Using .includes here threw on every call → 500 on /session.
  if (!VALID_BRANDS.has(brand)) {
    throw new AppError("INVALID_BRAND", `unknown brand ${brand}`, 400, {
      user_message: "Unknown storefront.",
    });
  }
  return brand;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

async function startSession(req, res) {
  const brand = brandHint(req);
  const data = await service.startSession({
    brand,
    device_id: req.headers["x-device-id"],
    ip: clientIp(req),
  });
  res.status(201).json({ data });
}

async function getSession(req, res) {
  const data = await service.getSessionState({
    brand: req.shadeGuest.brand,
    sid: req.shadeGuest.sid,
    deviceKey: req.shadeGuest.dk,
  });
  res.json({ data });
}

async function endSession(req, res) {
  const data = await service.endSession({
    brand: req.shadeGuest.brand,
    sid: req.shadeGuest.sid,
  });
  res.json({ data });
}

async function analyze(req, res) {
  if (!req.file || !req.file.buffer) {
    throw new AppError("PHOTO_REQUIRED", "no photo in request", 400, {
      user_message: "Please attach a photo for Praxis to look at.",
    });
  }
  const data = await service.analyzePhoto({
    brand: req.shadeGuest.brand,
    sid: req.shadeGuest.sid,
    deviceKey: req.shadeGuest.dk,
    ip: clientIp(req),
    file: req.file,
    message: req.body.message,
  });
  res.json({ data });
}

async function chat(req, res) {
  const data = await service.chatTurn({
    brand: req.shadeGuest.brand,
    sid: req.shadeGuest.sid,
    deviceKey: req.shadeGuest.dk,
    message: req.body.message,
  });
  res.json({ data });
}

module.exports = {
  startSession,
  getSession,
  endSession,
  analyze,
  chat,
  // exported for unit tests
  _internal: { brandHint },
};
