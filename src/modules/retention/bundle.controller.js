/**
 * Bundle offers (F-2 / PD §6.23.4) — HTTP controller. Authenticated; req.brand.
 */

"use strict";

const service = require("./bundle.service");

async function create(req, res) {
  res.status(201).json({
    data: await service.createBundle({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      input: req.body,
    }),
  });
}

async function list(req, res) {
  res.json({
    data: await service.listBundles({
      brand: req.brand,
      only_active: req.query.active === "true",
      storefront: req.query.storefront === "true",
    }),
  });
}

async function getOne(req, res) {
  res.json({
    data: await service.getBundle({ brand: req.brand, id: req.params.id }),
  });
}

async function update(req, res) {
  res.json({
    data: await service.updateBundle({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      patch: req.body,
    }),
  });
}

async function setActive(req, res) {
  res.json({
    data: await service.setBundleActive({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      is_active: req.body.is_active,
    }),
  });
}

async function addComponent(req, res) {
  res.status(201).json({
    data: await service.addComponent({
      brand: req.brand,
      id: req.params.id,
      component: req.body,
    }),
  });
}

async function removeComponent(req, res) {
  res.json({
    data: await service.removeComponent({
      brand: req.brand,
      id: req.params.id,
      bundle_product_id: req.params.componentId,
    }),
  });
}

async function price(req, res) {
  res.json({
    data: await service.priceBundle({
      brand: req.brand,
      bundle_id: req.params.id,
      component_subtotal_ngn: req.body.component_subtotal_ngn,
    }),
  });
}

async function remove(req, res) {
  await service.deleteBundle({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    id: req.params.id,
  });
  res.status(204).end();
}

function collageFonts(_req, res) {
  res.json({ data: { fonts: service.listCollageFonts() } });
}

async function generateCollage(req, res) {
  res.json({
    data: await service.generateCollageCover({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      id: req.params.id,
      settings: req.body.settings || {},
    }),
  });
}

async function applyCollageAll(req, res) {
  res.json({
    data: await service.applyCollageStyleToAll({
      brand: req.brand,
      user: req.user,
      request_id: req.request_id,
      settings: req.body.settings || {},
    }),
  });
}

module.exports = {
  create,
  list,
  getOne,
  update,
  setActive,
  addComponent,
  removeComponent,
  price,
  remove,
  collageFonts,
  generateCollage,
  applyCollageAll,
};
