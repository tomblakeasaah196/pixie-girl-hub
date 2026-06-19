/**
 * Cost Vault (V2.2 §6.24 P0-1) — business logic.
 *
 * The owner's most sensitive numbers — the TRUE landed cost and the
 * supplier identity behind a variant — live encrypted in the per-brand
 * product_variant_cost_vault. They are visible ONLY to:
 *   • the owner (req.user.is_ceo), or
 *   • a user holding a live shared.cost_vault_grants row for the brand.
 *
 * Two guarantees this module enforces:
 *   1. SERVER-SIDE REDACTION — `redactVariants` strips the deprecated
 *      plaintext cost columns from every catalogue response unless the
 *      caller may see cost, so cost never reaches the browser.
 *   2. ENCRYPTION AT REST — cost is only ever stored as AES-256-GCM
 *      ciphertext (encryption.service); the DB never holds plaintext cost.
 *
 * Only the owner may grant/revoke vault access (like ai_access_grants).
 * Every cost view, write, grant, and revoke is audited as sensitive.
 */

"use strict";

const repo = require("./cost_vault.repo");
const encryption = require("../../services/encryption.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const {
  AppError,
  NotFoundError,
  PermissionDeniedError,
} = require("../../utils/errors");

// Deprecated plaintext cost columns that must never leave the API for a
// caller who isn't a vault grantee. price_wholesale_ngn is deliberately
// NOT here — wholesale is the operational, non-secret number ops/sales use.
const REDACTED_COST_FIELDS = ["cost_price_ngn", "min_price_ngn"];

function auditSensitive(args) {
  return audit({
    ...args,
    metadata: { ...(args.metadata || {}), sensitive: true },
  });
}

/** Owner or live grantee for this brand? */
async function canSeeCost({ client, user, brand }) {
  if (!user) return false;
  if (user.is_ceo) return true;
  return repo.hasGrant({ client, user_id: user.user_id, business: brand });
}

function requireOwner(user) {
  if (!user || !user.is_ceo) {
    throw new PermissionDeniedError(
      "Only the owner can manage cost-vault access.",
    );
  }
}

/**
 * Strip cost columns from a single variant unless `visible`. Returns a
 * shallow copy so the caller's row object is never mutated in place.
 */
function redactVariant(variant, visible) {
  if (!variant || visible) return variant;
  const out = { ...variant };
  for (const f of REDACTED_COST_FIELDS) delete out[f];
  return out;
}

function redactVariants(variants, visible) {
  if (!Array.isArray(variants)) return variants;
  return variants.map((v) => redactVariant(v, visible));
}

// ── Read one variant's cost (grantee-only, audited) ──────
async function getCost({ brand, user, request_id, variant_id }) {
  const allowed = await canSeeCost({ user, brand });
  if (!allowed) {
    throw new PermissionDeniedError("You do not have cost-vault access.");
  }
  const row = await repo.getVault({ brand, variant_id });
  if (!row) return null;

  const supplier = row.supplier_id
    ? await repo.supplierLabel({ brand, supplier_id: row.supplier_id })
    : null;

  await auditSensitive({
    business: brand,
    user_id: user.user_id,
    action_key: "catalogue.cost_vault.view",
    target_type: "product_variant_cost_vault",
    target_id: variant_id,
    request_id,
  });

  return {
    variant_id,
    cost_ngn: row.cost_ngn_enc
      ? Number(encryption.decrypt(row.cost_ngn_enc))
      : null,
    cost_native: row.cost_native_enc
      ? JSON.parse(encryption.decrypt(row.cost_native_enc))
      : null,
    supplier_id: row.supplier_id,
    supplier_code: supplier ? supplier.supplier_code : null,
    supplier_name: supplier ? supplier.display_name : null,
    cost_source: row.cost_source,
    cost_last_refreshed_at: row.cost_last_refreshed_at,
  };
}

// ── Write a variant's cost (grantee-only, encrypts, audited) ──
// Client-aware core so callers in an existing transaction (e.g. bulk import)
// can set cost atomically without nesting a second transaction.
async function setCostTx({
  client,
  brand,
  user,
  request_id,
  variant_id,
  input,
}) {
  const allowed = await canSeeCost({ client, user, brand });
  if (!allowed) {
    throw new PermissionDeniedError("You do not have cost-vault access.");
  }
  const fields = {
    updated_by: user.user_id,
    cost_source: input.cost_source || "manual",
    supplier_id: input.supplier_id ?? null,
  };
  if (input.cost_ngn !== undefined && input.cost_ngn !== null) {
    fields.cost_ngn_enc = encryption.encrypt(String(input.cost_ngn));
  }
  if (input.cost_native) {
    fields.cost_native_enc = encryption.encrypt(
      JSON.stringify(input.cost_native),
    );
  }
  const row = await repo.upsertVault({ client, brand, variant_id, fields });

  await auditSensitive({
    business: brand,
    user_id: user.user_id,
    action_key: "catalogue.cost_vault.update",
    target_type: "product_variant_cost_vault",
    target_id: variant_id,
    // Never log the cost itself — only that it changed and the source.
    after: {
      cost_source: fields.cost_source,
      supplier_set: !!fields.supplier_id,
    },
    request_id,
  });
  return { variant_id, cost_last_refreshed_at: row.cost_last_refreshed_at };
}

async function setCost({ brand, user, request_id, variant_id, input }) {
  return transaction((client) =>
    setCostTx({ client, brand, user, request_id, variant_id, input }),
  );
}

// ── Self access check (any authed catalogue user) ────────
// Lets the UI decide whether to render the cost-vault section without
// leaking anything — returns only a boolean, never cost/supplier data.
async function myAccess({ brand, user }) {
  return { can_see: await canSeeCost({ user, brand }) };
}

// ── Grants (owner-only, audited) ─────────────────────────
async function listGrants({ brand, user }) {
  requireOwner(user);
  return repo.listGrants({ brand });
}

async function grantAccess({ brand, user, request_id, input }) {
  requireOwner(user);
  if (input.user_id === user.user_id) {
    throw new AppError(
      "INVALID_GRANT",
      "The owner already has cost-vault access.",
      400,
    );
  }
  const g = await transaction((client) =>
    repo.grant({
      client,
      user_id: input.user_id,
      business: input.business || brand,
      granted_by: user.user_id,
    }),
  );
  await auditSensitive({
    business: brand,
    user_id: user.user_id,
    action_key: "catalogue.cost_vault.grant",
    target_type: "cost_vault_grant",
    target_id: g.grant_id,
    after: { user_id: input.user_id, business: g.business },
    request_id,
  });
  return g;
}

async function revokeAccess({
  brand,
  user,
  request_id,
  target_user_id,
  reason,
}) {
  requireOwner(user);
  const ok = await transaction((client) =>
    repo.revoke({ client, user_id: target_user_id, business: brand, reason }),
  );
  if (!ok) throw new NotFoundError("Cost-vault grant");
  await auditSensitive({
    business: brand,
    user_id: user.user_id,
    action_key: "catalogue.cost_vault.revoke",
    target_type: "cost_vault_grant",
    target_id: target_user_id,
    after: { user_id: target_user_id, reason: reason || null },
    request_id,
  });
  return { revoked: true };
}

module.exports = {
  canSeeCost,
  redactVariant,
  redactVariants,
  myAccess,
  getCost,
  setCost,
  setCostTx,
  listGrants,
  grantAccess,
  revokeAccess,
};
