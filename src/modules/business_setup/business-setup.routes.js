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
const gateways = require("./payment-gateways.controller");
const gatewayValidator = require("./payment-gateways.validator");
const { requirePermission } = require("../../middleware/rbac");

const router = express.Router();
const can = (action) => requirePermission("business_setup", action);

// ── Businesses (provision a new brand — V2.2 §6.21) ──────
// Runs DDL (schema + templates) → CEO-level; gated on business_setup:create.
router.get("/businesses", can("view"), controller.listBusinesses);
router.post(
  "/businesses",
  can("create"),
  validator.validateBusinessProvision,
  controller.provisionBusiness,
);

// ── Email signatures (one brand template, per-staff render — §6.13) ──
router.get(
  "/email-signature-template",
  can("view"),
  controller.getSignatureTemplate,
);
router.put(
  "/email-signature-template",
  can("edit"),
  validator.validateSignatureTemplate,
  controller.setSignatureTemplate,
);
router.get("/email-signatures", can("view"), controller.listSignatures);
router.get("/email-signatures/:userId", can("view"), controller.getSignature);
router.put(
  "/email-signatures/:userId",
  can("edit"),
  validator.validateSignatureGenerate,
  controller.generateSignature,
);

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

// ── Payment gateways (B / §6.21 — CEO-managed; secrets write-only) ──
router.get("/payment-gateways", can("view"), gateways.list);
router.post(
  "/payment-gateways",
  can("edit"),
  gatewayValidator.validateConfigure,
  gateways.configure,
);
router.patch(
  "/payment-gateways/:provider/active",
  can("edit"),
  gatewayValidator.validateSetActive,
  gateways.setActive,
);
router.patch(
  "/payment-gateways/:provider/role",
  can("edit"),
  gatewayValidator.validateSetRole,
  gateways.setRole,
);
router.delete("/payment-gateways/:provider", can("delete"), gateways.remove);

module.exports = router;
