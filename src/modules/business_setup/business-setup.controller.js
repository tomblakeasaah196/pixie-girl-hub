/**
 * Business Setup / Identity (V2.2 Module 18) — HTTP controllers.
 */

"use strict";

const service = require("./business-setup.service");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ── business_config ──────────────────────────────────────
const getConfig = async (req, res) =>
  res.json({ data: await service.getConfig({ brand: req.brand }) });
const updateConfig = async (req, res) =>
  res.json({
    data: await service.updateConfig({ ...base(req), input: req.body }),
  });

// ── currencies ───────────────────────────────────────────
const listCurrencies = async (_req, res) =>
  res.json({ data: await service.listCurrencies() });
const saveCurrency = async (req, res) =>
  res.status(201).json({
    data: await service.saveCurrency({ ...base(req), input: req.body }),
  });
const updateCurrency = async (req, res) =>
  res.json({
    data: await service.updateCurrency({
      ...base(req),
      code: req.params.code,
      input: req.body,
    }),
  });

// ── currency_rates (FX) ──────────────────────────────────
const listRates = async (req, res) =>
  res.json({
    data: await service.listRates({
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
  });
const latestRate = async (req, res) =>
  res.json({
    data: await service.latestRate({ from: req.query.from, to: req.query.to }),
  });
const setRate = async (req, res) =>
  res
    .status(201)
    .json({ data: await service.setRate({ ...base(req), input: req.body }) });

// ── bank_accounts ────────────────────────────────────────
const listBankAccounts = async (req, res) =>
  res.json({
    data: await service.listBankAccounts({
      brand: req.brand,
      is_active:
        req.query.is_active === undefined
          ? undefined
          : req.query.is_active === "true",
    }),
  });
const getBankAccount = async (req, res) =>
  res.json({
    data: await service.getBankAccount({ brand: req.brand, id: req.params.id }),
  });
const createBankAccount = async (req, res) =>
  res.status(201).json({
    data: await service.createBankAccount({ ...base(req), input: req.body }),
  });
const updateBankAccount = async (req, res) =>
  res.json({
    data: await service.updateBankAccount({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── tax_rates ────────────────────────────────────────────
const listTaxRates = async (req, res) =>
  res.json({
    data: await service.listTaxRates({
      brand: req.brand,
      tax_type: req.query.tax_type,
      active:
        req.query.active === undefined
          ? undefined
          : req.query.active === "true",
    }),
  });
const createTaxRate = async (req, res) =>
  res.status(201).json({
    data: await service.createTaxRate({ ...base(req), input: req.body }),
  });
const supersedeTaxRate = async (req, res) =>
  res.json({
    data: await service.supersedeTaxRate({
      ...base(req),
      id: req.params.id,
      effective_to: req.body.effective_to,
    }),
  });

// ── document_numbering ───────────────────────────────────
const listNumbering = async (req, res) =>
  res.json({ data: await service.listNumbering({ brand: req.brand }) });
const updateNumbering = async (req, res) =>
  res.json({
    data: await service.updateNumbering({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── custom_field_defs ────────────────────────────────────
const listCustomFields = async (req, res) =>
  res.json({
    data: await service.listCustomFields({
      brand: req.brand,
      entity_type: req.query.entity_type,
      active:
        req.query.active === undefined
          ? undefined
          : req.query.active === "true",
    }),
  });
const createCustomField = async (req, res) =>
  res.status(201).json({
    data: await service.createCustomField({ ...base(req), input: req.body }),
  });
const updateCustomField = async (req, res) =>
  res.json({
    data: await service.updateCustomField({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });

// ── pipeline_stage_defs ──────────────────────────────────
const listPipelineStages = async (req, res) =>
  res.json({
    data: await service.listPipelineStages({
      brand: req.brand,
      pipeline_type: req.query.pipeline_type,
    }),
  });
const createPipelineStage = async (req, res) =>
  res.status(201).json({
    data: await service.createPipelineStage({
      ...base(req),
      input: req.body,
    }),
  });
const updatePipelineStage = async (req, res) =>
  res.json({
    data: await service.updatePipelineStage({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
const deletePipelineStage = async (req, res) =>
  res.json({
    data: await service.deletePipelineStage({
      ...base(req),
      id: req.params.id,
    }),
  });

module.exports = {
  getConfig,
  updateConfig,
  listCurrencies,
  saveCurrency,
  updateCurrency,
  listRates,
  latestRate,
  setRate,
  listBankAccounts,
  getBankAccount,
  createBankAccount,
  updateBankAccount,
  listTaxRates,
  createTaxRate,
  supersedeTaxRate,
  listNumbering,
  updateNumbering,
  listCustomFields,
  createCustomField,
  updateCustomField,
  listPipelineStages,
  createPipelineStage,
  updatePipelineStage,
  deletePipelineStage,
};
