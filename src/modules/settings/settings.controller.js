/**
 * Settings module — HTTP controllers.
 */

"use strict";

const service = require("./settings.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── document_templates ───────────────────────────────────
const listTemplates = async (req, res) =>
  res.json({ data: await service.listTemplates({ brand: req.brand, doc_type: req.query.doc_type }) });
const createTemplate = async (req, res) =>
  res.status(201).json({ data: await service.createTemplate({ ...base(req), input: req.body }) });
const updateTemplate = async (req, res) =>
  res.json({ data: await service.updateTemplate({ ...base(req), id: req.params.id, input: req.body }) });
const setDefaultTemplate = async (req, res) =>
  res.json({ data: await service.setDefaultTemplate({ ...base(req), id: req.params.id }) });
const deleteTemplate = async (req, res) =>
  res.json({ data: await service.deleteTemplate({ ...base(req), id: req.params.id }) });

// ── notification_preferences (self) ──────────────────────
const listNotificationPrefs = async (req, res) =>
  res.json({ data: await service.listNotificationPrefs({ user: req.user }) });
const upsertNotificationPref = async (req, res) =>
  res.json({ data: await service.upsertNotificationPref({ user: req.user, request_id: req.request_id, input: req.body }) });

// ── scheduled_reports ────────────────────────────────────
const listReports = async (req, res) =>
  res.json({ data: await service.listReports({ brand: req.brand }) });
const createReport = async (req, res) =>
  res.status(201).json({ data: await service.createReport({ ...base(req), input: req.body }) });
const updateReport = async (req, res) =>
  res.json({ data: await service.updateReport({ ...base(req), id: req.params.id, input: req.body }) });
const deleteReport = async (req, res) =>
  res.json({ data: await service.deleteReport({ ...base(req), id: req.params.id }) });

// ── integration_secrets (write-only) ─────────────────────
const listSecrets = async (req, res) =>
  res.json({ data: await service.listSecrets({ brand: req.brand }) });
const setSecret = async (req, res) =>
  res.status(201).json({ data: await service.setSecret({ ...base(req), input: req.body }) });
const deleteSecret = async (req, res) =>
  res.json({ data: await service.deleteSecret({ ...base(req), id: req.params.id }) });

// ── business_policies ────────────────────────────────────
const listPolicies = async (req, res) =>
  res.json({
    data: await service.listPolicies({
      brand: req.brand,
      policy_type: req.query.policy_type,
      status: req.query.status,
    }),
  });
const createPolicy = async (req, res) =>
  res.status(201).json({ data: await service.createPolicy({ ...base(req), input: req.body }) });
const updatePolicy = async (req, res) =>
  res.json({ data: await service.updatePolicy({ ...base(req), id: req.params.id, input: req.body }) });
const deletePolicy = async (req, res) =>
  res.json({ data: await service.deletePolicy({ ...base(req), id: req.params.id }) });

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  setDefaultTemplate,
  deleteTemplate,
  listNotificationPrefs,
  upsertNotificationPref,
  listReports,
  createReport,
  updateReport,
  deleteReport,
  listSecrets,
  setSecret,
  deleteSecret,
  listPolicies,
  createPolicy,
  updatePolicy,
  deletePolicy,
};
