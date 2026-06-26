#!/usr/bin/env node
/**
 * Nomba webhook RECEIVER self-test — proves the live server can verify and
 * accept a Nomba webhook, WITHOUT spending any money.
 *
 * What it does:
 *   1. Builds a representative `payment_success` payload.
 *   2. Signs it EXACTLY as Nomba does — HMAC-SHA256 over the canonical field
 *      string (event_type:requestId:userId:walletId:transactionId:type:time:
 *      responseCode:timestamp), base64-encoded — keyed on your webhook signature
 *      key (NOMBA_WEBHOOK_SIG_KEY).
 *   3. POSTs it to the live webhook URL → expects HTTP 200 { received: true }.
 *   4. POSTs the same payload with a TAMPERED signature → expects HTTP 401
 *      INVALID_SIGNATURE (proves bad webhooks are rejected, not silently eaten).
 *
 * This isolates "can the server verify a Nomba signature and log it?" from the
 * money flow. After it passes, check the DB:
 *   SELECT source, event_type, signature_valid, created_at
 *   FROM shared.webhook_log WHERE source='nomba' ORDER BY created_at DESC LIMIT 5;
 * The good POST should appear with signature_valid = true.
 *
 * Usage (run on the box so it loads the same env, OR pass flags):
 *   node scripts/nomba-webhook-selftest.js
 *   node scripts/nomba-webhook-selftest.js --url https://hub.pixiegirlglobal.com/api/webhooks/nomba
 *   NOMBA_WEBHOOK_SIG_KEY=<key> node scripts/nomba-webhook-selftest.js --url <url>
 *
 * The signature key is read from (first found):
 *   --key <key>  |  $NOMBA_WEBHOOK_SIG_KEY  |  $PIXIE_NOMBA_WEBHOOK_SIG_KEY  |
 *   $FAITLYN_NOMBA_WEBHOOK_SIG_KEY
 */

"use strict";

// Load .env the same way the app does, so a bare `node scripts/...` run sees
// NOMBA_WEBHOOK_SIG_KEY (and the per-brand variants) without exporting them.
require("dotenv").config();

const crypto = require("crypto");
const axios = require("axios");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const WEBHOOK_URL = arg(
  "url",
  process.env.NOMBA_WEBHOOK_URL ||
    "https://hub.pixiegirlglobal.com/api/webhooks/nomba",
);
const SIG_KEY =
  arg("key", null) ||
  process.env.NOMBA_WEBHOOK_SIG_KEY ||
  process.env.PIXIE_NOMBA_WEBHOOK_SIG_KEY ||
  process.env.FAITLYN_NOMBA_WEBHOOK_SIG_KEY ||
  null;

if (!SIG_KEY) {
  console.error(
    "\n❌  No webhook signature key found.\n" +
      "    Set NOMBA_WEBHOOK_SIG_KEY (the value you pasted into the Nomba\n" +
      "    dashboard), or pass --key <key>.\n",
  );
  process.exit(1);
}

// Build the canonical hashing string EXACTLY as nomba.service.js / Nomba docs.
function canonicalString(payload, timestamp) {
  const data = payload.data || {};
  const merchant = data.merchant || {};
  const transaction = data.transaction || {};
  let responseCode = transaction.responseCode || "";
  if (responseCode === "null") responseCode = "";
  return [
    payload.event_type || "",
    payload.requestId || "",
    merchant.userId || "",
    merchant.walletId || "",
    transaction.transactionId || "",
    transaction.type || "",
    transaction.time || "",
    responseCode,
    timestamp || "",
  ].join(":");
}

function sign(payload, timestamp, key) {
  return crypto
    .createHmac("sha256", key)
    .update(canonicalString(payload, timestamp), "utf8")
    .digest("base64");
}

async function post(payload, signature, timestamp, label) {
  try {
    const res = await axios.post(WEBHOOK_URL, payload, {
      headers: {
        "content-type": "application/json",
        "nomba-signature": signature,
        "nomba-timestamp": timestamp,
      },
      // We want to inspect 4xx ourselves, not throw.
      validateStatus: () => true,
      timeout: 20000,
    });
    console.log(`   ${label}: HTTP ${res.status} ${JSON.stringify(res.data)}`);
    return res.status;
  } catch (err) {
    console.log(`   ${label}: network error → ${err.message}`);
    return 0;
  }
}

(async () => {
  console.log(`\nNomba webhook self-test`);
  console.log(`URL: ${WEBHOOK_URL}`);
  console.log(`Key: ${SIG_KEY.slice(0, 6)}…${SIG_KEY.slice(-4)} (${SIG_KEY.length} chars)\n`);

  const timestamp = new Date().toISOString();
  const payload = {
    event_type: "payment_success",
    requestId: `selftest-${crypto.randomUUID()}`,
    data: {
      merchant: { userId: "selftest-user", walletId: "selftest-wallet" },
      transaction: {
        transactionId: `selftest-txn-${Date.now()}`,
        sessionId: `selftest-sess-${Date.now()}`,
        type: "checkout",
        time: timestamp,
        responseCode: "00",
        amount: 100,
        currency: "NGN",
      },
    },
  };

  const goodSig = sign(payload, timestamp, SIG_KEY);
  const badSig = sign(payload, timestamp, `${SIG_KEY}-tampered`);

  console.log("1) Valid signature → expect HTTP 200 { received: true }");
  const okStatus = await post(payload, goodSig, timestamp, "valid  ");

  console.log("\n2) Tampered signature → expect HTTP 401 INVALID_SIGNATURE");
  const badStatus = await post(payload, badSig, timestamp, "tampered");

  const pass = okStatus === 200 && badStatus === 401;
  console.log(
    `\n${pass ? "✅  PASS" : "❌  FAIL"} — valid=${okStatus} (want 200), tampered=${badStatus} (want 401)`,
  );
  if (okStatus === 200 && badStatus !== 401) {
    console.log(
      "   ⚠️  The server accepted the valid one but did NOT reject the tampered\n" +
        "       one with 401. Confirm NOMBA_WEBHOOK_SIG_KEY on the server matches\n" +
        "       the dashboard key and that the fixed code is deployed.",
    );
  }
  if (okStatus !== 200) {
    console.log(
      "   ⚠️  The valid signature was not accepted. Most likely the server's\n" +
        "       NOMBA_WEBHOOK_SIG_KEY does not match the key used here, or the\n" +
        "       fixed code is not deployed yet. Check the webhook_log table.",
    );
  }
  console.log(
    "\nNext: SELECT source, event_type, signature_valid, created_at\n" +
      "      FROM shared.webhook_log WHERE source='nomba'\n" +
      "      ORDER BY created_at DESC LIMIT 5;  -- the valid POST → signature_valid = true\n",
  );
  process.exit(pass ? 0 : 1);
})();
