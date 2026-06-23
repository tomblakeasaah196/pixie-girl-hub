/**
 * Customer-support contact resolver (public checkout + error recovery).
 *
 * When a buyer hits a wall we never want to leave them at a dead-end — we show
 * them how to reach the brand's support team. Numbers are owner-provided per
 * brand and overridable by env so they can change without a code deploy.
 *
 *   FAITLYNHAIR_SUPPORT_WHATSAPP / PIXIEGIRL_SUPPORT_WHATSAPP
 *
 * `email` is read from the brand's business_config (support_email) when a
 * config row is supplied; the WhatsApp number is the fast lane during a sale.
 */

"use strict";

// Owner-provided defaults (June 2026). Faitlynhair customer-care WhatsApp.
const DEFAULT_WHATSAPP = {
  faitlynhair: "+2348061987874",
  pixiegirl: null,
};

function envKey(brand) {
  return `${String(brand || "").toUpperCase()}_SUPPORT_WHATSAPP`;
}

/**
 * Resolve the support contact for a brand.
 * @param {string} brand               business_key (pixiegirl | faitlynhair)
 * @param {object} [brandConfig]       a business_config row (for support_email, display_name)
 * @returns {{ whatsapp: string|null, email: string|null, brand_name: string }}
 */
function getSupportContact(brand, brandConfig = null) {
  const whatsapp =
    process.env[envKey(brand)] ||
    DEFAULT_WHATSAPP[brand] ||
    process.env.SUPPORT_WHATSAPP ||
    null;
  const email =
    (brandConfig && (brandConfig.support_email || null)) ||
    process.env.SUPPORT_EMAIL ||
    null;
  const brand_name =
    (brandConfig && (brandConfig.display_name || null)) || brand || "Support";
  return { whatsapp, email, brand_name };
}

/**
 * A single friendly sentence telling the buyer how to reach a human. Always
 * returns something usable even when no channel is configured.
 */
function supportSentence(contact) {
  if (!contact) return "Please contact our support team and we'll help you complete your order.";
  const { whatsapp, email, brand_name } = contact;
  if (whatsapp && email)
    return `Please contact ${brand_name} support on WhatsApp ${whatsapp} (or email ${email}) and we'll complete your order.`;
  if (whatsapp)
    return `Please contact ${brand_name} support on WhatsApp ${whatsapp} and we'll complete your order.`;
  if (email)
    return `Please contact ${brand_name} support at ${email} and we'll complete your order.`;
  return `Please contact ${brand_name} support and we'll complete your order.`;
}

module.exports = { getSupportContact, supportSentence };
