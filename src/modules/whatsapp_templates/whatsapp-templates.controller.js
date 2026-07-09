"use strict";

const service = require("./whatsapp-templates.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function list(req, res) {
  res.json({ data: await service.listTemplates({ brand: req.brand }) });
}

async function sync(req, res) {
  res.json({ data: await service.sync(ctx(req)) });
}

async function create(req, res) {
  res.status(201).json({
    data: await service.createTemplate({ ...ctx(req), input: req.body }),
  });
}

async function update(req, res) {
  res.json({
    data: await service.updateTemplate({
      ...ctx(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}

async function submit(req, res) {
  res.json({
    data: await service.submitTemplate({ ...ctx(req), id: req.params.id }),
  });
}

async function remove(req, res) {
  await service.deleteTemplate({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}

async function listRates(req, res) {
  res.json({ data: await service.listRates({ brand: req.brand }) });
}

async function setRate(req, res) {
  res.json({
    data: await service.setRate({
      ...ctx(req),
      category: req.body.category,
      amount_ngn: req.body.amount_ngn,
      note: req.body.note,
    }),
  });
}

module.exports = {
  list,
  sync,
  create,
  update,
  submit,
  remove,
  listRates,
  setRate,
};
