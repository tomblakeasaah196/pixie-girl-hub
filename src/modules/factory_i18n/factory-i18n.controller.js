/**
 * Factory i18n — HTTP handlers.
 * Thin layer: input validation, repo delegation, JSON response. No business logic.
 */

"use strict";

const repo = require("./factory-i18n.repo");
const { AppError } = require("../../utils/errors");

/**
 * Every key a translation bundle must carry, derived from the `en` baseline
 * (apps/admin/src/i18n/locales/en.json). Covers the factory account ledger,
 * shipments AND the Production run screens — a bundle missing the production
 * keys would leave a factory manager on a half-English page, which is exactly
 * the failure this list exists to prevent. Keys are flat strings; the grouped
 * ones ("runStatus.planned") are literal keys, not nested paths — the admin
 * app sets i18next keySeparator:false to match.
 */
const REQUIRED_KEYS = [
  "currentBalance",
  "alertThreshold",
  "reconcile",
  "addEntry",
  "balanceExceeded",
  "date",
  "type",
  "description",
  "debit",
  "credit",
  "balance",
  "reconCol",
  "noEntries",
  "noEntriesMsg",
  "failedToLoad",
  "couldNotLoadEntries",
  "couldNotLoadShipments",
  "retry",
  "addLedgerEntry",
  "cancel",
  "saving",
  "saveEntry",
  "entryType",
  "amount",
  "currency",
  "fxRate",
  "paymentMethod",
  "selectPrompt",
  "paidBy",
  "paidByPlaceholder",
  "descriptionPlaceholder",
  "all",
  "newShipment",
  "noShipments",
  "noShipmentsMsg",
  "items",
  "shipped",
  "estimatedArrival",
  "courier",
  "tracking",
  "shippingFee",
  "itemsLabel",
  "advanceStatus",
  "advanceTo",
  "updating",
  "confirm",
  "createShipment",
  "courierPlaceholder",
  "trackingNumber",
  "trackingPlaceholder",
  "shippedDate",
  "unitPrice",
  "qty",
  "add",
  "noFactoryAccounts",
  "noFactoryAccountsMsg",
  "ledger",
  "shipmentsTab",
  "shipment",
  "langToggle",
  "productionTitle",
  "productionSubtitle",
  "overviewTab",
  "factoryAccountTab",
  "productionRunsTab",
  "accessRestricted",
  "accessRestrictedMsg",
  "active",
  "inactive",
  "factoryAccountsHeading",
  "kpiActiveAccounts",
  "kpiTotalBalance",
  "kpiShipmentsInTransit",
  "kpiRunsInProduction",
  "runNumber",
  "title",
  "status",
  "units",
  "totalCost",
  "perUnitCost",
  "created",
  "noRuns",
  "noRunsMsg",
  "newRun",
  "newProductionRun",
  "couldNotLoadRuns",
  "stepOf",
  "back",
  "next",
  "creating",
  "createRun",
  "runTitle",
  "runTitlePlaceholder",
  "factoryCurrency",
  "factoryCurrencyHint",
  "fromPo",
  "fromPoHint",
  "noPo",
  "expectedArrival",
  "notes",
  "notesPlaceholder",
  "poLinesHint",
  "unitsPlanned",
  "factoryCharge",
  "otherCostsHint",
  "lineCount",
  "bulkAdd",
  "addLine",
  "bulkAddHint",
  "lineN",
  "removeLine",
  "product",
  "change",
  "quantity",
  "unitCostIn",
  "lineTotal",
  "fxLoading",
  "fxMissing",
  "fxPreview",
  "fxRateHint",
  "fxNoRate",
  "addCost",
  "costTypeLabel",
  "invoiceReference",
  "invoiceReferencePlaceholder",
  "costDescriptionPlaceholder",
  "incurredAt",
  "addProducts",
  "productsInRun",
  "unnamedProduct",
  "unitsReceivedOf",
  "costComponents",
  "costHiddenForRole",
  "receiveUnits",
  "receiveHint",
  "receiveNoProducts",
  "location",
  "receiveQtyHint",
  "receiveAtCost",
  "runStatus.planned",
  "runStatus.funded",
  "runStatus.in_production",
  "runStatus.quality_check",
  "runStatus.ready_to_ship",
  "runStatus.in_transit",
  "runStatus.arrived_lagos",
  "runStatus.cleared_customs",
  "runStatus.received",
  "runStatus.completed",
  "runStatus.cancelled",
  "unitStatus.planned",
  "unitStatus.in_production",
  "unitStatus.qc_pass",
  "unitStatus.qc_fail",
  "unitStatus.in_transit",
  "unitStatus.arrived",
  "unitStatus.styled",
  "unitStatus.received",
  "unitStatus.rejected",
  "unitStatus.reworked",
  "costType.factory_unit_cost",
  "costType.factory_overhead",
  "costType.raw_hair",
  "costType.quality_inspection",
  "costType.freight_international",
  "costType.customs_duty",
  "costType.customs_clearing_fee",
  "costType.port_storage",
  "costType.3pl_lagos",
  "costType.styling_intercompany",
  "costType.packaging",
  "costType.wastage",
  "costType.samples",
  "costType.misc",
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
  } catch (err) {
    next(err);
  }
}

/**
 * GET /factory-i18n/with-translations
 * Returns all active language rows WITH translations, used to hydrate i18next.
 */
async function listAllWithTranslations(req, res, next) {
  try {
    const data = await repo.listAllWithTranslations();
    res.json({ data });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /factory-i18n/:code
 * Returns a single language row including translations.
 */
async function getOne(req, res, next) {
  try {
    const row = await repo.getWithTranslations(req.params.code.toLowerCase());
    if (!row)
      throw new AppError(
        "NOT_FOUND",
        `Language '${req.params.code}' not found`,
        404,
      );
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
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
        400,
      );
    }
    if (code === "en") {
      throw new AppError(
        "VALIDATION_ERROR",
        "Cannot overwrite the base English language via this endpoint",
        400,
      );
    }

    // display_name validation
    if (
      !display_name ||
      typeof display_name !== "string" ||
      !display_name.trim()
    ) {
      throw new AppError("VALIDATION_ERROR", "display_name is required", 400);
    }

    // Translations validation
    if (
      !translations ||
      typeof translations !== "object" ||
      Array.isArray(translations)
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "translations must be a JSON object",
        400,
      );
    }
    const missingKeys = REQUIRED_KEYS.filter((k) => !(k in translations));
    if (missingKeys.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        `translations is missing required keys: ${missingKeys.join(", ")}`,
        400,
        { fields: { translations: `Missing keys: ${missingKeys.join(", ")}` } },
      );
    }
    const nonStringKeys = REQUIRED_KEYS.filter(
      (k) => typeof translations[k] !== "string",
    );
    if (nonStringKeys.length) {
      throw new AppError(
        "VALIDATION_ERROR",
        `All translation values must be strings. Non-string keys: ${nonStringKeys.join(", ")}`,
        400,
        {
          fields: {
            translations: `Non-string values for: ${nonStringKeys.join(", ")}`,
          },
        },
      );
    }

    const row = await repo.create({
      language_code: code,
      display_name: display_name.trim(),
      translations,
    });
    res.status(201).json({ data: row });
  } catch (err) {
    next(err);
  }
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
        400,
      );
    }

    if (
      display_name !== undefined &&
      (typeof display_name !== "string" || !display_name.trim())
    ) {
      throw new AppError(
        "VALIDATION_ERROR",
        "display_name must be a non-empty string",
        400,
      );
    }
    if (is_active !== undefined && typeof is_active !== "boolean") {
      throw new AppError(
        "VALIDATION_ERROR",
        "is_active must be a boolean",
        400,
      );
    }

    const fields = {};
    if (display_name !== undefined) fields.display_name = display_name.trim();
    if (is_active !== undefined) fields.is_active = is_active;

    if (!Object.keys(fields).length) {
      throw new AppError(
        "VALIDATION_ERROR",
        "No updatable fields provided (display_name, is_active)",
        400,
      );
    }

    const row = await repo.update(code, fields);
    if (!row)
      throw new AppError("NOT_FOUND", `Language '${code}' not found`, 404);
    res.json({ data: row });
  } catch (err) {
    next(err);
  }
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
        400,
      );
    }
    const existing = await repo.getWithTranslations(code);
    if (!existing)
      throw new AppError("NOT_FOUND", `Language '${code}' not found`, 404);
    await repo.remove(code);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listLanguages,
  listAllWithTranslations,
  getOne,
  create,
  patchOne,
  deleteOne,
};
