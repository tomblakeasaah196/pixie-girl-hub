/**
 * Walk-in self-registration (F-16 / §6.16).
 *
 * A walk-in customer scans a per-brand QR at the store, which opens a short
 * public form; submitting it creates (or de-dupes to) a shared.contacts record
 * for that brand. Admins generate the QR from the back office. Reuses the
 * storefront contact repo so walk-ins land in the same CRM pipeline as online
 * leads. The public endpoint is IP-throttled (publicWriteLimiter) upstream.
 */

"use strict";

const QRCode = require("qrcode");
const { URLSearchParams } = require("url");
const repo = require("./storefront.repo");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { VALID } = require("../../config/brands");
const { AppError } = require("../../utils/errors");

function assertBrand(brand) {
  if (!brand || !VALID.has(brand))
    throw new AppError("INVALID_BRAND", "Unknown or missing brand", 422);
}

/**
 * Register (or match) a walk-in customer for a brand. Idempotent on
 * email/phone — a returning walk-in resolves to their existing contact rather
 * than creating a duplicate.
 */
async function registerWalkIn({ brand, input }) {
  assertBrand(brand);
  if (!input.primary_phone && !input.email)
    throw new AppError(
      "CONTACT_REQUIRED",
      "A phone number or email is required",
      422,
    );

  return transaction(async (client) => {
    const existing = await repo.findContactByEmailOrPhone({
      client,
      email: input.email,
      phone: input.primary_phone,
    });
    if (existing) {
      return { contact_id: existing.contact_id, returning: true };
    }

    const display_name =
      input.display_name ||
      [input.first_name, input.last_name].filter(Boolean).join(" ").trim() ||
      input.primary_phone ||
      input.email;

    const contact = await repo.createContact({
      client,
      brand,
      contact: {
        display_name,
        first_name: input.first_name,
        last_name: input.last_name,
        primary_phone: input.primary_phone,
        email: input.email,
      },
    });
    return { contact_id: contact.contact_id, returning: false };
  });
}

/**
 * Build the per-brand walk-in registration URL and a QR encoding it (PNG data
 * URL, ready to embed or print). An optional location tags where the QR lives.
 */
async function generateQr({ brand, location }) {
  assertBrand(brand);
  const base = config.APP_URL.replace(/\/$/, "");
  const params = new URLSearchParams({ b: brand });
  if (location) params.set("loc", location);
  const url = `${base}/walk-in?${params.toString()}`;
  const qr_data_url = await QRCode.toDataURL(url, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
  return { url, qr_data_url };
}

module.exports = { registerWalkIn, generateQr };
