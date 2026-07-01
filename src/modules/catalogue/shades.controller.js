/**
 * Product Shades (V2.2 §6.4 — "Shop by shade") — HTTP controllers.
 * Thin: req/res only; all logic lives in the service / io engine.
 */

"use strict";

const service = require("./shades.service");
const io = require("./shades.io");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

function sendXlsx(res, buffer, filename) {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(buffer);
}
function requireFile(req, res) {
  if (req.file) return true;
  res.status(400).json({
    error: { code: "NO_FILE", message: "Multipart field 'file' is required" },
    request_id: req.request_id,
  });
  return false;
}

const list = async (req, res) =>
  res.json({ data: await service.list({ brand: req.brand }) });

const getOne = async (req, res) =>
  res.json({
    data: await service.getById({ brand: req.brand, id: req.params.shadeId }),
  });

// Storefront read by SEO slug — shade metadata + its styled products.
const getBySlug = async (req, res) =>
  res.json({
    data: await service.getBySlug({ brand: req.brand, slug: req.params.slug }),
  });

const create = async (req, res) =>
  res
    .status(201)
    .json({ data: await service.create({ ...base(req), input: req.body }) });

const update = async (req, res) =>
  res.json({
    data: await service.update({
      ...base(req),
      id: req.params.shadeId,
      patch: req.body,
    }),
  });

const remove = async (req, res) => {
  await service.remove({ ...base(req), id: req.params.shadeId });
  res.status(204).end();
};

const assignMembers = async (req, res) =>
  res.status(201).json({
    data: await service.assignMembers({
      ...base(req),
      id: req.params.shadeId,
      styled_ids: req.body.styled_ids,
    }),
  });

const removeMember = async (req, res) => {
  await service.unassignMember({
    ...base(req),
    id: req.params.shadeId,
    styled_id: req.params.styledId,
  });
  res.status(204).end();
};

// ── Import / Export ──────────────────────────────────────
async function template(req, res) {
  sendXlsx(
    res,
    await io.shadesTemplate({ brand: req.brand }),
    "shades-import-template.xlsx",
  );
}
async function exportShades(req, res) {
  sendXlsx(
    res,
    await io.exportShades({ brand: req.brand }),
    `shades-${req.brand}.xlsx`,
  );
}
async function importShades(req, res) {
  if (!requireFile(req, res)) return;
  res.status(201).json({
    data: await io.importShades({ ...base(req), buffer: req.file.buffer }),
  });
}

module.exports = {
  list,
  getOne,
  getBySlug,
  create,
  update,
  remove,
  assignMembers,
  removeMember,
  template,
  exportShades,
  importShades,
};
