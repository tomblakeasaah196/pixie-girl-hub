#!/usr/bin/env node
// nomba-setup.js  —  Nomba webhook signature key generator
//
// PASTE THIS ENTIRE FILE into the Nomba dashboard's
// "Webhook Signature Key" generator field.
//
// OR run it locally:
//   node nomba-setup.js --generate-key
//   node nomba-setup.js --verify payload.json <sig> <ts> [secret]
//   node nomba-setup.js --debug-hash payload.json [secret] [ts]
//
// Algorithm copied EXACTLY from Nomba's official docs:
//   Go / Python / Node.js / Java / C# / PHP samples all agree.

"use strict";

const crypto = require("crypto");
const fs = require("fs");

const DEMO_SECRET = process.env.NOMBA_WEBHOOK_SIG_KEY || "<REPLACE-WITH-YOUR-SECRET>";

// ── 1. Generate a strong random key (32 bytes = 64-char hex) ──────────────
function generateKey() {
  const key = crypto.randomBytes(32).toString("hex");
  console.log("\n✅  Generated a new Nomba webhook signature key:\n");
  console.log(`   ${key}\n`);
  console.log("   ⚠️   Paste this EXACT string into:");
  console.log("         Nomba dashboard → Developer → Webhook Setup → Signature Key");
  console.log("   ⚠️   Then copy the same string into your env var:");
  console.log("         NOMBA_WEBHOOK_SIG_KEY=<the-key-above>\n");
  return key;
}

// ── 2. Build the canonical hashing payload (EXACTLY as Nomba's docs) ─────
function buildHashingPayload(payload, timestamp) {
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

// ── 3. Compute the expected signature (HMAC-SHA256 → base64) ──────────────
function computeSignature(payload, secret, timestamp) {
  const hashingPayload = buildHashingPayload(payload, timestamp);
  console.log(`\n📝  Canonical hashing-payload string (exactly what is signed):`);
  console.log(`    "${hashingPayload}"\n`);

  const sig = crypto
    .createHmac("sha256", secret)
    .update(hashingPayload, "utf8")
    .digest("base64");

  console.log(`🔑  Computed signature (base64):  ${sig}\n`);
  return sig;
}

// ── 4. CLI main ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes("--generate-key") || args.includes("-g")) {
  generateKey();
  process.exit(0);
}

if (args.includes("--verify") || args.includes("-v")) {
  const idx = Math.max(args.indexOf("--verify"), args.indexOf("-v"));
  const payloadPath = args[idx + 1] || null;
  const expectedSig = args[idx + 2] || null;
  const timestamp = args[idx + 3] || null;
  const secret = args[idx + 4] || DEMO_SECRET;

  if (!payloadPath || !expectedSig || !timestamp) {
    console.error("\n❌  Usage: node nomba-setup.js --verify <payload.json> <nomba-signature> <nomba-timestamp> [secret]\n");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  const computed = computeSignature(payload, secret, timestamp);

  const match = computed.toLowerCase() === (expectedSig || "").toLowerCase();
  console.log(`📨  Header signature (received): ${expectedSig}`);
  console.log(`🧮  Computed signature (expected):  ${computed}`);
  console.log(`\n${match ? "✅  SIGNATURES MATCH — webhook is authentic" : "❌  SIGNATURES DO NOT MATCH — webhook is NOT authentic"}\n`);
  process.exit(match ? 0 : 1);
}

if (args.includes("--debug-hash") || args.includes("-d")) {
  const idx = Math.max(args.indexOf("--debug-hash"), args.indexOf("-d"));
  const payloadPath = args[idx + 1] || null;
  const secret = args[idx + 2] || DEMO_SECRET;
  const timestamp = args[idx + 3] || "<timestamp>";

  if (!payloadPath) {
    console.error("\n❌  Usage: node nomba-setup.js --debug-hash <payload.json> [secret] [timestamp]\n");
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  computeSignature(payload, secret, timestamp);
  process.exit(0);
}

// ── Default: print help ───────────────────────────────────────────────────────
console.log(`
Nomba Webhook Signature Tool
═════════════════════════════

  Generate a new webhook signature key:
    node nomba-setup.js --generate-key

  Verify a received webhook signature:
    node nomba-setup.js --verify payload.json <nomba-signature> <nomba-timestamp> [secret]

  Debug: print the canonical hashing-payload string:
    node nomba-setup.js --debug-hash payload.json [secret] [timestamp]

  Set env var NOMBA_WEBHOOK_SIG_KEY to override the default secret.
`);
