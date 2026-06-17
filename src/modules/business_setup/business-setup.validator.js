/**
 * Business Setup / Identity (V2.2 Module 18) — Zod validators.
 */

"use strict";

const { z } = require("zod");

const rate = z.coerce.number().min(0).max(1);
const taxRate = z.coerce.number().min(0).max(1);

// ── business_config (partial update) ─────────────────────
const configUpdate = z
  .object({
    display_name: z.string().min(1).max(200).optional(),
    legal_name: z.string().min(1).max(200).optional(),
    trading_currency: z.string().length(3).optional(),
    settlement_currency: z.string().length(3).optional(),
    document_prefix: z.string().min(1).max(10).optional(),
    storefront_domain: z.string().max(200).nullable().optional(),
    storefront_enabled: z.boolean().optional(),
    address: z.string().max(500).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email().optional(),
    support_email: z.string().email().nullable().optional(),
    support_email_display_name: z.string().max(160).nullable().optional(),
    website: z.string().max(200).optional(),
    tin: z.string().max(40).optional(),
    cac_number: z.string().max(40).optional(),
    vat_number: z.string().max(40).optional(),
    vat_rate: rate.optional(),
    wht_rate: rate.optional(),
    fiscal_year_start: z.coerce.number().int().min(1).max(12).optional(),
    logo_path: z.string().max(500).optional(),
    logo_alt_path: z.string().max(500).nullable().optional(),
    favicon_path: z.string().max(500).nullable().optional(),
    accent_colour: z.string().max(20).optional(),
    secondary_colour: z.string().max(20).nullable().optional(),
    mission_statement: z.string().max(2000).optional(),
    brand_fonts: z.record(z.any()).optional(),
    brand_theme: z.record(z.any()).optional(),
    payment_methods: z.record(z.any()).optional(),
    cash_handling_rules: z.record(z.any()).optional(),
    loyalty_settings: z.record(z.any()).optional(),
    cancellation_settings: z.record(z.any()).optional(),
    quantity_discount_rules: z.array(z.any()).optional(),
    intercompany_settings: z.record(z.any()).optional(),
    fx_settings: z.record(z.any()).optional(),
    payment_gateway_fees: z.record(z.any()).optional(),
    installment_settings: z.record(z.any()).optional(),
    allow_staff_recorded_manual_payments: z.boolean().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

// ── currencies ───────────────────────────────────────────
const currencySave = z
  .object({
    currency_code: z.string().length(3),
    display_name: z.string().min(1).max(80).optional(),
    symbol: z.string().max(8).optional(),
    decimal_places: z.coerce.number().int().min(0).max(4).optional(),
    rounding_unit: z.coerce.number().positive().optional(),
    is_settlement: z.boolean().optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().optional(),
  })
  .strict();
const currencyUpdate = currencySave
  .omit({ currency_code: true })
  .partial()
  .strict();

// ── currency_rates (FX) ──────────────────────────────────
const rateSet = z
  .object({
    from_currency: z.string().length(3),
    to_currency: z.string().length(3).optional(),
    rate: z.coerce.number().positive(),
    valid_at: z.string().datetime().optional(),
    source: z.string().max(40).optional(),
  })
  .strict();

// ── bank_accounts ────────────────────────────────────────
const bankCreate = z
  .object({
    bank_name: z.string().min(1).max(160),
    account_name: z.string().min(1).max(200),
    account_number: z.string().min(1).max(40),
    sort_code: z.string().max(40).optional(),
    currency: z.string().length(3).optional(),
    is_primary: z.boolean().optional(),
    paystack_recipient_code: z.string().max(120).optional(),
    opay_account_id: z.string().max(120).optional(),
  })
  .strict();
const bankUpdate = bankCreate
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .strict();

// ── tax_rates ────────────────────────────────────────────
const taxCreate = z
  .object({
    tax_name: z.string().min(1).max(60),
    tax_type: z.enum(["sales", "purchases", "payroll"]),
    rate: taxRate,
    applies_to: z.string().min(1).max(40),
    is_active: z.boolean().optional(),
    effective_from: z.string().date(),
    effective_to: z.string().date().optional(),
    excluded_modules: z.array(z.string().min(1).max(40)).optional(),
  })
  .strict();
// Toggle active / set the module-exclusion set / nudge the rate.
const taxUpdate = z
  .object({
    is_active: z.boolean().optional(),
    rate: taxRate.optional(),
    applies_to: z.string().min(1).max(40).optional(),
    tax_name: z.string().min(1).max(60).optional(),
    excluded_modules: z.array(z.string().min(1).max(40)).optional(),
  })
  .strict();
const taxSupersede = z.object({ effective_to: z.string().date() }).strict();

// ── document_numbering ───────────────────────────────────
const numberingUpdate = z
  .object({
    prefix: z.string().min(1).max(20).optional(),
    padding: z.coerce.number().int().min(1).max(10).optional(),
  })
  .strict();

// ── custom_field_defs ────────────────────────────────────
const customFieldCreate = z
  .object({
    entity_type: z.enum([
      "product",
      "contact",
      "crm_deal",
      "sales_order",
      "stylist_partner",
    ]),
    field_key: z.string().min(1).max(60),
    field_label: z.string().min(1).max(120),
    field_type: z.enum([
      "text",
      "number",
      "select",
      "multiselect",
      "date",
      "boolean",
      "url",
    ]),
    options: z.array(z.any()).optional(),
    is_required: z.boolean().optional(),
    is_searchable: z.boolean().optional(),
    is_filterable: z.boolean().optional(),
    visible_to_roles: z.array(z.string()).optional(),
    display_order: z.coerce.number().int().optional(),
    is_active: z.boolean().optional(),
  })
  .strict();
const customFieldUpdate = customFieldCreate
  .omit({ entity_type: true, field_key: true })
  .partial()
  .strict();

// ── pipeline_stage_defs ──────────────────────────────────
const pipelineStageCreate = z
  .object({
    pipeline_type: z.enum(["crm", "delivery", "purchase_order", "production"]),
    stage_key: z.string().min(1).max(60),
    stage_label: z.string().min(1).max(120),
    display_order: z.coerce.number().int().optional(),
    is_terminal: z.boolean().optional(),
    is_positive_terminal: z.boolean().optional(),
    colour: z.string().max(20).optional(),
  })
  .strict();
const pipelineStageUpdate = pipelineStageCreate
  .omit({ pipeline_type: true, stage_key: true })
  .partial()
  .strict();

// ── Business provisioning (V2.2 §6.21 "add a new business") ──
const businessProvision = z
  .object({
    business_key: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]{1,62}$/,
        "lowercase letter then letters/digits/underscore",
      ),
    display_name: z.string().min(1).max(200),
    legal_name: z.string().min(1).max(200),
    document_prefix: z.string().min(1).max(10),
    trading_currency: z.string().length(3).optional(),
    settlement_currency: z.string().length(3).optional(),
    vat_rate: rate.optional(),
    wht_rate: rate.optional(),
  })
  .strict();

// ── Email signatures (V2.2 §6.13) ────────────────────────
const signatureTemplate = z
  .object({ html: z.string().min(1).max(20000) })
  .strict();
const signatureGenerate = z
  .object({
    full_name: z.string().min(1).max(200),
    job_title: z.string().min(1).max(200),
    phone: z.string().max(40).optional(),
  })
  .strict();

const mw = (schema) => (req, _res, next) => {
  req.body = schema.parse(req.body ?? {});
  next();
};

module.exports = {
  validateBusinessProvision: mw(businessProvision),
  validateSignatureTemplate: mw(signatureTemplate),
  validateSignatureGenerate: mw(signatureGenerate),
  validateConfigUpdate: mw(configUpdate),
  validateCurrencySave: mw(currencySave),
  validateCurrencyUpdate: mw(currencyUpdate),
  validateRateSet: mw(rateSet),
  validateBankCreate: mw(bankCreate),
  validateBankUpdate: mw(bankUpdate),
  validateTaxCreate: mw(taxCreate),
  validateTaxUpdate: mw(taxUpdate),
  validateTaxSupersede: mw(taxSupersede),
  validateNumberingUpdate: mw(numberingUpdate),
  validateCustomFieldCreate: mw(customFieldCreate),
  validateCustomFieldUpdate: mw(customFieldUpdate),
  validatePipelineStageCreate: mw(pipelineStageCreate),
  validatePipelineStageUpdate: mw(pipelineStageUpdate),
};
