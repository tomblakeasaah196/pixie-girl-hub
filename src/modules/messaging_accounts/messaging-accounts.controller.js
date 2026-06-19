"use strict";

const service = require("./messaging-accounts.service");

const ctx = (req) => ({
  user: req.user,
  brand: req.brand,
  request_id: req.request_id,
});

async function listAccounts(req, res) {
  res.json({ data: await service.listAccounts({ brand: req.brand }) });
}
async function getAccount(req, res) {
  res.json(await service.getAccount({ id: req.params.id }));
}
async function upsertAccount(req, res) {
  res
    .status(201)
    .json({
      data: await service.upsertAccount({ ...ctx(req), input: req.body }),
    });
}
async function setActive(req, res) {
  res.json({
    data: await service.setActive({
      ...ctx(req),
      id: req.params.id,
      is_active: req.body.is_active,
    }),
  });
}
async function removeAccount(req, res) {
  await service.removeAccount({ ...ctx(req), id: req.params.id });
  res.status(204).end();
}
async function testAccount(req, res) {
  res.json(await service.testAccount({ id: req.params.id }));
}

module.exports = {
  listAccounts,
  getAccount,
  upsertAccount,
  setActive,
  removeAccount,
  testAccount,
};
