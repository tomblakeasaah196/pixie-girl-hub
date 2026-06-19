/**
 * Styled colour × size variants + size-tier/guide config — HTTP controllers.
 */

"use strict";

const service = require("./styled_variants.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── Size config (modal) ──────────────────────────────────
async function getSizeConfig(req, res) {
  res.json({ data: await service.getSizeConfig({ brand: req.brand }) });
}

async function saveSizeConfig(req, res) {
  res.json({
    data: await service.saveSizeConfig({ ...base(req), input: req.body }),
  });
}

// ── Colours ──────────────────────────────────────────────
async function listColours(req, res) {
  res.json({
    data: await service.listColours({
      brand: req.brand,
      styled_id: req.params.id,
    }),
  });
}

async function createColour(req, res) {
  res.status(201).json({
    data: await service.createColour({
      ...base(req),
      styled_id: req.params.id,
      input: req.body,
    }),
  });
}

async function updateColour(req, res) {
  res.json({
    data: await service.updateColour({
      ...base(req),
      styled_id: req.params.id,
      colour_id: req.params.colourId,
      patch: req.body,
    }),
  });
}

async function deleteColour(req, res) {
  await service.deleteColour({
    ...base(req),
    styled_id: req.params.id,
    colour_id: req.params.colourId,
  });
  res.status(204).end();
}

// ── Per-colour images ────────────────────────────────────
async function listColourImages(req, res) {
  res.json({
    data: await service.listColourImages({
      brand: req.brand,
      styled_id: req.params.id,
      colour_id: req.params.colourId,
    }),
  });
}

async function addColourImage(req, res) {
  if (!req.file)
    return res.status(400).json({
      error: { code: "NO_FILE", message: "Multipart field 'file' is required" },
      request_id: req.request_id,
    });
  res.status(201).json({
    data: await service.addColourImage({
      ...base(req),
      styled_id: req.params.id,
      colour_id: req.params.colourId,
      file: req.file,
      meta: req.body,
    }),
  });
}

async function removeColourImage(req, res) {
  await service.removeColourImage({
    ...base(req),
    styled_id: req.params.id,
    colour_id: req.params.colourId,
    image_id: req.params.imageId,
  });
  res.status(204).end();
}

// ── Variants ─────────────────────────────────────────────
async function listVariants(req, res) {
  res.json({
    data: await service.listVariants({
      brand: req.brand,
      styled_id: req.params.id,
    }),
  });
}

async function bulkCreateVariants(req, res) {
  res.status(201).json({
    data: await service.bulkCreateVariants({
      ...base(req),
      styled_id: req.params.id,
      input: req.body,
    }),
  });
}

async function updateVariant(req, res) {
  res.json({
    data: await service.updateVariant({
      ...base(req),
      styled_id: req.params.id,
      styled_variant_id: req.params.variantId,
      patch: req.body,
    }),
  });
}

async function deleteVariant(req, res) {
  await service.deleteVariant({
    ...base(req),
    styled_id: req.params.id,
    styled_variant_id: req.params.variantId,
  });
  res.status(204).end();
}

module.exports = {
  getSizeConfig,
  saveSizeConfig,
  listColours,
  createColour,
  updateColour,
  deleteColour,
  listColourImages,
  addColourImage,
  removeColourImage,
  listVariants,
  bulkCreateVariants,
  updateVariant,
  deleteVariant,
};
