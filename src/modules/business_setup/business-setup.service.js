/**
 * Business Setup / Identity (V2.2 Module 18 + §6.21) — service.
 * Brand profile, currencies + FX overrides, company bank accounts (masked),
 * tax rates (effective-dated), document numbering (prefix locked after first
 * issuance), custom field defs, and pipeline stage defs. Audit on every write.
 */

"use strict";

const repo = require("./business-setup.repo");
const events = require("./business-setup.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, ConflictError } = require("../../utils/errors");

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  metadata,
  request_id,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    metadata,
    request_id,
  });

// Broadcast a settings change so every open browser invalidates the
// relevant query and refetches. Non-fatal if sockets aren't up yet
// (e.g. during seeding / tests).
function emitSettingsUpdated(payload) {
  try {
    require("../../config/socket").getIo().emit("settings:updated", payload);
  } catch {
    /* socket not initialised — non-fatal */
  }
}

// Mask all but the last 4 digits of a bank account number for API responses.
function maskAccount(row) {
  if (!row) return row;
  const n = String(row.account_number || "");
  const last4 = n.slice(-4);
  const masked = n.length > 4 ? `${"•".repeat(n.length - 4)}${last4}` : n;
  const { account_number, ...rest } = row;
  return {
    ...rest,
    account_number: account_number, // still include the full number for internal use
    account_number_masked: masked,
    account_number_last4: last4,
  };
}

// ── business_config ──────────────────────────────────────
async function getConfig({ brand }) {
  const config = await repo.getConfig({ client: null, brand });
  if (!config) throw new NotFoundError("Business config not found");
  return config;
}
async function updateConfig({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const current = await repo.getConfig({ client, brand });
    if (!current) throw new NotFoundError("Business config not found");
    // document_prefix cannot change once any document has been issued.
    if (
      input.document_prefix &&
      input.document_prefix !== current.document_prefix
    ) {
      const seqs = await repo.listNumbering({ client, brand });
      if (seqs.some((s) => s.next_number > 1)) {
        throw new ConflictError(
          "document_prefix cannot change after the first document has been issued",
        );
      }
    }
    const updated = await repo.updateConfig({ client, brand, patch: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.config.update",
      "business_config",
      updated.config_id,
      { fields: Object.keys(input) },
      request_id,
    );
    events.emit("config.updated", { brand });
    // Branding tokens may have changed (logo, accent, gradients, fonts).
    // Emit so every open browser re-fetches /api/public/branding and
    // re-applies the Layer-B wash without a refresh.
    if (
      Object.keys(input).some((k) =>
        [
          "accent_colour",
          "secondary_colour",
          "logo_path",
          "logo_alt_path",
          "favicon_path",
          "brand_theme",
          "brand_fonts",
          "display_name",
        ].includes(k),
      )
    ) {
      try {
        require("../platform_settings/platform-settings.service").emitBrandingUpdated(
          { scope: "business", brand },
        );
      } catch {
        /* socket may not be initialised yet (e.g. seeding) — non-fatal */
      }
    }
    return updated;
  });
}

// ── currencies ───────────────────────────────────────────
const listCurrencies = () => repo.listCurrencies({ client: null });
async function saveCurrency({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.upsertCurrency({ client, row: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.currency.save",
      "currency",
      null,
      { currency_code: row.currency_code, is_active: row.is_active },
      request_id,
    );
    return row;
  });
}
async function updateCurrency({ brand, user, request_id, code, input }) {
  return transaction(async (client) => {
    const row = await repo.updateCurrency({ client, code, patch: input });
    if (!row) throw new NotFoundError("Currency not found");
    await A(
      brand,
      user?.user_id,
      "business_setup.currency.update",
      "currency",
      null,
      { currency_code: code, fields: Object.keys(input) },
      request_id,
    );
    return row;
  });
}

// ── currency_rates (FX) ──────────────────────────────────
const listRates = ({ from, to, limit }) =>
  repo.listRates({ client: null, from, to, limit });
const latestRate = ({ from, to }) =>
  repo.latestRate({ client: null, from, to });
async function setRate({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.insertRate({
      client,
      row: {
        ...input,
        is_manual_override: true,
        source: input.source || "manual",
        set_by: user?.user_id,
      },
    });
    await A(
      brand,
      user?.user_id,
      "business_setup.fx_rate.set",
      "currency_rate",
      row.rate_id,
      { from: row.from_currency, to: row.to_currency, rate: row.rate },
      request_id,
    );
    return row;
  });
}

// ── bank_accounts ────────────────────────────────────────
async function listBankAccounts({ brand, is_active }) {
  const rows = await repo.listBankAccounts({ client: null, brand, is_active });
  return rows.map(maskAccount);
}
async function getBankAccount({ brand, id }) {
  const row = await repo.getBankAccount({ client: null, brand, id });
  if (!row) throw new NotFoundError("Bank account not found");
  return maskAccount(row);
}
async function createBankAccount({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    if (input.is_primary)
      await repo.clearPrimaryBankAccounts({ client, brand });
    const row = await repo.createBankAccount({ client, brand, row: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.bank_account.create",
      "bank_account",
      row.account_id,
      { bank_name: row.bank_name },
      request_id,
    );
    return maskAccount(row);
  });
}
async function updateBankAccount({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getBankAccount({ client, brand, id });
    if (!existing) throw new NotFoundError("Bank account not found");
    if (input.is_primary)
      await repo.clearPrimaryBankAccounts({ client, brand });
    const row = await repo.updateBankAccount({
      client,
      brand,
      id,
      patch: input,
    });
    await A(
      brand,
      user?.user_id,
      "business_setup.bank_account.update",
      "bank_account",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return maskAccount(row);
  });
}

// ── tax_rates ────────────────────────────────────────────
const listTaxRates = ({ brand, tax_type, active }) =>
  repo.listTaxRates({ client: null, brand, tax_type, active });
async function createTaxRate({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.createTaxRate({ client, brand, row: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.tax_rate.create",
      "tax_rate",
      row.tax_id,
      {
        tax_name: row.tax_name,
        rate: row.rate,
        effective_from: row.effective_from,
      },
      request_id,
    );
    return row;
  });
}
async function updateTaxRate({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getTaxRate({ client, brand, id });
    if (!existing) throw new NotFoundError("Tax rate not found");
    const row = await repo.updateTaxRate({ client, brand, id, patch: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.tax_rate.update",
      "tax_rate",
      id,
      { fields: Object.keys(input), is_active: row.is_active },
      request_id,
    );
    // Taxes are consumed system-wide; tell open sessions the tax matrix
    // changed so cached resolvers refetch.
    emitSettingsUpdated({ tile: "tax-rates", brand });
    return row;
  });
}
// Read-only resolver other modules call to know which taxes apply.
async function listEffectiveTaxes({ brand, tax_type, module }) {
  return repo.listEffectiveTaxes({ client: null, brand, tax_type, module });
}
async function supersedeTaxRate({ brand, user, request_id, id, effective_to }) {
  return transaction(async (client) => {
    const existing = await repo.getTaxRate({ client, brand, id });
    if (!existing) throw new NotFoundError("Tax rate not found");
    const row = await repo.supersedeTaxRate({
      client,
      brand,
      id,
      effective_to,
    });
    await A(
      brand,
      user?.user_id,
      "business_setup.tax_rate.supersede",
      "tax_rate",
      id,
      { effective_to },
      request_id,
    );
    return row;
  });
}

// ── document_numbering ───────────────────────────────────
const listNumbering = ({ brand }) =>
  repo.listNumbering({ client: null, brand });
async function updateNumbering({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const seq = await repo.getNumbering({ client, brand, id });
    if (!seq) throw new NotFoundError("Document sequence not found");
    if (seq.next_number > 1) {
      throw new ConflictError(
        "A numbering sequence cannot be changed after its first document has been issued",
      );
    }
    const row = await repo.updateNumbering({ client, brand, id, patch: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.numbering.update",
      "document_numbering",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return row;
  });
}

// ── custom_field_defs ────────────────────────────────────
const listCustomFields = ({ brand, entity_type, active }) =>
  repo.listCustomFields({ client: null, brand, entity_type, active });
async function createCustomField({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.createCustomField({ client, brand, row: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.custom_field.create",
      "custom_field_def",
      row.field_id,
      { entity_type: row.entity_type, field_key: row.field_key },
      request_id,
    );
    return row;
  });
}
async function updateCustomField({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const existing = await repo.getCustomField({ client, brand, id });
    if (!existing) throw new NotFoundError("Custom field not found");
    const row = await repo.updateCustomField({
      client,
      brand,
      id,
      patch: input,
    });
    await A(
      brand,
      user?.user_id,
      "business_setup.custom_field.update",
      "custom_field_def",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return row;
  });
}

// ── pipeline_stage_defs ──────────────────────────────────
const listPipelineStages = ({ brand, pipeline_type }) =>
  repo.listPipelineStages({ client: null, brand, pipeline_type });
async function createPipelineStage({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const row = await repo.createPipelineStage({ client, brand, row: input });
    await A(
      brand,
      user?.user_id,
      "business_setup.pipeline_stage.create",
      "pipeline_stage_def",
      row.stage_id,
      { pipeline_type: row.pipeline_type, stage_key: row.stage_key },
      request_id,
    );
    return row;
  });
}
async function updatePipelineStage({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const row = await repo.updatePipelineStage({
      client,
      brand,
      id,
      patch: input,
    });
    if (!row) throw new NotFoundError("Pipeline stage not found");
    await A(
      brand,
      user?.user_id,
      "business_setup.pipeline_stage.update",
      "pipeline_stage_def",
      id,
      { fields: Object.keys(input) },
      request_id,
    );
    return row;
  });
}
async function deletePipelineStage({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const ok = await repo.deletePipelineStage({ client, brand, id });
    if (!ok) throw new NotFoundError("Pipeline stage not found");
    await A(
      brand,
      user?.user_id,
      "business_setup.pipeline_stage.delete",
      "pipeline_stage_def",
      id,
      null,
      request_id,
    );
    return { removed: true };
  });
}

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
  updateTaxRate,
  listEffectiveTaxes,
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
