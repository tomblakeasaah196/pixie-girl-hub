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
const contactsRepo = require("../../shared/contacts/contacts.repo");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { VALID } = require("../../config/brands");
const { AppError } = require("../../utils/errors");

function assertBrand(brand) {
  if (!brand || !VALID.has(brand))
    throw new AppError("INVALID_BRAND", "Unknown or missing brand", 422);
}

/**
 * Build a DATE from a birthday's month + day. Walk-ins give us the day they
 * celebrate, not the year, so we anchor to a leap year (1904) — that keeps
 * 29 Feb valid and the year is irrelevant to birthday reminders (which match
 * on month/day). Returns null unless BOTH parts are present.
 */
function dobFromParts(month, day) {
  if (!month || !day) return null;
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `1904-${mm}-${dd}`;
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
        whatsapp_number: input.whatsapp_number,
        email: input.email,
        date_of_birth: dobFromParts(input.dob_month, input.dob_day),
      },
    });

    // Capture the walk-in's address (with Google-Places lat/lng when supplied)
    // as their default delivery address — important for dispatch + service.
    if (input.address && input.address.line1) {
      await contactsRepo.addAddress({
        client,
        contact_id: contact.contact_id,
        input: {
          ...input.address,
          address_type: "delivery",
          is_default: true,
          recipient_name: display_name,
          recipient_phone: input.primary_phone || input.whatsapp_number,
        },
        user_id: null,
      });
    }
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
