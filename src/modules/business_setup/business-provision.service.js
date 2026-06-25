/**
 * Business provisioning (V2.2 §6.21 — "add a new business").
 *
 * The in-app equivalent of `scripts/bootstrap-business.js`: create the brand
 * schema, seed its `shared.business_config` row, apply every per-brand
 * template, verify the table count, then register the brand in the live
 * registry so it serves traffic without a restart.
 *
 * This runs DDL, so it is gated behind business_setup:create (CEO-level) and
 * validates the brand key against the strict identifier guard before it is
 * ever interpolated into `CREATE SCHEMA` / template SQL. On any failure it
 * rolls the half-built brand back (DROP SCHEMA CASCADE + remove the config
 * row) so a retry starts clean.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { getPool, query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { registerBrand, BRAND_KEY_RE } = require("../../config/brands");
const { audit } = require("../../middleware/audit");
const { AppError } = require("../../utils/errors");

const TEMPLATE_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "migrations",
  "template",
);

async function listBusinesses() {
  const { rows } = await query(
    `SELECT business_key, display_name, legal_name, document_prefix,
            trading_currency, is_active, created_at
       FROM shared.business_config
      ORDER BY created_at`,
  );
  return rows;
}

async function provisionBusiness({ input, user, request_id }) {
  const key = input.business_key;
  if (!BRAND_KEY_RE.test(key))
    throw new AppError(
      "INVALID_BRAND_KEY",
      "business_key must be lowercase letters/digits/underscore, starting with a letter",
      422,
    );

  // Reject if the brand already exists (config row or schema).
  const { rows: existing } = await query(
    `SELECT 1 FROM shared.business_config WHERE business_key = $1`,
    [key],
  );
  if (existing.length > 0)
    throw new AppError("BRAND_EXISTS", `Business '${key}' already exists`, 409);
  const { rows: schemaRows } = await query(
    `SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`,
    [key],
  );
  if (schemaRows.length > 0)
    throw new AppError(
      "SCHEMA_EXISTS",
      `A schema named '${key}' already exists`,
      409,
    );

  const templates = fs
    .readdirSync(TEMPLATE_DIR)
    .filter((f) => f.endsWith(".template"))
    .sort();

  const client = await getPool().connect();
  try {
    // 1. Schema. `key` is regex-validated above (identifiers can't be bound).
    await client.query(`CREATE SCHEMA ${key}`);

    // 2. Config row (must exist before templates that FK / seed against it).
    await client.query(
      `INSERT INTO shared.business_config
         (business_key, display_name, legal_name, document_prefix,
          trading_currency, settlement_currency, vat_rate, wht_rate)
       VALUES ($1,$2,$3,$4,
               COALESCE($5,'NGN'), COALESCE($6,'NGN'),
               COALESCE($7,0), COALESCE($8,0.05))`,
      [
        key,
        input.display_name,
        input.legal_name,
        input.document_prefix,
        input.trading_currency || null,
        input.settlement_currency || null,
        input.vat_rate !== null && input.vat_rate !== undefined
          ? input.vat_rate
          : null,
        input.wht_rate !== null && input.wht_rate !== undefined
          ? input.wht_rate
          : null,
      ],
    );

    // 3. Apply each per-brand template with {{BUSINESS}} substituted.
    for (const file of templates) {
      const sql = fs
        .readFileSync(path.join(TEMPLATE_DIR, file), "utf-8")
        .replace(/{{BUSINESS}}/g, key);
      await client.query(sql);
    }

    // 4. Verify.
    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS n
         FROM information_schema.tables WHERE table_schema = $1`,
      [key],
    );
    const tableCount = countRows[0].n;

    // 5. Go live in the running process.
    registerBrand(key);

    await audit({
      business: key,
      user_id: user.user_id,
      action_key: "business_setup.provision",
      target_type: "business_config",
      target_id: null,
      after: { business_key: key, tables: tableCount },
      request_id,
    });
    logger.info({ brand: key, tables: tableCount }, "business provisioned");

    return {
      business_key: key,
      display_name: input.display_name,
      document_prefix: input.document_prefix,
      table_count: tableCount,
      status: "active",
    };
  } catch (err) {
    // Roll back a half-provisioned brand so a retry is clean.
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${key} CASCADE`);
      await client.query(
        `DELETE FROM shared.business_config WHERE business_key = $1`,
        [key],
      );
    } catch (cleanupErr) {
      logger.error(
        { err: cleanupErr.message, brand: key },
        "business provision cleanup failed — manual cleanup may be needed",
      );
    }
    throw new AppError(
      "PROVISION_FAILED",
      `Failed to provision '${key}': ${err.message}`,
      500,
    );
  } finally {
    client.release();
  }
}

module.exports = { listBusinesses, provisionBusiness };
