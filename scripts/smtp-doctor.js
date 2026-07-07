#!/usr/bin/env node
"use strict";

/**
 * SMTP doctor — the live "does our mail actually go out?" check.
 *
 * Unlike scripts/check-integrations.js (env presence only, no network), this
 * script actually TALKS to the configured relay and, on request, sends a real
 * message. Run it on the box that holds the live .env (or anywhere the same
 * SMTP_* vars are set):
 *
 *   node scripts/smtp-doctor.js                       # inspect + connect, no send
 *   node scripts/smtp-doctor.js --to you@gmail.com    # + send a real test email
 *   node scripts/smtp-doctor.js --domains a.com,b.com # DNS-check these domains
 *   npm run smtp:doctor -- --to you@gmail.com
 *
 * What it reports:
 *   1. The resolved SMTP config (password redacted).
 *   2. Config-shape red flags (localhost / port 25 / missing auth).
 *   3. DNS for each sending domain — MX, SPF, DMARC (the records that decide
 *      whether Gmail/Yahoo trust your mail or bin it).
 *   4. A live connect + auth via nodemailer verify() — the real error if any.
 *   5. (with --to) an actual send, and the provider messageId.
 *
 * Standalone: reads process.env directly and only needs `nodemailer` + `dotenv`
 * + `pg` (all already dependencies), so it runs even on a minimal shell.
 * Read-only except for the optional --to send. Never sends without --to.
 */

/* eslint-disable no-console -- this is a CLI diagnostic; its output IS the point */

// dotenv is optional — if the SMTP_* vars are already exported, we don't need
// it. Only nodemailer is essential (a production dependency, always installed
// where the app runs).
try {
  require("dotenv").config();
} catch {
  /* running with env already in the shell — fine */
}
const dns = require("dns").promises;
const nodemailer = require("nodemailer");

const PASS = "✓"; // ✓
const FAIL = "✗"; // ✗
const WARN = "⚠"; // ⚠
const INFO = "•"; // •

// ── args ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}
const TO = argVal("--to");
const EXTRA_DOMAINS = (argVal("--domains") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function h(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}
function line(sym, text) {
  console.log(`  ${sym} ${text}`);
}

// ── config ────────────────────────────────────────────────
const HOST = (process.env.SMTP_HOST || "").trim();
const PORT = Number(process.env.SMTP_PORT || 587);
const USER = process.env.SMTP_USER || "";
const PASS_ = process.env.SMTP_PASSWORD || "";
const FROM_EMAIL = process.env.SMTP_FROM_EMAIL || "";
const FROM_NAME = process.env.SMTP_FROM_NAME || "Pixie Girl Hub";
const SMTP_SECURE_ENV = /^(true|1|yes|on)$/i.test(
  String(process.env.SMTP_SECURE || "").trim(),
);
const isLocal = /^(localhost|127\.0\.0\.1|::1)$/i.test(HOST);
const secure = SMTP_SECURE_ENV || PORT === 465;

function redact(s) {
  if (!s) return "(blank)";
  if (s.length <= 2) return "*".repeat(s.length);
  return `${s[0]}${"*".repeat(Math.max(3, s.length - 2))}${s[s.length - 1]}`;
}

function transportOptions() {
  const opts = {
    host: HOST,
    port: PORT,
    secure,
    auth: USER ? { user: USER, pass: PASS_ } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  };
  if (isLocal) opts.ignoreTLS = true;
  else if (!secure) opts.requireTLS = true;
  return opts;
}

// ── 1. resolved config ────────────────────────────────────
function reportConfig() {
  h("1. Resolved SMTP config");
  line(INFO, `SMTP_HOST      = ${HOST || "(blank)"}`);
  line(INFO, `SMTP_PORT      = ${PORT}`);
  line(INFO, `SMTP_SECURE    = ${secure} (implicit TLS)`);
  line(INFO, `SMTP_USER      = ${USER || "(blank)"}`);
  line(INFO, `SMTP_PASSWORD  = ${redact(PASS_)}`);
  line(INFO, `SMTP_FROM_EMAIL= ${FROM_EMAIL || "(blank)"}`);
  line(INFO, `SMTP_FROM_NAME = ${FROM_NAME}`);
  line(
    INFO,
    `TLS mode       = ${
      isLocal
        ? "plaintext (loopback dev relay)"
        : secure
          ? "implicit TLS (465)"
          : "STARTTLS required (587)"
    }`,
  );
}

// ── 2. config-shape findings ──────────────────────────────
function reportShape() {
  h("2. Config sanity");
  const problems = [];
  if (!HOST) problems.push("SMTP_HOST is blank — every send fails.");
  else if (isLocal)
    problems.push(
      "SMTP_HOST is loopback — hands mail to a LOCAL server. It only leaves " +
        "the box if a local MTA (postfix/sendmail) is running AND can relay " +
        "onward. 'sent' then means 'the local MTA accepted it', NOT 'the " +
        "customer received it'. Prefer a real authenticated relay.",
    );
  if (PORT === 25)
    problems.push(
      "SMTP_PORT is 25 — blocked outbound on most clouds; unauthenticated :25 " +
        "mail is widely rejected/spam-filed.",
    );
  if (!isLocal && !USER)
    problems.push("No SMTP_USER — a public relay rejects unauthenticated mail.");
  if (problems.length === 0) line(PASS, "No obvious config red flags.");
  else problems.forEach((p) => line(WARN, p));
}

// ── 3. DNS for sending domains ────────────────────────────
async function domainsToCheck() {
  const set = new Set(EXTRA_DOMAINS);
  if (FROM_EMAIL && FROM_EMAIL.includes("@"))
    set.add(FROM_EMAIL.split("@")[1].toLowerCase());
  // Best-effort: pull the per-brand from/support addresses out of the DB so we
  // check the domains that actually appear in customer mail. Silent if no DB.
  try {
    const { Client } = require("pg");
    const c = new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl:
        /^(true|1|yes|on)$/i.test(String(process.env.DB_SSL || ""))
          ? { rejectUnauthorized: false }
          : undefined,
      connectionTimeoutMillis: 4000,
    });
    await c.connect();
    const { rows } = await c.query(
      `SELECT email_from_address, support_email FROM shared.business_config`,
    );
    await c.end();
    for (const r of rows)
      for (const addr of [r.email_from_address, r.support_email])
        if (addr && addr.includes("@")) set.add(addr.split("@")[1].toLowerCase());
  } catch {
    /* no DB reachable from here — that's fine, DNS still runs on --domains/FROM */
  }
  return [...set];
}

async function reportDns() {
  h("3. Sending-domain DNS (deliverability)");
  const domains = await domainsToCheck();
  if (domains.length === 0) {
    line(
      WARN,
      "No sending domain resolved — set SMTP_FROM_EMAIL or pass --domains.",
    );
    return;
  }
  for (const d of domains) {
    console.log(`\n  Domain: ${d}`);
    // MX
    try {
      const mx = await dns.resolveMx(d);
      if (mx.length)
        line(
          PASS,
          `MX   → ${mx
            .sort((a, b) => a.priority - b.priority)
            .map((m) => m.exchange)
            .join(", ")}`,
        );
      else line(WARN, "MX   → none (domain can't receive replies/bounces)");
    } catch {
      line(WARN, "MX   → none found");
    }
    // SPF + DMARC via TXT
    let txt = [];
    try {
      txt = (await dns.resolveTxt(d)).map((chunks) => chunks.join(""));
    } catch {
      /* no TXT */
    }
    const spf = txt.find((t) => /^v=spf1/i.test(t));
    if (spf) line(PASS, `SPF  → ${spf}`);
    else
      line(
        FAIL,
        "SPF  → missing. Without SPF, mail from your relay is untrusted → spam/reject.",
      );
    let dmarc = [];
    try {
      dmarc = (await dns.resolveTxt(`_dmarc.${d}`)).map((c) => c.join(""));
    } catch {
      /* none */
    }
    const dm = dmarc.find((t) => /^v=DMARC1/i.test(t));
    if (dm) line(PASS, `DMARC→ ${dm}`);
    else line(WARN, "DMARC→ missing (recommended once SPF/DKIM are in place).");
    line(
      INFO,
      "DKIM → selector-specific; verify in your relay/DNS provider (e.g. " +
        `default._domainkey.${d}).`,
    );
  }
}

// ── 4. live connect ───────────────────────────────────────
async function reportVerify(transporter) {
  h("4. Live connection (SMTP verify)");
  if (!HOST) {
    line(FAIL, "No SMTP_HOST — skipping connect.");
    return false;
  }
  try {
    await transporter.verify();
    line(PASS, `Connected + ready at ${HOST}:${PORT}${USER ? " (authenticated)" : ""}.`);
    return true;
  } catch (err) {
    line(FAIL, `Connect failed: ${err.message}${err.code ? ` [${err.code}]` : ""}`);
    if (err.code === "ECONNREFUSED")
      line(
        INFO,
        "Nothing is listening there. On the app host that means no local MTA " +
          "and no relay — every email is failing. Point SMTP_* at a real relay.",
      );
    if (/EAUTH|535|534/.test(String(err.message)))
      line(INFO, "Auth rejected — check SMTP_USER / SMTP_PASSWORD (or app password).");
    if (/self.signed|certificate/i.test(String(err.message)))
      line(INFO, "TLS cert issue — confirm host/port and SMTP_SECURE.");
    return false;
  }
}

// ── 5. real send ──────────────────────────────────────────
async function reportSend(transporter) {
  h("5. Test send");
  if (!TO) {
    line(INFO, "Skipped. Re-run with --to you@example.com to send a real email.");
    return;
  }
  const from = FROM_EMAIL
    ? `${FROM_NAME} <${FROM_EMAIL}>`
    : "Pixie Girl Hub <noreply@pixiegirlglobal.com>";
  try {
    const info = await transporter.sendMail({
      to: TO,
      from,
      subject: "Pixie Girl Hub — SMTP doctor test ✅",
      text:
        "If you can read this, the SMTP relay accepted and delivered a message.\n" +
        "Check whether it landed in Inbox or Spam — Spam means SPF/DKIM/DMARC " +
        "still need attention.",
      html:
        "<p>If you can read this, the SMTP relay accepted and delivered a message.</p>" +
        "<p><b>Check Inbox vs Spam.</b> Spam means SPF/DKIM/DMARC still need attention.</p>",
    });
    line(PASS, `Accepted for delivery. messageId=${info.messageId}`);
    if (info.accepted?.length) line(INFO, `accepted: ${info.accepted.join(", ")}`);
    if (info.rejected?.length) line(WARN, `rejected: ${info.rejected.join(", ")}`);
    line(
      INFO,
      "Now go check that mailbox (INBOX and SPAM). 'Accepted' only means the " +
        "relay took it — the inbox test is the real proof.",
    );
  } catch (err) {
    line(FAIL, `Send failed: ${err.message}${err.code ? ` [${err.code}]` : ""}`);
  }
}

(async () => {
  console.log("\nPixie Girl Hub — SMTP doctor");
  reportConfig();
  reportShape();
  await reportDns();
  const transporter = nodemailer.createTransport(transportOptions());
  const connected = await reportVerify(transporter);
  if (connected || TO) await reportSend(transporter);
  h("Summary");
  line(
    INFO,
    "A green connection is necessary but NOT sufficient — deliverability to " +
      "real inboxes depends on SPF/DKIM/DMARC above. The --to inbox test is the " +
      "only real proof mail reaches customers.",
  );
  console.log("");
  process.exit(0);
})().catch((err) => {
  console.error("smtp-doctor crashed:", err);
  process.exit(1);
});
