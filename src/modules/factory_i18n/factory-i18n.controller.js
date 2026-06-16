/**
 * Factory i18n — HTTP handlers.
 * Thin layer: input validation, repo delegation, JSON response. No business logic.
 */

"use strict";

const repo = require("./factory-i18n.repo");
const { AppError } = require("../../utils/errors");

/** All 61 keys required in every translation bundle (derived from en baseline). */
const REQUIRED_KEYS = [
  "currentBalance", "alertThreshold", "reconcile", "addEntry", "balanceExceeded",
  "date", "type", "description", "debit", "credit", "balance", "reconCol",
  "noEntries", "noEntriesMsg", "failedToLoad", "couldNotLoadEntries",
  "couldNotLoadShipments", "retry", "addLedgerEntry", "cancel", "saving",
  "saveEntry", "entryType", "amount", "currency", "fxRate", "paymentMethod",
  "selectPrompt", "paidBy", "paidByPlaceholder", "descriptionPlaceholder",
  "all", "newShipment", "noShipments", "noShipmentsMsg", "items", "shipped",
  "estimatedArrival", "courier", "tracking", "shippingFee", "itemsLabel",
  "advanceStatus", "advanceTo", "updating", "confirm", "createShipment",
  "courierPlaceholder", "trackingNumber", "trackingPlaceholder", "shippedDate",
  "unitPrice", "qty", "add", "noFactoryAccounts", "noFactoryAccountsMsg",
  "ledger", "shipmentsTab", "shipment", "langToggle",
];

/** Regex for a valid language code: 2–5 lowercase letters only. */
const LANG_CODE_RE = /^[a-z]{2,5}$/;

// ── Read endpoints (any authenticated user) ────────────────

/**
 * GET /factory-i18n
 * Returns all language rows (without translations) for the language selector.
 */
async function listLanguages(req, res, next) {
  try {
    const data = await repo.listLanguages();
    res.json({ data });
  } catch (err) { next(err); }
}

/**
 * GET /factory-i18n/with-translations
 * Returns all active language rows WITH translations, used to hydrate i18next.
 */
async function listAllWithTranslations(req, res, next) {
  try {
    const data = await repo.listAllWithTranslations();
    res.json({ data });
  } catch (err) { next(err); }
}

/**
 * GET /factory-i18n/:code
 * Returns a single language row including translations.
 */
async function getOne(req, res, next) {
  try {
    const row = await repo.getWithTranslations(req.params.code.toLowerCase());
    if (!row) throw new AppError("NOT_FOUND", `Language '${req.params.code}' not found`, 404);
    res.json({ data: row });
  } catch (err) { next(err); }
}

// ── Write endpoints (platform_settings edit OR CEO) ────────

/**
 * POST /factory-i18n
 * Create a new language. Validates code format, display_name, and that all
 * 61 required translation keys are present with string values.
 */
async function create(req, res, next) {
  try {
    const { language_code, display_name, translations } = req.body ?? {};

    // Code validation
    if (!language_code || typeof language_code !== "string") {
      throw new AppError("VALIDATION_ERROR", "language_code is required", 400);
    }
    const code = language_code.toLowerCase();
    if (!LANG_CODE_RE.test(code)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "language_code must be 2–5 lowercase letters only",
        400
      );
    }
    if (code === "en") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Cannot overwrite the base English language via this endpoint",
        400
      );
    }

    // display_name validation
    if (!display_name || typeof display_name !== "string" || !display_name.trim()) {
      throw new AppError("VALIDATION_ERROR", "display_name is required", 400);
    }

    // Translations validation
    if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
      throw new AppError("VALIDATION_ERROR", "translations must be a JSON object", 400);
    }
    const missingKeys = REQUIRED_KEYS.filter((k) => !(k in translations));
    if (missingKeys.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        `translations is missing required keys: ${missingKeys.join(", ")}`,
        400,
        { fields: { translations: `Missing keys: ${missingKeys.join(", ")}` } }
      );
    }
    const nonStringKeys = REQUIRED_KEYS.filter((k) => typeof translations[k] !== "string");
    if (nonStringKeys.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        `All translation values must be strings. Non-string keys: ${nonStringKeys.join(", ")}`,
        400,
        { fields: { translations: `Non-string values for: ${nonStringKeys.join(", ")}` } }
      );
    }

    const row = await repo.create({ language_code: code, display_name: display_name.trim(), translations });
    res.status(201).json({ data: row });
  } catch (err) { next(err); }
}

/**
 * PATCH /factory-i18n/:code
 * Update display_name and/or is_active for a language.
 * Cannot deactivate 'en'.
 */
async function patchOne(req, res, next) {
  try {
    const code = req.params.code.toLowerCase();
    const { display_name, is_active } = req.body ?? {};

    if (code === "en" && is_active === false) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Cannot deactivate the base English language",
        400
      );
    }

    if (display_name !== undefined && (typeof display_name !== "string" || !display_name.trim())) {
      throw new AppError("VALIDATION_ERROR", "display_name must be a non-empty string", 400);
    }
    if (is_active !== undefined && typeof is_active !== "boolean") {
      throw new AppError("VALIDATION_ERROR", "is_active must be a boolean", 400);
    }

    const fields = {};
    if (display_name !== undefined) fields.display_name = display_name.trim();
    if (is_active !== undefined) fields.is_active = is_active;

    if (!Object.keys(fields).length) {
      throw new AppError("VALIDATION_ERROR", "No updatable fields provided (display_name, is_active)", 400);
    }

    const row = await repo.update(code, fields);
    if (!row) throw new AppError("NOT_FOUND", `Language '${code}' not found`, 404);
    res.json({ data: row });
  } catch (err) { next(err); }
}

/**
 * DELETE /factory-i18n/:code
 * Remove a language. The base 'en' language cannot be deleted.
 */
async function deleteOne(req, res, next) {
  try {
    const code = req.params.code.toLowerCase();
    if (code === "en") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Cannot delete the base English language",
        400
      );
    }
    const existing = await repo.getWithTranslations(code);
    if (!existing) throw new AppError("NOT_FOUND", `Language '${code}' not found`, 404);
    await repo.remove(code);
    res.status(204).end();
  } catch (err) { next(err); }
}

module.exports = { listLanguages, listAllWithTranslations, getOne, create, patchOne, deleteOne };
