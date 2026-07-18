#!/usr/bin/env node
/**
 * Instagram echo-sync diagnosis: is it Meta or is it us?
 *
 * "A staffer replies from the Instagram app and the reply never appears
 * in the Hub" has exactly one healthy path:
 *
 *   Meta delivers a message_echoes webhook  →  shared.webhook_log row
 *   →  outbox → smartcomm ingest            →  shared.messages row
 *      (metadata.via = 'instagram_app')     →  visible in the thread
 *
 * This script checks every hop against the live DB + Meta Graph API and
 * prints a single VERDICT naming the broken hop:
 *
 *   • subscription missing on the account  → META SIDE (fixable now)
 *   • subscribed but no echo ever arrives  → META SIDE (delivery)
 *   • echoes arrive but aren't recorded    → OUR SIDE (shows the error)
 *   • echoes arrive and are recorded       → HEALTHY
 *
 * READ-ONLY by default (safe against prod). `--fix` additionally
 * re-subscribes any missing webhook fields (same self-heal the hourly
 * ig-echo-watchdog runs).
 *
 * RUN (project root, needs .env with DB + ENCRYPTION key):
 *   npm run diag:instagram-echoes
 *   npm run diag:instagram-echoes -- --fix
 *   DAYS=30 npm run diag:instagram-echoes
 */

"use strict";

const axios = require("axios");
const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { config } = require("../src/config/env");
const maRepo = require("../src/modules/messaging_accounts/messaging-accounts.repo");
const maService = require("../src/modules/messaging_accounts/messaging-accounts.service");
const encryption = require("../src/services/encryption.service");

const DAYS = Math.max(1, Number(process.env.DAYS || 14));
const FIX = process.argv.includes("--fix");
const GRAPH = `https://graph.instagram.com/${config.META_GRAPH_VERSION || "v21.0"}`;

/* eslint-disable no-console */
const line = (s = "") => console.log(s);
const h = (s) => line(`\n═══ ${s} ${"═".repeat(Math.max(1, 60 - s.length))}`);

function fmt(ts) {
  return ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 19) : "—";
}

async function graphGet(path, token, params) {
  const { data } = await axios.get(`${GRAPH}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
    timeout: 20000,
  });
  return data;
}

function metaMsg(err) {
  const e = err.response && err.response.data && err.response.data.error;
  return e && e.message
    ? `${e.message}${e.code ? ` (code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ""})` : ""}`
    : err.message;
}

async function checkAccounts() {
  h("1. INSTAGRAM ACCOUNTS + META SUBSCRIPTION STATE");
  const rows = await maRepo.listActiveByPlatform({ platform: "instagram" });
  if (!rows.length) {
    line("  ✗ No ACTIVE Instagram account rows in shared.messaging_accounts.");
    line("    Nothing can arrive without one — connect Instagram in Messaging → Settings.");
    return { accounts: [], missingAnywhere: true };
  }
  const accounts = [];
  for (const row of rows) {
    const acc = {
      business: row.business,
      account_id: row.account_id,
      stored_id: row.external_account_id,
      token_ok: false,
      username: null,
      provider_id: null,
      id_mismatch: false,
      fields: null,
      missing: null,
      error: null,
    };
    accounts.push(acc);
    line(`\n  ${row.business} — messaging_accounts.external_account_id = ${row.external_account_id}`);
    if (!row.access_token_enc) {
      acc.error = "no access token stored";
      line("    ✗ No access token on file — paste one in Messaging → Settings.");
      continue;
    }
    let token;
    try {
      token = encryption.decrypt(row.access_token_enc);
    } catch (err) {
      acc.error = `token decrypt failed: ${err.message}`;
      line(`    ✗ ${acc.error} (encryption key rotated?)`);
      continue;
    }
    try {
      const me = await graphGet("me", token, { fields: "user_id,username" });
      acc.token_ok = true;
      acc.username = me.username || null;
      acc.provider_id = String(me.user_id || me.id || "");
      line(`    ✓ Token valid — @${acc.username} (provider id ${acc.provider_id})`);
      if (acc.provider_id && acc.provider_id !== String(row.external_account_id)) {
        acc.id_mismatch = true;
        line(
          `    ⚠ Stored id ≠ provider id (${row.external_account_id} vs ${acc.provider_id}).` +
            " Webhooks route by entry.id — run Test on this connection to auto-heal the stored id.",
        );
      }
    } catch (err) {
      acc.error = `token ping failed: ${metaMsg(err)}`;
      line(`    ✗ ${acc.error}`);
      continue;
    }
    try {
      const sub = await maService.getInstagramSubscribedFields({
        access_token: token,
      });
      acc.fields = [...sub.fields];
      acc.missing = maService.REQUIRED_IG_WEBHOOK_FIELDS.filter(
        (f) => !sub.fields.has(f),
      );
      line(`    Subscribed webhook fields: ${acc.fields.length ? acc.fields.join(", ") : "(none!)"}`);
      if (acc.missing.length) {
        line(`    ✗ MISSING: ${acc.missing.join(", ")}  ← app-sent replies CANNOT sync without message_echoes`);
      } else {
        line("    ✓ All required fields subscribed (messages, message_echoes, message_reactions, messaging_seen)");
      }
    } catch (err) {
      acc.error = `subscribed_apps read failed: ${metaMsg(err)}`;
      line(`    ✗ ${acc.error}`);
    }
  }
  return {
    accounts,
    missingAnywhere: accounts.some(
      (a) => (a.missing && a.missing.length) || a.error,
    ),
  };
}

async function checkWebhookEvidence() {
  h(`2. WEBHOOK EVIDENCE (shared.webhook_log, last ${DAYS} days)`);
  const { rows: totals } = await query(
    `SELECT count(*)::int                                            AS total,
            count(*) FILTER (WHERE signature_valid = false)::int     AS bad_sig,
            count(*) FILTER (WHERE payload::text LIKE '%"is_echo"%')::int AS echoes,
            max(received_at) FILTER (WHERE payload::text LIKE '%"is_echo"%')          AS last_echo,
            max(received_at) FILTER (WHERE payload::text NOT LIKE '%"is_echo"%')      AS last_customer
       FROM shared.webhook_log
      WHERE source = 'meta_instagram'
        AND received_at > now() - ($1 || ' days')::interval`,
    [String(DAYS)],
  );
  const t = totals[0];
  line(`  Instagram webhooks received:        ${t.total}`);
  line(`  … carrying is_echo (app replies):   ${t.echoes}   (last: ${fmt(t.last_echo)})`);
  line(`  … customer-side (no echo):          latest ${fmt(t.last_customer)}`);
  line(`  … REJECTED (invalid signature):     ${t.bad_sig}`);
  if (t.total > 0 && t.echoes === 0) {
    line("  ✗ Customer messages arrive but NOT ONE echo did — Meta is not sending them.");
  }
  return t;
}

async function checkIngestHealth() {
  h(`3. INGEST HEALTH (did what arrived get recorded?)`);
  const { rows: recorded } = await query(
    `SELECT count(*)::int AS n, max(created_at) AS latest
       FROM shared.messages
      WHERE metadata->>'via' = 'instagram_app'
        AND created_at > now() - ($1 || ' days')::interval`,
    [String(DAYS)],
  );
  line(
    `  App-reply bubbles recorded (via=instagram_app): ${recorded[0].n}   (latest: ${fmt(recorded[0].latest)})`,
  );
  const { rows: stuck } = await query(
    `SELECT webhook_id, received_at, retry_count, error_message
       FROM shared.webhook_log
      WHERE source = 'meta_instagram'
        AND signature_valid = true
        AND processed = false
        AND received_at > now() - ($1 || ' days')::interval
      ORDER BY received_at DESC
      LIMIT 5`,
    [String(DAYS)],
  );
  if (stuck.length) {
    line(`  ✗ ${stuck.length}+ verified Instagram webhooks NOT fully ingested (newest first):`);
    for (const s of stuck) {
      line(`     ${fmt(s.received_at)}  retries=${s.retry_count}  ${s.error_message || "(pending)"}`);
    }
    line("     The 30-min replay sweep re-drives these automatically now; the error text names the bug if they stay stuck.");
  } else {
    line("  ✓ No verified-but-unprocessed Instagram webhooks.");
  }
  const { rows: outbox } = await query(
    `SELECT status, count(*)::int AS n, max(last_error) AS sample_error
       FROM shared.event_outbox
      WHERE event_type = 'webhook.received'
        AND payload->>'source' = 'meta_instagram'
        AND status IN ('pending','failed')
        AND created_at > now() - ($1 || ' days')::interval
      GROUP BY status`,
    [String(DAYS)],
  );
  if (outbox.length) {
    for (const o of outbox) {
      line(`  ⚠ Outbox '${o.status}' rows for Instagram webhooks: ${o.n} — last error: ${o.sample_error || "—"}`);
    }
  } else {
    line("  ✓ No pending/failed outbox rows for Instagram webhooks.");
  }
  return { recorded: recorded[0], stuck, outbox };
}

function verdict({ meta, evidence, ingest }) {
  h("VERDICT");
  const missingAccounts = meta.accounts.filter(
    (a) => a.missing && a.missing.length,
  );
  const brokenAccounts = meta.accounts.filter((a) => a.error);
  if (missingAccounts.length) {
    for (const a of missingAccounts) {
      line(`  ► META SIDE (config, fixable now): ${a.business} is not subscribed to [${a.missing.join(", ")}].`);
    }
    line("");
    line("    This is exactly why app-sent replies don't appear. Fix it with:");
    line("      npm run diag:instagram-echoes -- --fix");
    line("    …or wait for the hourly ig-echo-watchdog, which now re-subscribes automatically.");
    line("    Then reply to any customer from the Instagram app and watch it appear in the Hub.");
    return 1;
  }
  if (brokenAccounts.length) {
    line("  ► BLOCKED: fix the account errors in section 1 first (token/decrypt), then re-run.");
    return 1;
  }
  const echoesArrived = Number(evidence.echoes) > 0;
  const echoesRecorded = Number(ingest.recorded.n) > 0;
  if (echoesArrived && (ingest.stuck.length || !echoesRecorded)) {
    line("  ► OUR SIDE: echo webhooks ARRIVE but aren't all recorded — the error text in");
    line("    section 3 names the failing step. The replay sweep will keep re-driving them;");
    line("    if the same error repeats, that error IS the bug to fix.");
    return 1;
  }
  if (echoesArrived && echoesRecorded) {
    line("  ► HEALTHY: echoes arrive and are recorded as 'via Instagram app' bubbles.");
    line("    If old conversations still look unanswered, that's missing HISTORY from when");
    line("    the sync was down — recover it with: npm run backfill:instagram-history");
    return 0;
  }
  // Subscribed correctly, nothing arriving.
  line(`  ► META SIDE (delivery): the subscription is correct but no echo webhook arrived in ${DAYS} days.`);
  line("    Prove it live: reply to any customer from the Instagram app NOW, wait 60s, re-run this.");
  line("    If still nothing lands in shared.webhook_log, our server was never called — check in the");
  line("    Meta App Dashboard (developers.facebook.com → your app):");
  line("      • Webhooks → Instagram: 'message_echoes' must be subscribed for the APP too");
  line("      • the app must be LIVE (not Development mode)");
  line("      • instagram_business_manage_messages permission granted (Advanced Access)");
  line("    None of that is fixable from our code — it's Meta configuration.");
  return 1;
}

async function main() {
  line(`Instagram echo-sync diagnosis — ${new Date().toISOString()}  (window: ${DAYS} days${FIX ? ", --fix" : ", read-only"})`);
  await initDatabase();
  try {
    let meta = await checkAccounts();
    if (FIX) {
      h("APPLYING --fix (re-subscribe missing webhook fields)");
      const summary = await maService.ensureInstagramEchoSubscriptions();
      line(`  checked=${summary.checked} ok=${summary.ok} healed=${summary.healed} failed=${summary.failed}`);
      if (summary.healed) {
        line("  ✓ Re-subscribed. Reply to a customer from the Instagram app to confirm it syncs.");
      }
      // Re-read the live state so the verdict below reflects the repair,
      // not the drifted list captured before it.
      meta = await checkAccounts();
    }
    const evidence = await checkWebhookEvidence();
    const ingest = await checkIngestHealth();
    const code = verdict({ meta, evidence, ingest });
    line("");
    process.exitCode = code;
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  console.error("diagnosis crashed:", err);
  process.exit(2);
});
