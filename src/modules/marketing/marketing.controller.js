/**
 * Marketing Campaigns & Ad Analytics (V2.2 §6.15) — HTTP controller.
 */

"use strict";

const service = require("./marketing.service");
const { parsePagination } = require("../../utils/pagination");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

async function listAdAccounts(req, res) {
  res.json({ data: await service.listAdAccounts({ brand: req.brand }) });
}
async function connectAdAccount(req, res) {
  res.status(201).json({
    data: await service.connectAdAccount({ ...base(req), input: req.body }),
  });
}
async function revokeAdAccount(req, res) {
  await service.revokeAdAccount({ ...base(req), id: req.params.id });
  res.status(204).end();
}
async function listAdCampaigns(req, res) {
  const { page, page_size } = parsePagination(req.query);
  res.json(
    await service.listAdCampaigns({
      brand: req.brand,
      status: req.query.status,
      page,
      page_size,
    }),
  );
}
async function getAdCampaign(req, res) {
  res.json({
    data: await service.getAdCampaign({ brand: req.brand, id: req.params.id }),
  });
}
async function createAdCampaign(req, res) {
  res.status(201).json({
    data: await service.createAdCampaign({ ...base(req), input: req.body }),
  });
}
async function setAdCampaignStatus(req, res) {
  res.json({
    data: await service.setAdCampaignStatus({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
    }),
  });
}
async function recordSpend(req, res) {
  res.status(201).json({
    data: await service.recordSpend({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function attributionReport(req, res) {
  res.json({
    data: await service.attributionReport({
      brand: req.brand,
      from: req.query.from,
      to: req.query.to,
    }),
  });
}

async function pushAdCampaign(req, res) {
  res.json({
    data: await service.pushAdCampaign({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}

module.exports = {
  listAdAccounts,
  connectAdAccount,
  revokeAdAccount,
  listAdCampaigns,
  getAdCampaign,
  createAdCampaign,
  setAdCampaignStatus,
  recordSpend,
  attributionReport,
  pushAdCampaign,
};
