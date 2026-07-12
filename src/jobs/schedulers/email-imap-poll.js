/**
 * Inbound email via IMAP polling.
 *
 * Two-way email without Cloudflare Email Routing: both brands host mail on
 * Hostinger, so instead of hijacking the domain MX we log into the SAME
 * mailbox we already send from (the 'email_outbound' messaging account with
 * inbound_poll_enabled = true) and thread new replies into the Smartcomm
 * inbox. Credentials are reused from the outbound SMTP config — nothing lives
 * in .env, nothing is duplicated.
 *
 * Non-destructive: messages are NOT marked seen or deleted. We track a per-
 * account UID cursor (imap_last_uid + imap_uidvalidity) so each reply is
 * ingested exactly once while staff can still read it in Hostinger webmail.
 *
 * First run (or after a UIDVALIDITY reset) baselines the cursor to the newest
 * message WITHOUT ingesting, so enabling the feature never dumps a mailbox's
 * whole history into the inbox — only replies that arrive afterwards flow in.
 *
 * Scheduled by src/jobs/worker.js. Idempotent + best-effort per account: one
 * mailbox failing (bad password, IMAP down) never blocks the others.
 */

"use strict";

const { logger } = require("../../config/logger");
const messagingAccounts = require("../../modules/messaging_accounts/messaging-accounts.service");
const smartcomm = require("../../modules/smartcomm/smartcomm.subscribers");

// Safety cap: never ingest more than this many messages from a single mailbox
// in one tick (guards against a misconfigured cursor flooding the inbox).
const MAX_PER_RUN = 200;

async function pollOneMailbox(cfg) {
  // Lazy-require so a box without imapflow installed only errors when polling
  // is actually enabled, not at boot.
  const { ImapFlow } = require("imapflow");
  const { simpleParser } = require("mailparser");

  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Hostinger is fine with a short socket timeout; keeps a stuck mailbox
    // from wedging the whole sweep.
    socketTimeout: 30000,
  });

  let ingested = 0;
  // imapflow requires an explicit connect before any mailbox operation —
  // getMailboxLock otherwise throws "Connection not available".
  await client.connect();
  const lock = await client.getMailboxLock("INBOX").catch((err) => {
    throw new Error(`INBOX open failed: ${err.message}`);
  });
  try {
    const mailbox = client.mailbox || {};
    const uidValidity = mailbox.uidValidity ? Number(mailbox.uidValidity) : null;
    const uidNext = mailbox.uidNext ? Number(mailbox.uidNext) : null;
    const newestUid = uidNext ? uidNext - 1 : 0;

    // Re-baseline (ingest nothing) on first enable or a UIDVALIDITY reset —
    // stored UIDs are no longer comparable, so trust would risk dup/miss.
    const validityChanged =
      cfg.uidvalidity != null && uidValidity != null &&
      cfg.uidvalidity !== uidValidity;
    if (!cfg.last_uid || validityChanged) {
      await messagingAccounts.updateImapCursor({
        id: cfg.account_id,
        last_uid: newestUid,
        uidvalidity: uidValidity,
      });
      logger.info(
        { business: cfg.business, mailbox: cfg.mailbox, baseline_uid: newestUid },
        "email-imap-poll: baselined cursor (no ingest on first run/validity reset)",
      );
      return 0;
    }

    const sinceUid = cfg.last_uid;
    if (newestUid <= sinceUid) return 0; // nothing new

    let maxUid = sinceUid;
    // UID range "N:*" returns messages with uid >= N (the server clamps a
    // too-high N to the last message, so we still guard uid > sinceUid).
    for await (const msg of client.fetch(
      `${sinceUid + 1}:*`,
      { source: true, uid: true },
      { uid: true },
    )) {
      if (!msg.uid || msg.uid <= sinceUid) continue;
      maxUid = Math.max(maxUid, msg.uid);
      if (ingested >= MAX_PER_RUN) {
        logger.warn(
          { business: cfg.business, cap: MAX_PER_RUN },
          "email-imap-poll: hit per-run cap — remaining messages next tick",
        );
        break;
      }
      try {
        const parsed = await simpleParser(msg.source);
        const fromAddr =
          parsed.from && parsed.from.value && parsed.from.value[0];
        const references = Array.isArray(parsed.references)
          ? parsed.references[0]
          : parsed.references || null;
        const message = {
          // Use the configured brand mailbox, not the envelope To (which may
          // be an alias/forward) — this is what routes the thread to a brand.
          to: cfg.mailbox,
          from: {
            email: (fromAddr && fromAddr.address) || "",
            name: (fromAddr && fromAddr.name) || null,
          },
          subject: parsed.subject || "",
          text: parsed.text || "",
          html: parsed.html || "",
          // Dedup key. Fall back to a stable synthetic id so a message with no
          // Message-ID header still can't be ingested twice.
          message_id:
            parsed.messageId || `imap-${cfg.account_id}-${msg.uid}`,
          in_reply_to: parsed.inReplyTo || null,
          thread_id: references,
        };
        if (!message.from.email) continue; // can't attribute — skip
        await smartcomm.ingestInboundEmail({ brand: cfg.business, message });
        ingested += 1;
      } catch (err) {
        logger.error(
          { business: cfg.business, uid: msg.uid, err: err.message },
          "email-imap-poll: failed to ingest one message — continuing",
        );
      }
    }

    await messagingAccounts.updateImapCursor({
      id: cfg.account_id,
      last_uid: maxUid,
      uidvalidity: uidValidity,
    });
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return ingested;
}

/**
 * Poll every brand mailbox with inbound IMAP enabled. Best-effort per
 * account; returns a summary for the scheduler log.
 */
async function runInboundEmailPoll() {
  let configs;
  try {
    configs = await messagingAccounts.listInboundImapConfigs();
  } catch (err) {
    logger.error({ err: err.message }, "email-imap-poll: config lookup failed");
    return { mailboxes: 0, ingested: 0, failed: 0 };
  }
  const summary = { mailboxes: configs.length, ingested: 0, failed: 0 };
  for (const cfg of configs) {
    try {
      summary.ingested += await pollOneMailbox(cfg);
    } catch (err) {
      summary.failed += 1;
      logger.error(
        { business: cfg.business, mailbox: cfg.mailbox, err: err.message },
        "email-imap-poll: mailbox poll failed",
      );
    }
  }
  if (summary.mailboxes) {
    logger.info(summary, "email-imap-poll: sweep complete");
  }
  return summary;
}

module.exports = { runInboundEmailPoll };
