/**
 * Business Setup / Identity (V2.2 Module 18) — routes. Mounted at /api/v1/business-setup.
 * Permission key: business_setup.
 *
 * Shared config tables: business_config, currencies, currency_rates (FX),
 * bank_accounts, tax_rates, document_numbering, custom_field_defs,
 * pipeline_stage_defs. (webhook_log is handled by webhooks.routes.)
 */

"use strict";

const express = require("express");
const controller = require("./business-setup.controller");
const validator = require("./business-setup.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("business_setup", action);

// ── Brand profile ────────────────────────────────────────
router.get("/config", can("view"), controller.getConfig);
router.patch(
  "/config",
  can("edit"),
  validator.validateConfigUpdate,
  controller.updateConfig,
);

// ── Currencies ───────────────────────────────────────────
router.get("/currencies", can("view"), controller.listCurrencies);
router.post(
  "/currencies",
  can("edit"),
  validator.validateCurrencySave,
  controller.saveCurrency,
);
router.patch(
  "/currencies/:code",
  can("edit"),
  validator.validateCurrencyUpdate,
  controller.updateCurrency,
);

// ── FX rates (currency_rates) ────────────────────────────
router.get("/fx-rates", can("view"), controller.listRates);
router.get("/fx-rates/latest", can("view"), controller.latestRate);
router.post(
  "/fx-rates",
  can("edit"),
  validator.validateRateSet,
  controller.setRate,
);

// ── Bank accounts (Tier-1 A; masked numbers) ─────────────
router.get("/bank-accounts", can("view"), controller.listBankAccounts);
router.post(
  "/bank-accounts",
  can("create"),
  validator.validateBankCreate,
  controller.createBankAccount,
);
router.get("/bank-accounts/:id", can("view"), controller.getBankAccount);
router.patch(
  "/bank-accounts/:id",
  can("edit"),
  validator.validateBankUpdate,
  controller.updateBankAccount,
);

// ── Tax rates (Tier-1 C; effective-dated) ────────────────
router.get("/tax-rates", can("view"), controller.listTaxRates);
router.post(
  "/tax-rates",
  can("create"),
  validator.validateTaxCreate,
  controller.createTaxRate,
);
router.post(
  "/tax-rates/:id/supersede",
  can("edit"),
  validator.validateTaxSupersede,
  controller.supersedeTaxRate,
);

// ── Document numbering (read; prefix editable before first issuance) ──
router.get("/document-numbering", can("view"), controller.listNumbering);
router.patch(
  "/document-numbering/:id",
  can("edit"),
  validator.validateNumberingUpdate,
  controller.updateNumbering,
);

// ── Custom field defs ────────────────────────────────────
router.get("/custom-fields", can("view"), controller.listCustomFields);
router.post(
  "/custom-fields",
  can("create"),
  validator.validateCustomFieldCreate,
  controller.createCustomField,
);
router.patch(
  "/custom-fields/:id",
  can("edit"),
  validator.validateCustomFieldUpdate,
  controller.updateCustomField,
);

// ── Pipeline stage defs ──────────────────────────────────
router.get("/pipeline-stages", can("view"), controller.listPipelineStages);
router.post(
  "/pipeline-stages",
  can("create"),
  validator.validatePipelineStageCreate,
  controller.createPipelineStage,
);
router.patch(
  "/pipeline-stages/:id",
  can("edit"),
  validator.validatePipelineStageUpdate,
  controller.updatePipelineStage,
);
router.delete(
  "/pipeline-stages/:id",
  can("delete"),
  controller.deletePipelineStage,
);

module.exports = router;
