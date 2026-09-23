"use strict";

const service = require("./care-accessories.service");
const gate = require("./care-accessories.gate");
const { parsePagination } = require("../../utils/pagination");
const context = (req) => ({ brand: req.brand, user: req.user, request_id: req.request_id });

const availability = (req, res) => res.json({ data: { enabled: gate.enabled(req.brand) } });
const categories = async (req, res) => res.json({ data: await service.categories({ brand: req.brand }) });
const list = async (req, res) => {
  const { page, page_size } = parsePagination(req.query);
  res.json(await service.list({
    brand: req.brand, page, page_size,
    q: req.query.q, category_id: req.query.category_id, status: req.query.status,
  }));
};
const getOne = async (req, res) => res.json({ data: await service.getOne({ brand: req.brand, id: req.params.id }) });
const create = async (req, res) => res.status(201).json({ data: await service.create({ ...context(req), input: req.body }) });
const importProducts = async (req, res) => res.status(201).json({ data: await service.importProducts({ ...context(req), input: req.body }) });
const clone = async (req, res) => res.status(201).json({ data: await service.clone({ ...context(req), id: req.params.id, input: req.body }) });
const update = async (req, res) => res.json({ data: await service.update({ ...context(req), id: req.params.id, patch: req.body }) });
const publish = async (req, res) => res.json({ data: await service.publish({ ...context(req), id: req.params.id }) });
const unpublish = async (req, res) => res.json({ data: await service.unpublish({ ...context(req), id: req.params.id, archive: req.body.archive }) });
const addVariant = async (req, res) => res.status(201).json({ data: await service.addVariant({ ...context(req), id: req.params.id, input: req.body }) });
const updateVariant = async (req, res) => res.json({ data: await service.updateVariant({ ...context(req), id: req.params.id, variant_id: req.params.variantId, patch: req.body }) });
const deactivateVariant = async (req, res) => res.json({ data: await service.deactivateVariant({ ...context(req), id: req.params.id, variant_id: req.params.variantId }) });
const remove = async (req, res) => res.json({ data: await service.remove({ ...context(req), id: req.params.id }) });
const listTrash = async (req, res) => {
  const { page, page_size } = parsePagination(req.query);
  res.json(await service.listTrash({ brand: req.brand, page, page_size }));
};
const restore = async (req, res) => res.json({ data: await service.restore({ ...context(req), id: req.params.id }) });

module.exports = {
  availability, categories, list, getOne, create, importProducts, clone,
  update, publish, unpublish, addVariant, updateVariant, deactivateVariant,
  remove, listTrash, restore,
};
