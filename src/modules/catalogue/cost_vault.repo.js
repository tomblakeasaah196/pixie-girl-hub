/**
 * Cost Vault (V2.2 §6.24 P0-1) — repository. Parameterised SQL only.
 *
 * Two stores:
 *   shared.cost_vault_grants                 — owner-controlled access list
 *   <brand>.product_variant_cost_vault       — encrypted true cost + supplier
 *
 * This layer NEVER decrypts; it returns the raw ciphertext columns. The
 * service decrypts only after an access check, so a caller that bypasses
 * the service still gets nothing usable.
 */

"use strict";

const { query } = require("../../config/database");
const { VALID } = require("../../config/brands");

const t = (b, tbl) => {
  if (!VALID.has(b)) throw new Error(`Invalid brand: ${b}`);
  return `${b}.${tbl}`;
};
const ex = (c) => (c ? c.query.bind(c) : query);

// ── Grants (shared) ──────────────────────────────────────
// A user can see the vault for a brand if they hold a live grant for
// that exact brand OR a wildcard ('*') grant across all brands.
async function hasGrant({ client, user_id, business }) {
  const { rows } = await ex(client)(
    `SELECT 1 FROM shared.cost_vault_grants
      WHERE user_id = $1 AND business IN ($2, '*') AND revoked_at IS NULL
      LIMIT 1`,
    [user_id, business],
  );
  return rows.length > 0;
}

async function listGrants({ client, business }) {
  const { rows } = await ex(client)(
    `SELECT g.grant_id, g.user_id, g.business, g.granted_by, g.granted_at,
            u.email AS user_email
       FROM shared.cost_vault_grants g
       LEFT JOIN shared.users u ON u.user_id = g.user_id
      WHERE g.business IN ($1, '*') AND g.revoked_at IS NULL
      ORDER BY g.granted_at DESC`,
    [business],
  );
  return rows;
}

async function grant({ client, user_id, business, granted_by }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.cost_vault_grants (user_id, business, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, business) DO UPDATE
       SET granted_by = EXCLUDED.granted_by, granted_at = now(),
           revoked_at = NULL, revoked_reason = NULL
     RETURNING *`,
    [user_id, business, granted_by || null],
  );
  return rows[0];
}

async function revoke({ client, user_id, business, reason }) {
  const { rowCount } = await ex(client)(
    `UPDATE shared.cost_vault_grants
        SET revoked_at = now(), revoked_reason = $3
      WHERE user_id = $1 AND business = $2 AND revoked_at IS NULL`,
    [user_id, business, reason || null],
  );
  return rowCount > 0;
}

// ── Vault rows (per-brand) ───────────────────────────────
async function getVault({ client, brand, variant_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "product_variant_cost_vault")} WHERE variant_id = $1`,
    [variant_id],
  );
  return rows[0] || null;
}

async function upsertVault({ client, brand, variant_id, fields }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "product_variant_cost_vault")}
       (variant_id, cost_ngn_enc, cost_native_enc, supplier_id, cost_source,
        cost_last_refreshed_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, now(), $6)
     ON CONFLICT (variant_id) DO UPDATE SET
       cost_ngn_enc = COALESCE(EXCLUDED.cost_ngn_enc, ${t(brand, "product_variant_cost_vault")}.cost_ngn_enc),
       cost_native_enc = COALESCE(EXCLUDED.cost_native_enc, ${t(brand, "product_variant_cost_vault")}.cost_native_enc),
       supplier_id = COALESCE(EXCLUDED.supplier_id, ${t(brand, "product_variant_cost_vault")}.supplier_id),
       cost_source = COALESCE(EXCLUDED.cost_source, ${t(brand, "product_variant_cost_vault")}.cost_source),
       cost_last_refreshed_at = now(),
       updated_by = EXCLUDED.updated_by
     RETURNING *`,
    [
      variant_id,
      fields.cost_ngn_enc ?? null,
      fields.cost_native_enc ?? null,
      fields.supplier_id ?? null,
      fields.cost_source ?? null,
      fields.updated_by ?? null,
    ],
  );
  return rows[0];
}

// Resolve the anonymised supplier_code for a supplier_id (shown alongside
// the de-anonymised name only to vault grantees).
async function supplierLabel({ client, brand, supplier_id }) {
  if (!supplier_id) return null;
  const { rows } = await ex(client)(
    `SELECT supplier_id, supplier_code, display_name
       FROM ${t(brand, "suppliers")} WHERE supplier_id = $1`,
    [supplier_id],
  );
  return rows[0] || null;
}

module.exports = {
  hasGrant,
  listGrants,
  grant,
  revoke,
  getVault,
  upsertVault,
  supplierLabel,
};
