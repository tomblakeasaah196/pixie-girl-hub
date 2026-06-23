/**
 * Delivery zones — HTTP controller.
 */

"use strict";

const service = require("./zones.service");
const zonesImportExport = require("./zones.import-export");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function list(req, res) {
  res.json({ data: await service.list({ brand: req.brand }) });
}
async function create(req, res) {
  res.status(201).json({
    data: await service.create({ ...base(req), input: req.body }),
  });
}
async function update(req, res) {
  res.json({
    data: await service.update({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function remove(req, res) {
  await service.remove({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function quote(req, res) {
  res.json({
    data: await service.quote({
      brand: req.brand,
      lat: req.query.lat,
      lng: req.query.lng,
      country_code: req.query.country,
      qty: req.query.qty != null ? Number(req.query.qty) : undefined,
    }),
  });
}

async function exportTemplate(req, res) {
  const buffer = await zonesImportExport.buildTemplate({ brand: req.brand });
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="delivery-zones-template.xlsx"',
  );
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.send(buffer);
}

async function importRates(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const result = await zonesImportExport.importFromBuffer({
    brand: req.brand,
    buffer: req.file.buffer,
    user_id: req.user ? req.user.user_id : null,
  });
  res.json({ data: result });
}

module.exports = { list, create, update, remove, quote, exportTemplate, importRates };
