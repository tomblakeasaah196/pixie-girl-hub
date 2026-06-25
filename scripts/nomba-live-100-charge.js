#!/usr/bin/env node
/**
 * LIVE ₦100 Nomba charge against a REAL order — end-to-end webhook proof.
 *
 * This mirrors "I made an order from the sales campaign landing page": you place
 * a normal order on the live landing page (or use any existing order), grab its
 * public tracking token, and this script raises a ₦100 Nomba pay-link against
 * that order, prints the checkout URL for you to pay, then WATCHES the order
 * until Nomba's webhook lands and the payment is recorded — printing the order
 * details + confirmation.
 *
 * It is 100% HTTP — it talks only to the public pay-link API the landing page
 * itself uses, so it exercises the exact production path:
 *   POST /api/public/pay/:token { amount_ngn: 100 }  → Nomba checkout link
 *   (you pay)  → Nomba webhook → /api/webhooks/nomba → payment recorded
 *   GET  /api/public/pay/:token                       → outstanding drops by ₦100
 *
 * ── How to get the token ──────────────────────────────────────────────
 *   1. Open the sales-campaign landing page and place an order as a customer.
 *   2. On the order/thank-you page the URL contains the order's public tracking
 *      token (the same token the "Pay" button uses). Copy it.
 *      (Or fetch it from the order in the admin: orders.public_tracking_token.)
 *
 * ── Usage ─────────────────────────────────────────────────────────────
 *   node scripts/nomba-live-100-charge.js --token <tracking_token>
 *   node scripts/nomba-live-100-charge.js \
 *       --base https://hub.pixiegirlglobal.com \
 *       --token <tracking_token> --amount 100
 *
 * Flags:
 *   --base    Base URL of the live API   (default https://hub.pixiegirlglobal.com)
 *   --token   Order public tracking token (REQUIRED)
 *   --amount  Naira amount to charge      (default 100)
 *   --watch   Seconds to poll for the webhook confirmation (default 300)
 */

"use strict";

// Load .env the same way the app does (for APP_URL / defaults).
require("dotenv").config();

const axios = require("axios");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = String(
  arg("base", process.env.APP_URL || "https://hub.pixiegirlglobal.com"),
).replace(/\/$/, "");
const TOKEN = arg("token", null);
const AMOUNT = Number(arg("amount", "100"));
const WATCH_SECONDS = Number(arg("watch", "300"));

if (!TOKEN) {
  console.error(
    "\n❌  --token <tracking_token> is required.\n" +
      "    Place an order on the landing page, copy its public tracking token,\n" +
      "    then re-run: node scripts/nomba-live-100-charge.js --token <token>\n",
  );
  process.exit(1);
}

const api = axios.create({
  baseURL: BASE,
  timeout: 30000,
  validateStatus: () => true,
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function preview() {
  const res = await api.get(`/api/public/pay/${encodeURIComponent(TOKEN)}`);
  if (res.status !== 200) {
    throw new Error(`preview failed: HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.data || res.data;
}

function pickPaymentUrl(d) {
  // createPaymentLink returns the gateway's link under a provider-specific key.
  return (
    d.payment_url ||
    d.checkout_url ||
    d.checkoutLink ||
    d.authorization_url ||
    d.url ||
    (d.data &&
      (d.data.payment_url ||
        d.data.checkout_url ||
        d.data.checkoutLink ||
        d.data.authorization_url ||
        d.data.url)) ||
    null
  );
}

(async () => {
  console.log(`\nLive ₦${AMOUNT} Nomba charge`);
  console.log(`API:   ${BASE}`);
  console.log(`Token: ${TOKEN}\n`);

  // 1) Show the order before charging.
  const before = await preview();
  console.log("Order BEFORE:");
  console.log(`   order_number : ${before.order_number}`);
  console.log(`   brand        : ${before.brand}`);
  console.log(`   status       : ${before.status}`);
  console.log(`   total        : ₦${before.total_ngn}`);
  console.log(`   outstanding  : ₦${before.outstanding_ngn}\n`);
  const outstandingBefore = Number(before.outstanding_ngn);

  // 2) Raise the ₦100 pay-link (this is exactly what the landing "Pay" button does).
  console.log(`Creating a ₦${AMOUNT} Nomba pay-link…`);
  const res = await api.post(`/api/public/pay/${encodeURIComponent(TOKEN)}`, {
    amount_ngn: AMOUNT,
    currency: "NGN",
  });
  if (res.status !== 201 && res.status !== 200) {
    console.error(
      `❌  pay-link creation failed: HTTP ${res.status}\n   ${JSON.stringify(res.data, null, 2)}`,
    );
    process.exit(1);
  }
  const payData = res.data.data || res.data;
  const payUrl = pickPaymentUrl(payData);
  if (!payUrl) {
    console.error(
      "❌  No checkout URL returned. Raw response:\n" +
        JSON.stringify(payData, null, 2),
    );
    process.exit(1);
  }

  console.log(`\n💳  PAY ₦${AMOUNT} HERE (open in a browser):\n\n   ${payUrl}\n`);
  console.log(
    `Provider: ${payData.provider || "(nomba)"}   ` +
      `reference: ${payData.reference || payData.provider_reference || "(see link)"}\n`,
  );

  // 3) Watch the order until Nomba's webhook records the payment (outstanding drops).
  console.log(
    `Watching the order for up to ${WATCH_SECONDS}s — pay the link above and the\n` +
      `webhook will drop the outstanding balance by ₦${AMOUNT}…\n`,
  );
  const deadline = Date.now() + WATCH_SECONDS * 1000;
  let confirmed = false;
  while (Date.now() < deadline) {
    await sleep(5000);
    let now;
    try {
      now = await preview();
    } catch (e) {
      process.stdout.write("·");
      continue;
    }
    const outstandingNow = Number(now.outstanding_ngn);
    if (outstandingNow < outstandingBefore - 0.001) {
      confirmed = true;
      console.log(`\n\n✅  WEBHOOK CONFIRMED — payment recorded against the order.`);
      console.log(`   order_number : ${now.order_number}`);
      console.log(`   status       : ${now.status}`);
      console.log(
        `   outstanding  : ₦${before.outstanding_ngn}  →  ₦${now.outstanding_ngn}  ` +
          `(−₦${(outstandingBefore - outstandingNow).toFixed(2)})\n`,
      );
      break;
    }
    process.stdout.write(".");
  }

  if (!confirmed) {
    console.log(
      `\n\n⏳  No confirmation within ${WATCH_SECONDS}s. If you DID pay, check:\n` +
        `   • shared.webhook_log  (source='nomba', signature_valid=true?)\n` +
        `   • the order's payments in the admin\n` +
        `   • run scripts/nomba-webhook-selftest.js to test the receiver in isolation.\n`,
    );
    process.exit(2);
  }
  console.log(
    "Done. The ₦" +
      AMOUNT +
      " now shows on the order, recorded from the Nomba webhook. 🎉\n",
  );
  process.exit(0);
})().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
