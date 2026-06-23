#!/usr/bin/env node
/**
 * Gateway smoke test — initialise a checkout on each NGN gateway DIRECTLY,
 * using the SAME per-brand credential resolution the app uses, and print the
 * checkout URL or the gateway's ACTUAL error (axios response body included).
 *
 * It does NOT create an order or write to the DB — it only reads the brand's
 * gateway credentials and calls Nomba/Paystack's "initialize" endpoints. So
 * it isolates "is the gateway itself working?" from the checkout flow.
 *
 * Usage (from the app root, so it loads the same .env):
 *   node scripts/test-gateways.js [brand] [amount_ngn] [email]
 *
 * Examples:
 *   node scripts/test-gateways.js faitlynhair
 *   node scripts/test-gateways.js pixiegirl 500 buyer@example.com
 *
 * Brand must be a valid brand key (e.g. pixiegirl | faitlynhair).
 */

"use strict";

const gateways = require("../src/modules/business_setup/payment-gateways.service");
const paystack = require("../src/services/paystack.service");
const nomba = require("../src/services/nomba.service");
const { config } = require("../src/config/env");

const brand = process.argv[2] || "pixiegirl";
const amount_ngn = process.argv[3] || "200";
const email = process.argv[4] || "gateway-test@example.com";

const ref = (p) => `test-${p}-${Date.now().toString(36)}`;
const callback_url = `${(config.APP_URL || "https://example.com").replace(
  /\/$/,
  "",
)}/pay/callback`;

/** axios errors carry the gateway's real rejection in err.response.data. */
function showErr(err) {
  if (err.response) {
    console.warn("   ✗ HTTP", err.response.status);
    console.warn(
      "   ✗ Gateway response:",
      JSON.stringify(err.response.data, null, 2),
    );
  } else if (err.request) {
    console.warn("   ✗ No response (network/timeout):", err.message);
  } else {
    console.warn("   ✗ Error:", err.message);
  }
}

async function testNomba() {
  console.warn("\n=== NOMBA ===");
  const creds = await gateways.resolveCredentials({ brand, provider: "nomba" });
  console.warn("   keys present:", nomba.isConfigured(creds));
  if (!nomba.isConfigured(creds)) {
    console.warn("   → no Nomba keys for this brand/env; skipping");
    return;
  }
  try {
    const data = await nomba.initializePayment({
      reference: ref("nomba"),
      amount_ngn, // NGN major units (Nomba is not kobo)
      email,
      callback_url,
      creds,
    });
    const url =
      data && data.data && (data.data.checkoutLink || data.data.checkout_url);
    console.warn("   ✓ OK →", url || JSON.stringify(data));
  } catch (err) {
    showErr(err);
  }
}

async function testPaystack() {
  console.warn("\n=== PAYSTACK ===");
  const creds = await gateways.resolveCredentials({
    brand,
    provider: "paystack",
  });
  console.warn("   keys present:", paystack.isConfigured(creds));
  if (!paystack.isConfigured(creds)) {
    console.warn("   → no Paystack keys for this brand/env; skipping");
    return;
  }
  try {
    const data = await paystack.initializeTransaction({
      email,
      amount_kobo: Number(amount_ngn) * 100, // Paystack is kobo
      reference: ref("paystack"),
      callback_url,
      metadata: { test: true, brand },
      creds,
    });
    const url = data && data.data && data.data.authorization_url;
    console.warn("   ✓ OK →", url || JSON.stringify(data));
  } catch (err) {
    showErr(err);
  }
}

(async () => {
  console.warn(`Brand: ${brand}   Amount: ₦${amount_ngn}   Email: ${email}`);
  console.warn("Enabled providers (env):", gateways.enabledProviders());
  try {
    const chain = await gateways.getActiveChain({ brand, currency: "NGN" });
    console.warn(
      "Active NGN chain:",
      chain.map((c) => c.provider).join(" → ") || "(none configured)",
    );
  } catch (e) {
    console.warn("chain lookup error:", e.message);
  }

  await testNomba();
  await testPaystack();
  console.warn("\nDone.");
  process.exit(0);
})().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
