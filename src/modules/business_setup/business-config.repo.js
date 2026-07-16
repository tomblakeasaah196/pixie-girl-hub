/**
 * Business-config repository.
 *
 * Backs the `brandContextMiddleware` — resolves a brand key
 * ('pixiegirl' | 'faitlynhair') to its config row so the request can
 * carry req.brand_id and req.brand_config.
 *
 * Table: shared.business_config (config_id, business_key, ...)
 */

"use strict";

const { query } = require("../../config/database");

/**
 * Resolve a brand by its key. Returns null if not configured.
 * `business_id` is aliased from config_id for callers that expect it.
 *
 * @param {string} businessKey 'valid brand key'
 */
async function findByKey(businessKey) {
  const { rows } = await query(
    `SELECT config_id,
            config_id AS business_id,
            business_key,
            display_name,
            legal_name,
            trading_currency,
            settlement_currency,
            document_prefix,
            storefront_domain,
            storefront_enabled,
            vat_rate,
            wht_rate,
            accent_colour,
            logo_path,
            address,
            phone,
            email,
            instagram_handle,
            loyalty_settings,
            cancellation_settings,
            payment_methods,
            payment_gateway_fees,
            installment_settings,
            allow_staff_recorded_manual_payments,
            cash_request_ceo_threshold_ngn,
            email_signature_template
       FROM shared.business_config
      WHERE business_key = $1
      LIMIT 1`,
    [businessKey],
  );
  return rows[0] || null;
}

/**
 * Display-safe public identity for a brand — backs the unauthenticated
 * GET /api/public/brand/:brandKey feed the public apps (sales landing,
 * storefront) read instead of hardcoding brand domains or mailboxes.
 * Every field is CEO-editable in Settings → Business Setup → Public
 * Identity, so a domain change never requires a code change.
 */
async function findPublicIdentity(businessKey) {
  const { rows } = await query(
    `SELECT business_key,
            display_name,
            website,
            storefront_domain,
            sales_subdomain,
            support_email,
            support_email_display_name,
            accent_colour,
            logo_path
       FROM shared.business_config
      WHERE business_key = $1 AND is_active = true
      LIMIT 1`,
    [businessKey],
  );
  return rows[0] || null;
}

module.exports = { findByKey, findPublicIdentity };
