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
            cash_request_ceo_threshold_ngn,
            email_signature_template
       FROM shared.business_config
      WHERE business_key = $1
      LIMIT 1`,
    [businessKey],
  );
  return rows[0] || null;
}

module.exports = { findByKey };
