"use strict";

const service = require("./service-catalogue.service");
const { VALID_BRANDS } = require("../../config/brands");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

// Public requests carry no auth/brand middleware — resolve the brand from the
// X-Brand-Context header or ?brand (default pixiegirl), like the storefront.
function brandHint(req) {
  const h = req.brand || req.headers["x-brand-context"] || req.query.brand;
  return VALID_BRANDS.has(h) ? h : "pixiegirl";
}

function sendXlsx(res, buffer, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}

// ── Admin CRUD ───────────────────────────────────────────
async function listServices(req, res) {
  const data = await service.listServices({
    brand: req.brand,
    category: req.query.category,
    active_only: req.query.include_inactive !== "true",
  });
  res.json({ data });
}

async function getService(req, res) {
  const data = await service.getService({ brand: req.brand, id: req.params.id });
  res.json({ data });
}

async function createService(req, res) {
  const data = await service.createService({ ...ctx(req), input: req.body });
  res.status(201).json({ data });
}

async function updateService(req, res) {
  const data = await service.updateService({
    ...ctx(req),
    id: req.params.id,
    input: req.body,
  });
  res.json({ data });
}

async function deleteService(req, res) {
  await service.deleteService({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}

// ── Import / Export ──────────────────────────────────────
async function importTemplate(_req, res) {
  const buf = await service.importTemplate();
  sendXlsx(res, buf, "services-import-template.xlsx");
}

async function exportServices(req, res) {
  const buf = await service.exportServices({ brand: req.brand });
  sendXlsx(res, buf, `services-${req.brand}.xlsx`);
}

async function importServices(req, res) {
  if (!req.file)
    return res.status(400).json({
      error: { code: "NO_FILE", message: "Multipart field 'file' is required" },
      request_id: req.request_id,
    });
  const data = await service.importServices({
    ...ctx(req),
    buffer: req.file.buffer,
  });
  res.status(201).json({ data });
}

// ── Public storefront ────────────────────────────────────
async function publicList(req, res) {
  res.json({ data: await service.listStorefront({ brand: brandHint(req) }) });
}

async function publicGet(req, res) {
  res.json({
    data: await service.getStorefront({
      brand: brandHint(req),
      slug: req.params.slug,
    }),
  });
}

async function publicBook(req, res) {
  res.status(201).json({
    data: await service.submitBooking({
      brand: brandHint(req),
      slug: req.params.slug,
      input: req.body,
      request_id: req.request_id,
    }),
  });
}

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
  importTemplate,
  exportServices,
  importServices,
  publicList,
  publicGet,
  publicBook,
};
