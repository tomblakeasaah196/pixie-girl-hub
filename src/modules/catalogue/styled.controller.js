/**
 * Styled products (V2.2 §6.4 P0-6) — HTTP controllers.
 */

"use strict";

const service = require("./styled.service");
const productAi = require("./product_ai.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function list(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.list({
      brand: req.brand,
      filters: {
        q: req.query.q,
        base_product_id: req.query.base_product_id,
        category_id: req.query.category_id,
        status: req.query.status,
      },
      page,
      page_size,
    }),
  );
}

async function getOne(req, res) {
  res.json({
    data: await service.getById({ brand: req.brand, id: req.params.id }),
  });
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

async function publish(req, res) {
  res.json({
    data: await service.publish({ ...base(req), id: req.params.id }),
  });
}

async function unpublish(req, res) {
  res.json({
    data: await service.unpublish({
      ...base(req),
      id: req.params.id,
      archive: req.body ? req.body.archive : false,
    }),
  });
}

async function remove(req, res) {
  await service.remove({ ...base(req), id: req.params.id });
  res.status(204).end();
}

async function listTrash(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(await service.listTrash({ brand: req.brand, page, page_size }));
}

async function restore(req, res) {
  res.json({
    data: await service.restore({ ...base(req), id: req.params.id }),
  });
}

// AI drafts a Styled product over a base — saved as a DRAFT for review.
async function aiDraft(req, res) {
  res.status(201).json({
    data: await productAi.draftStyled({ ...base(req), input: req.body }),
  });
}

// ── Production DNA + default materials (Stylist Studio) ────
async function getProduction(req, res) {
  res.json({
    data: await service.getProduction({ brand: req.brand, id: req.params.id }),
  });
}
async function saveProduction(req, res) {
  res.json({
    data: await service.saveProduction({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function addBom(req, res) {
  res.status(201).json({
    data: await service.addBomItem({
      ...base(req),
      id: req.params.id,
      item: req.body,
    }),
  });
}
async function removeBom(req, res) {
  res.json({
    data: await service.removeBomItem({
      ...base(req),
      id: req.params.id,
      bom_id: req.params.bomId,
    }),
  });
}

module.exports = {
  list,
  getOne,
  create,
  update,
  publish,
  unpublish,
  remove,
  listTrash,
  restore,
  aiDraft,
  getProduction,
  saveProduction,
  addBom,
  removeBom,
};
