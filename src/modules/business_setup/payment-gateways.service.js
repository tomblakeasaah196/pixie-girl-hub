/**
 * Payment-gateway configuration service (B / PD §6.21).
 *
 * CEO-managed (Business Setup) per-business gateway config: credentials
 * (encrypted at rest), active/primary/fallback status, supported currencies.
 * Paystack + OPay are the local-NGN pair (one primary, one automatic fallback);
 * Nomba is POS; Stripe international. The fee SCHEDULE lives in
 * business_config.payment_gateway_fees (§6.25).
 *
 * Two consumers:
 *   - HTTP admin (list/configure/activate/role/remove) — credentials are NEVER
 *     returned; list reports only which fields are set.
 *   - Internal `resolveCredentials` / `getActiveChain` — used by the gateway
 *     clients + (C) the checkout fallback orchestrator. DB creds override env;
 *     env is the fallback so existing single-tenant setups keep working.
 */

"use strict";

const repo = require("./payment-gateways.repo");
const crypto = require("../../services/encryption.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { NotFoundError, AppError } = require("../../utils/errors");

const PROVIDERS = ["paystack", "opay", "nomba", "stripe"];

// env fallback bags (used when no DB row, or to fill unset DB fields).
function envCreds(provider) {
  switch (provider) {
    case "paystack":
      return { secret_key: config.PAYSTACK_SECRET_KEY || null };
    case "opay":
      return {
        public_key: config.OPAY_PUBLIC_KEY || null,
        private_key: config.OPAY_PRIVATE_KEY || null,
        merchant_id: config.OPAY_MERCHANT_ID || null,
      };
    case "nomba":
      return {
        client_id: config.NOMBA_CLIENT_ID || null,
        client_secret: config.NOMBA_API_KEY || null,
        account_id: config.NOMBA_ACCOUNT_ID || null,
      };
    case "stripe":
      return {
        secret_key: config.STRIPE_SECRET_KEY || null,
        webhook_secret: config.STRIPE_WEBHOOK_SECRET || null,
      };
    default:
      return {};
  }
}

function decryptBag(credentials_enc) {
  if (!credentials_enc) return {};
  try {
    return JSON.parse(crypto.decrypt(credentials_enc));
  } catch {
    return {};
  }
}

// ── Admin (HTTP) ───────────────────────────────────────────
function listGateways({ brand }) {
  return repo.list({ brand });
}

async function configureGateway({ brand, user, request_id, input }) {
  if (!PROVIDERS.includes(input.provider))
    throw new AppError(
      "BAD_PROVIDER",
      `Unknown gateway ${input.provider}`,
      422,
    );
  // Nomba is POS and Stripe is international → force 'standalone'.
  let role = input.role;
  if (input.provider === "nomba" || input.provider === "stripe")
    role = "standalone";

  const credentials_enc =
    input.credentials && Object.keys(input.credentials).length
      ? crypto.encrypt(JSON.stringify(input.credentials))
      : undefined;

  const saved = await transaction(async (client) => {
    if (role === "primary")
      await repo.demoteExistingPrimary({
        client,
        brand,
        exceptProvider: input.provider,
      });
    return repo.upsert({
      client,
      brand,
      configured_by: user ? user.user_id : null,
      row: {
        provider: input.provider,
        is_active: input.is_active,
        role,
        credentials_enc,
        supported_currencies: input.supported_currencies,
        display_label: input.display_label,
      },
    });
  });

  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "business_setup.payment_gateway.configure",
    target_type: "payment_gateway",
    target_id: saved.gateway_id,
    after: {
      provider: saved.provider,
      role: saved.role,
      is_active: saved.is_active,
    },
    request_id,
  });
  return maskRow(saved);
}

async function setActive({ brand, user, request_id, provider, is_active }) {
  const r = await repo.setFields({ brand, provider, fields: { is_active } });
  if (!r) throw new NotFoundError("Payment gateway");
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "business_setup.payment_gateway.set_active",
    target_type: "payment_gateway",
    target_id: r.gateway_id,
    after: { is_active },
    request_id,
  });
  return maskRow(r);
}

async function setRole({ brand, user, request_id, provider, role }) {
  if (!["primary", "fallback", "standalone"].includes(role))
    throw new AppError("BAD_ROLE", `Unknown role ${role}`, 422);
  const r = await transaction(async (client) => {
    if (role === "primary")
      await repo.demoteExistingPrimary({
        client,
        brand,
        exceptProvider: provider,
      });
    return repo.setFields({ client, brand, provider, fields: { role } });
  });
  if (!r) throw new NotFoundError("Payment gateway");
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "business_setup.payment_gateway.set_role",
    target_type: "payment_gateway",
    target_id: r.gateway_id,
    after: { role },
    request_id,
  });
  return maskRow(r);
}

async function removeGateway({ brand, user, request_id, provider }) {
  const ok = await repo.remove({ brand, provider });
  if (!ok) throw new NotFoundError("Payment gateway");
  await audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key: "business_setup.payment_gateway.remove",
    target_type: "payment_gateway",
    target_id: ok.gateway_id,
    request_id,
  });
}

function maskRow(r) {
  if (!r) return r;
  const { credentials_enc, ...rest } = r;
  return { ...rest, has_credentials: Boolean(credentials_enc) };
}

// ── Internal (AI/payment layer only — never exposed over HTTP) ─
/**
 * Merged credentials for a provider in a brand: env defaults overlaid with the
 * decrypted DB bag (DB wins). Returns the credential object the gateway clients
 * expect, or null if nothing is configured at all.
 */
async function resolveCredentials({ brand, provider }) {
  const base = envCreds(provider);
  let row = null;
  try {
    row = await repo.getRaw({ brand, provider });
  } catch {
    row = null;
  }
  if (row && row.is_active === false) return null; // explicitly disabled
  const dbBag = row ? decryptBag(row.credentials_enc) : {};
  const merged = { ...base };
  for (const [k, v] of Object.entries(dbBag))
    if (v !== null && v !== "") merged[k] = v;
  const anySet = Object.values(merged).some((v) => v !== null && v !== "");
  return anySet ? merged : null;
}

/**
 * Ordered gateway chain to attempt for a payment in `currency` (C / §6.21):
 * NGN → active local pair, primary first then fallback; non-NGN → Stripe.
 * Falls back to env-only providers when no DB config exists. Returns
 * [{ provider, credentials }].
 */
async function getActiveChain({ brand, currency = "NGN" }) {
  const ngn = String(currency).toUpperCase() === "NGN";
  let rows = [];
  try {
    rows = await repo.activeForCurrency({ brand, ngn });
  } catch {
    rows = [];
  }
  const chain = [];
  if (rows.length) {
    for (const r of rows) {
      const creds = await resolveCredentials({ brand, provider: r.provider });
      if (creds) chain.push({ provider: r.provider, credentials: creds });
    }
  } else {
    // No DB config → env fallback (single-tenant): primary = paystack for NGN,
    // stripe for foreign.
    const fallbackProviders = ngn ? ["paystack", "opay"] : ["stripe"];
    for (const p of fallbackProviders) {
      const creds = await resolveCredentials({ brand, provider: p });
      if (creds) chain.push({ provider: p, credentials: creds });
    }
  }
  return chain;
}

module.exports = {
  PROVIDERS,
  listGateways,
  configureGateway,
  setActive,
  setRole,
  removeGateway,
  resolveCredentials,
  getActiveChain,
};
