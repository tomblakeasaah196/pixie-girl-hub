/**
 * One-off backfill: recover Instagram DM history that never reached the
 * Hub — above all the replies staff sent from the INSTAGRAM APP, which
 * the webhook ingest used to drop (is_echo events were skipped), leaving
 * threads looking unanswered and operators without the conversation
 * trend.
 *
 * Reads each brand's recent conversations from the Graph conversations
 * API and pushes every message through the exact same ingest pipeline as
 * live webhooks (smartcomm.subscribers.ingestInbound):
 *
 *   - customer messages    → inbound bubbles (contact resolved/created)
 *   - business messages    → business-side bubbles tagged "via Instagram
 *                            app"; each one advances the thread's
 *                            external_read_at, so threads whose LAST word
 *                            was our reply drop their unread badge
 *   - messages are recorded at their ORIGINAL timestamp (thread reads in
 *     order) and QUIET (no realtime pings / bell notifications for old
 *     history)
 *
 * META LIMITATION you cannot script around: the conversations API only
 * returns full content for the ~20 MOST RECENT messages per conversation
 * — older messages come back truncated (id + timestamp only) and are
 * skipped. This recovers the recent trend of every thread, not years of
 * archive.
 *
 * Idempotent: dedup on the provider message id (external_ref), plus a
 * fuzzy same-thread/same-content/±2min guard in case Graph ever hands
 * back a different id family than the webhook did. Safe to re-run.
 *
 * READ-ONLY toward customers: it only *fetches* history — it never sends
 * a message.
 *
 * RUN (project root):
 *   node scripts/backfill-instagram-history.js
 *   BRAND=faitlynhair node scripts/backfill-instagram-history.js
 *   DAYS=90 CONV_LIMIT=500 node scripts/backfill-instagram-history.js
 *   DRY_RUN=1 node scripts/backfill-instagram-history.js   (report only)
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
const subscribers = require("../src/modules/smartcomm/smartcomm.subscribers");
const smartcommRepo = require("../src/modules/smartcomm/smartcomm.repo");

const GRAPH = `https://graph.instagram.com/${config.META_GRAPH_VERSION || "v21.0"}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphGet(url, access_token, params) {
  try {
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${access_token}` },
      params,
      timeout: 30000,
    });
    return data;
  } catch (err) {
    // Surface Meta's structured error (message + code/subcode) instead of
    // axios's opaque "Request failed with status code 403" — the code is
    // what tells a throttle (4/17/32/613/-1) apart from a real permission
    // problem, so a failed run is diagnosable from the log alone.
    const meta = err.response && err.response.data && err.response.data.error;
    const wrapped = new Error(
      meta
        ? `${meta.message}${meta.code ? ` (code ${meta.code}${meta.error_subcode ? `/${meta.error_subcode}` : ""})` : ""}`
        : err.message,
    );
    wrapped.status = err.response && err.response.status;
    wrapped.meta = meta || null;
    throw wrapped;
  }
}

// Meta throttles heavy endpoints (the per-conversation /messages read is
// the strict one) as HTTP 429, or 400/403 carrying an app/user/page
// rate-limit code. When we see it we back off and — if it persists — stop
// early, rather than burning the rest of the window on guaranteed 403s.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007, -1]);
function isRateLimited(err) {
  if (err && err.status === 429) return true;
  const code = err && err.meta && Number(err.meta.code);
  return RATE_LIMIT_CODES.has(code);
}

/**
 * Fetch a conversation's messages, retrying on throttle with exponential
 * backoff (2s, 4s, 8s). A non-rate-limit error, or exhausted retries,
 * rethrows to the caller.
 */
async function fetchMessagesWithBackoff({ conversation_id, access_token }, tries = 3) {
  let attempt = 0;
  for (;;) {
    try {
      return await listMessages({ conversation_id, access_token });
    } catch (err) {
      attempt += 1;
      if (!isRateLimited(err) || attempt >= tries) throw err;
      const wait = 2000 * 2 ** (attempt - 1);
      console.warn(
        `  ${conversation_id}: throttled, backing off ${wait / 1000}s (attempt ${attempt}/${tries})`,
      );
      await sleep(wait);
    }
  }
}

/**
 * Walk /me/conversations pages until the cutoff date or the row limit.
 * Returns [{ id, updated_time, participants }].
 */
async function listConversations({ access_token, cutoff, limit }) {
  const out = [];
  let url = `${GRAPH}/me/conversations`;
  let params = {
    platform: "instagram",
    fields: "id,updated_time,participants",
    limit: 25,
  };
  while (url && out.length < limit) {
    const page = await graphGet(url, access_token, params);
    for (const c of page.data || []) {
      if (new Date(c.updated_time) < cutoff) return out;
      out.push(c);
      if (out.length >= limit) return out;
    }
    url = page.paging && page.paging.next ? page.paging.next : null;
    params = undefined; // paging.next already carries the query string
  }
  return out;
}

/** Fetch the (up to 20) most recent fully-readable messages, oldest first. */
async function listMessages({ conversation_id, access_token }) {
  const data = await graphGet(
    `${GRAPH}/${conversation_id}/messages`,
    access_token,
    {
      fields:
        "id,created_time,from,message,attachments{image_data,video_data,file_url,mime_type,name}",
      limit: 20,
    },
  );
  return (data.data || []).reverse();
}

// Map a conversations-API attachment to the ingest media descriptor +
// inbox message_type. Mirrors the webhook parser's IG_MEDIA_TYPE rules.
function mapAttachment(att) {
  if (!att) return null;
  if (att.image_data && att.image_data.url) {
    return { kind: "image", url: att.image_data.url, message_type: "image" };
  }
  if (att.video_data && att.video_data.url) {
    return { kind: "video", url: att.video_data.url, message_type: "video" };
  }
  if (att.file_url) {
    const mime = String(att.mime_type || "");
    const isAudio = mime.startsWith("audio/");
    return {
      kind: isAudio ? "audio" : "file",
      url: att.file_url,
      message_type: isAudio ? "voice_note" : "document",
    };
  }
  return null;
}

/**
 * Already recorded? Provider-id match first (webhook mid == Graph message
 * id), then a fuzzy same-content/±2min guard on the thread so a
 * different id family can't double-record what the live ingest caught.
 */
async function alreadyRecorded({ brand, customer_igsid, m, body }) {
  const byRef = await query(
    `SELECT 1 FROM shared.messages
      WHERE external_ref = $1
         OR (metadata ? 'sequence_mids' AND metadata->'sequence_mids' @> to_jsonb($1::text))
      LIMIT 1`,
    [m.id],
  );
  if (byRef.rows.length) return true;
  const thread = await smartcommRepo.findCustomerThreadByExternalRef({
    brand,
    platform: "instagram",
    external_thread_ref: customer_igsid,
  });
  if (!thread) return false;
  const { rows } = await query(
    `SELECT 1 FROM shared.messages
      WHERE channel_id = $1
        AND created_at BETWEEN $2::timestamptz - interval '2 minutes'
                           AND $2::timestamptz + interval '2 minutes'
        AND (($3::text IS NOT NULL AND content = $3) OR ($3::text IS NULL AND content IS NULL))
      LIMIT 1`,
    [thread.channel_id, m.created_time, body || null],
  );
  return rows.length > 0;
}

(async () => {
  try {
    await initDatabase();
    const days = Number(process.env.DAYS) || 30;
    const convLimit = Number(process.env.CONV_LIMIT) || 200;
    const gapMs = Number(process.env.GAP_MS) || 600; // be gentle on Graph
    const dryRun = !!process.env.DRY_RUN;
    // After this many conversations throttled back-to-back, Meta's window
    // is spent — stop and let the operator resume later (idempotent), so a
    // rate-limited run doesn't spew a failure per remaining conversation.
    const rateLimitGiveUp = Number(process.env.RATE_LIMIT_GIVEUP) || 5;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

    const igAccounts = await maRepo.listActiveByPlatform({
      platform: "instagram",
    });
    let brands = igAccounts.map((a) => a.business);
    if (process.env.BRAND) {
      brands = brands.filter((b) => b === process.env.BRAND);
    }
    if (brands.length === 0) {
      console.error(
        "No active Instagram account matches — nothing to backfill.",
      );
      process.exitCode = 1;
      return;
    }

    const summary = {
      conversations: 0,
      recorded_inbound: 0,
      recorded_replies: 0,
      skipped_existing: 0,
      skipped_empty: 0,
      errors: 0,
      rate_limited: 0,
    };
    let aborted = false;

    for (const brand of brands) {
      if (aborted) break;
      const cfg = await maService.resolveInstagramSendConfig({ brand });
      const bizId = String(cfg.ig_business_account_id);
      console.warn(
        `\n${brand}: scanning conversations updated since ${cutoff.toISOString()}` +
          (dryRun ? " (DRY_RUN — no writes)" : ""),
      );

      const conversations = await listConversations({
        access_token: cfg.access_token,
        cutoff,
        limit: convLimit,
      });
      console.warn(`${brand}: ${conversations.length} conversation(s) in range.`);

      let consecutiveThrottled = 0;
      for (const conv of conversations) {
        summary.conversations += 1;
        let messages;
        try {
          messages = await fetchMessagesWithBackoff({
            conversation_id: conv.id,
            access_token: cfg.access_token,
          });
          consecutiveThrottled = 0;
        } catch (err) {
          summary.errors += 1;
          if (isRateLimited(err)) {
            summary.rate_limited += 1;
            consecutiveThrottled += 1;
            console.warn(`  ${conv.id}: throttled by Meta — ${err.message}`);
            if (consecutiveThrottled >= rateLimitGiveUp) {
              console.warn(
                `\n⚠️  Meta is rate-limiting the messages endpoint (${consecutiveThrottled} in a row).\n` +
                  "Stopping here to preserve the quota window. Everything recorded so far is saved.\n" +
                  "Wait ~1 hour, then run the SAME command again — it's idempotent, so already-synced\n" +
                  "messages are skipped and it picks up where this left off. (Running DRY_RUN first\n" +
                  "doubles the API calls — skip it when resuming.)",
              );
              aborted = true;
              break;
            }
          } else {
            console.warn(`  ${conv.id}: messages fetch failed — ${err.message}`);
          }
          await sleep(gapMs);
          continue;
        }

        const participants =
          (conv.participants && conv.participants.data) || [];
        const customer = participants.find((p) => String(p.id) !== bizId);
        const customerIgsid = customer && String(customer.id);
        if (!customerIgsid) {
          await sleep(gapMs);
          continue;
        }

        for (const m of messages) {
          const fromBiz = m.from && String(m.from.id) === bizId;
          const att = mapAttachment(
            m.attachments && m.attachments.data && m.attachments.data[0],
          );
          const body = m.message || "";
          // Truncated rows (older than the 20-message content window) and
          // genuinely empty bubbles have nothing to record.
          if (!body && !att) {
            summary.skipped_empty += 1;
            continue;
          }
          try {
            if (
              await alreadyRecorded({
                brand,
                customer_igsid: customerIgsid,
                m,
                body: body || null,
              })
            ) {
              summary.skipped_existing += 1;
              continue;
            }
            if (dryRun) {
              console.warn(
                `  ${customerIgsid} ${m.created_time} ${fromBiz ? "US →" : "→ US"} ` +
                  `${(body || `[${att.message_type}]`).slice(0, 60)}`,
              );
            } else {
              await subscribers.ingestInbound(
                {
                  platform: "instagram",
                  external_account_id: bizId,
                  external_ref: m.id,
                  external_thread_ref: customerIgsid,
                  sender: { external_user_id: customerIgsid, display_name: null },
                  body,
                  message_type: att ? att.message_type : "text",
                  media: att ? { kind: att.kind, url: att.url } : null,
                  is_echo: fromBiz,
                  occurred_at: m.created_time,
                  quiet: true,
                },
                brand,
              );
            }
            if (fromBiz) summary.recorded_replies += 1;
            else summary.recorded_inbound += 1;
          } catch (err) {
            summary.errors += 1;
            console.warn(
              `  ${conv.id} / ${m.id}: record failed — ${err.message}`,
            );
          }
        }
        await sleep(gapMs);
      }
    }

    console.warn(
      `\n${aborted ? "Stopped early (rate limited)." : "Done."} ` +
        `conversations=${summary.conversations} ` +
        `inbound_recovered=${summary.recorded_inbound} ` +
        `app_replies_recovered=${summary.recorded_replies} ` +
        `already_present=${summary.skipped_existing} ` +
        `empty_or_truncated=${summary.skipped_empty} ` +
        `errors=${summary.errors} (throttled=${summary.rate_limited})`,
    );
    if (process.env.DRY_RUN) {
      console.warn("DRY_RUN — nothing was written.");
    }
    if (aborted) {
      // Non-zero exit so a wrapper/cron knows to retry later.
      process.exitCode = 2;
    }
  } catch (err) {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
