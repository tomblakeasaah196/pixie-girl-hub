#!/usr/bin/env node
/**
 * Checkout reproducer — calls the public campaign checkout service DIRECTLY
 * with a synthetic buyer, and prints the REAL error stack (the thing that was
 * being hidden behind the generic INTERNAL_ERROR / "unhandled error" log).
 *
 * It runs the exact same code path the storefront hits, so whatever throws in
 * order-building will surface here with its file + line.
 *
 * ⚠️ On success it creates a REAL test order (and a real payment link) for the
 * brand — fine for diagnosis, just delete the test order afterwards.
 *
 * Usage (from app root, so it loads .env):
 *   node scripts/test-checkout.js <brand> <slug> <product_id> [qty] [gateway]
 *
 * Example (reproduce the failing one):
 *   node scripts/test-checkout.js faitlynhair pixie-girl-summer-sale 72364403-b05d-490e-902f-cb889a03069e 2 paystack
 *
 * Try the brand the sale actually belongs to as well:
 *   node scripts/test-checkout.js pixiegirl pixie-girl-summer-sale 72364403-b05d-490e-902f-cb889a03069e 2 paystack
 */

"use strict";

const { initDatabase } = require("../src/config/database");
const svc = require("../src/modules/sales_campaigns/campaigns.public.service");

const brand = process.argv[2];
const slug = process.argv[3];
const id = process.argv[4]; // product_id OR styled_variant_id (see kind)
const qty = Number(process.argv[5] || "1");
const gateway = process.argv[6] || "paystack";
const kind = (process.argv[7] || "product").toLowerCase(); // "product" | "styled"

if (!brand || !slug || !id) {
  console.error(
    "Usage: node scripts/test-checkout.js <brand> <slug> <id> [qty] [gateway] [product|styled]",
  );
  process.exit(2);
}

// A styled line carries styled_variant_id (priced from the styled tables);
// a product line carries product_id (priced from product_variants).
const cartItem =
  kind === "styled"
    ? { styled_variant_id: id, quantity: qty }
    : { product_id: id, quantity: qty };

const stamp = Date.now();
const input = {
  contact: {
    first_name: "Test",
    last_name: "Buyer",
    email: `gateway-test+${stamp}@example.com`,
    phone: `+234800${String(stamp).slice(-7)}`,
    address: {
      line1: "1 Test Street",
      city: "Lagos",
      state: "Lagos",
      country: "Nigeria",
    },
    consent: {
      whatsapp_opt_in: false,
      marketing_opt_in: false,
      terms_accepted: true,
    },
  },
  cart: [cartItem],
  payment_gateway: gateway,
  client_idempotency_key: `diag-${slug}-${stamp}`,
  utm: {},
};

(async () => {
  console.warn(
    `Reproducing checkout — brand=${brand} slug=${slug} ${kind}=${id} qty=${qty} gateway=${gateway}\n`,
  );
  try {
    await initDatabase(); // the standalone script must open the pool itself
    const out = await svc.checkout({
      slug,
      brand,
      brandHint: brand,
      input,
      ip: "127.0.0.1",
      user_agent: "checkout-repro-script",
    });
    console.warn("✓ CHECKOUT OK:", JSON.stringify(out, null, 2));
  } catch (err) {
    console.warn("✗ CHECKOUT FAILED");
    console.warn("   code:", err.code || "(none)");
    console.warn("   http:", err.http_status || "(none)");
    console.warn("   message:", err.message);
    console.warn("\n--- STACK ---\n" + (err.stack || "(no stack)"));
  } finally {
    process.exit(0);
  }
})();
