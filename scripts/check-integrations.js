#!/usr/bin/env node
"use strict";

/**
 * Integration readiness report (4.1). Prints which external integrations are
 * CONFIGURED for this environment so you can validate staging/prod credentials
 * at a glance. Read-only and SAFE: it checks env presence + local files only —
 * NO network calls (never triggers a live charge / message / fetch).
 *
 *   node scripts/check-integrations.js        (or: npm run check:integrations)
 *
 * Payment gateways (Paystack/Opay/Nomba/Stripe) are configured PER-BUSINESS in
 * the database (shared.payment_gateways via Business Setup), not env — verify
 * those in the app. Everything else is env-driven and listed below.
 */

require("dotenv").config();
const fs = require("fs");

const env = process.env;
const has = (...keys) => keys.every((k) => env[k] && String(env[k]).trim());
const enumSet = (k) => env[k] && env[k] !== "none";

const PASS = "✓";
const NO = "○";
const WARN = "⚠";

const line = (sym, name, detail) =>
  // eslint-disable-next-line no-console
  console.log(`  ${sym} ${name}${detail ? ` — ${detail}` : ""}`);

const checks = [
  ["Email (SMTP)", () =>
    has("SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD")
      ? [PASS, env.SMTP_HOST]
      : [NO, "set SMTP_HOST / SMTP_USER / SMTP_PASSWORD"]],
  ["WhatsApp (Meta Cloud)", () =>
    has("META_WA_TOKEN", "META_WA_PHONE_ID")
      ? [PASS, `phone ${env.META_WA_PHONE_ID}`]
      : [NO, "set META_WA_TOKEN + META_WA_PHONE_ID"]],
  ["Instagram / FB (Meta Graph)", () =>
    has("META_IG_ACCESS_TOKEN") || has("META_FB_PAGE_TOKEN")
      ? [PASS, ""]
      : [NO, "set META_IG_ACCESS_TOKEN / META_FB_PAGE_TOKEN"]],
  ["SMS (Twilio)", () =>
    has("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM")
      ? [PASS, ""]
      : [NO, "optional — set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM"]],
  ["GeoIP → currency (maxmind)", () => {
    const p = env.MAXMIND_DB_PATH || "./data/GeoLite2-Country.mmdb";
    return fs.existsSync(p)
      ? [PASS, p]
      : [WARN, `DB file missing at ${p} — IP→currency falls back to default`];
  }],
  ["FX rate refresh", () =>
    enumSet("FX_PROVIDER") && has("FX_API_KEY")
      ? [PASS, env.FX_PROVIDER]
      : [NO, "set FX_PROVIDER + FX_API_KEY (the refresh cron no-ops otherwise)"]],
  ["Embeddings / RAG", () =>
    enumSet("EMBEDDINGS_PROVIDER") && has("EMBEDDINGS_API_KEY")
      ? [PASS, env.EMBEDDINGS_PROVIDER]
      : [NO, "set EMBEDDINGS_PROVIDER + EMBEDDINGS_API_KEY (Praxis RAG is inert otherwise)"]],
  ["Voice transcription (Whisper)", () =>
    enumSet("TRANSCRIPTION_PROVIDER") && has("TRANSCRIPTION_API_KEY")
      ? [PASS, env.TRANSCRIPTION_PROVIDER]
      : [NO, "optional — set TRANSCRIPTION_PROVIDER + TRANSCRIPTION_API_KEY"]],
  ["Praxis LLM orchestrator", () => {
    const on = ["true", "1"].includes(String(env.PRAXIS_ORCHESTRATOR_ENABLED || "").toLowerCase());
    return on
      ? [PASS, `enabled; vendor '${env.PRAXIS_LLM_VENDOR || "deepseek"}' creds live in AI Control (DB)`]
      : [NO, "PRAXIS_ORCHESTRATOR_ENABLED=false → graceful stub"];
  }],
  ["PDF rendering (Puppeteer)", () => {
    if (String(env.PDF_ENABLED ?? "true").toLowerCase() === "false")
      return [NO, "PDF_ENABLED=false"];
    try {
      require.resolve("puppeteer");
      return [PASS, "puppeteer installed" + (env.PUPPETEER_EXECUTABLE_PATH ? ` (exec ${env.PUPPETEER_EXECUTABLE_PATH})` : "")];
    } catch {
      return [WARN, "PDF_ENABLED but puppeteer not installed — run npm install"];
    }
  }],
  ["Logistics couriers", () =>
    has("CHOWDECK_API_KEY") || has("GIGL_API_KEY")
      ? [PASS, [has("CHOWDECK_API_KEY") && "Chowdeck", has("GIGL_API_KEY") && "GIGL"].filter(Boolean).join(", ")]
      : [NO, "set CHOWDECK_API_KEY / GIGL_API_KEY"]],
  ["Error monitoring (Sentry)", () =>
    has("SENTRY_DSN") ? [PASS, ""] : [NO, "optional — set SENTRY_DSN"]],
];

// eslint-disable-next-line no-console
console.log("\nPixie Girl Hub — integration readiness\n");
let ready = 0;
for (const [name, fn] of checks) {
  const [sym, detail] = fn();
  if (sym === PASS) ready += 1;
  line(sym, name, detail);
}
// eslint-disable-next-line no-console
console.log(
  "\nPayments (Paystack/Opay/Nomba/Stripe): configured PER-BUSINESS in the DB " +
    "(shared.payment_gateways via Business Setup) — verify in the app, not here.",
);
// eslint-disable-next-line no-console
console.log(`\n${ready}/${checks.length} env-driven integrations configured.\n`);
