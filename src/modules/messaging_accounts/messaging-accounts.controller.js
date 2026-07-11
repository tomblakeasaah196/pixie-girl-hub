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
  res.status(201).json({
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
async function revealSecret(req, res) {
  const result = await service.revealSecret({
    ...ctx(req),
    id: req.params.id,
    field: req.body.field,
    password: req.body.password,
    source_ip: req.ip,
  });
  res.json(result);
}
async function listReveals(req, res) {
  res.json({ data: await service.listReveals({ id: req.params.id }) });
}

async function getWhatsAppProfile(req, res) {
  res.json({ data: await service.getWhatsAppProfile({ id: req.params.id }) });
}

async function updateWhatsAppProfile(req, res) {
  // Drop blank website slots the UI may send for empty inputs — Meta
  // rejects empty strings inside the websites array.
  const profile = { ...req.body };
  if (Array.isArray(profile.websites)) {
    profile.websites = profile.websites.filter((w) => w && w.trim());
  }
  res.json({
    data: await service.updateWhatsAppProfile({
      ...ctx(req),
      id: req.params.id,
      profile,
    }),
  });
}

async function setWhatsAppProfilePicture(req, res) {
  res.json({
    data: await service.setWhatsAppProfilePicture({
      ...ctx(req),
      id: req.params.id,
      file: req.file,
      app_id: req.body && req.body.app_id,
    }),
  });
}

// Computed, not stored — safe to call before the account row exists so the
// UI can show the DNS records while the operator is still typing the
// mailbox address into the "Inbound mailbox" field.
async function getDnsRecords(req, res) {
  res.json({
    data: service.getInboundDnsRecords({
      external_account_id: req.query.mailbox || "",
    }),
  });
}

async function getWhatsAppCalling(req, res) {
  res.json({ data: await service.getWhatsAppCalling({ id: req.params.id }) });
}

async function updateWhatsAppCalling(req, res) {
  res.json({
    data: await service.updateWhatsAppCalling({
      ...ctx(req),
      id: req.params.id,
      enabled: req.body.enabled,
      icon_visibility: req.body.icon_visibility,
    }),
  });
}

module.exports = {
  listAccounts,
  getAccount,
  upsertAccount,
  setActive,
  removeAccount,
  testAccount,
  revealSecret,
  listReveals,
  getWhatsAppProfile,
  updateWhatsAppProfile,
  setWhatsAppProfilePicture,
  getWhatsAppCalling,
  updateWhatsAppCalling,
  getDnsRecords,
};
