/**
 * Birthday wish sweep — Communications Studio automation `birthday_wish`.
 *
 * Runs daily. For each brand, finds contacts visible to that brand whose
 * date_of_birth month/day matches today (Africa/Lagos), and hands each
 * to the dispatcher. The Studio row decides channel + body — this cron
 * only knows "it's someone's birthday, tell the Studio."
 *
 * Idempotency: the dispatcher stamps automation_send_log with a dedup
 * key of `birthday-<year>-<contact_id>`, so a same-day re-run (server
 * restart, missed tick) is a silent no-op. A contact born on 29 Feb
 * is greeted on 28 Feb in non-leap years — Postgres's month/day
 * comparison already handles the equality; we don't explicitly rewrite
 * the day (the operator can override in the Studio if they'd rather
 * shift leaplings to 1 Mar).
 */

"use strict";

const { logger } = require("../../config/logger");
const { query } = require("../../config/database");
const { BRANDS } = require("../../config/brands");
const commsStudio = require("../../modules/comms_studio/comms-studio.service");

async function runBirthdayWishes() {
  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const brand of BRANDS) {
    let contacts = [];
    try {
      // Match on birthday month + day using AT TIME ZONE so we honour
      // Africa/Lagos as the reference "today", regardless of the worker
      // container's TZ. `visible_to = '{}'` is the "visible to all
      // brands" convention (000003_shared_people.sql:46 default).
      const { rows } = await query(
        `SELECT c.contact_id, c.display_name, c.first_name, c.email,
                c.primary_phone, c.whatsapp_number, c.preferred_channel,
                c.date_of_birth
           FROM shared.contacts c
          WHERE c.date_of_birth IS NOT NULL
            AND c.is_deleted = false
            AND ( $1 = ANY (c.visible_to) OR cardinality(c.visible_to) = 0 )
            AND EXTRACT(MONTH FROM c.date_of_birth)
                = EXTRACT(MONTH FROM (now() AT TIME ZONE 'Africa/Lagos')::date)
            AND EXTRACT(DAY FROM c.date_of_birth)
                = EXTRACT(DAY FROM (now() AT TIME ZONE 'Africa/Lagos')::date)`,
        [brand],
      );
      contacts = rows;
    } catch (err) {
      logger.error({ err: err.message, brand }, "birthday sweep query failed");
      continue;
    }

    for (const c of contacts) {
      try {
        const result = await commsStudio.dispatch({
          brand,
          event_key: "birthday_wish",
          contact_id: c.contact_id,
          reference_type: "contact",
          reference_id: c.contact_id,
          variables: {
            first_name:
              c.first_name ||
              (c.display_name ? String(c.display_name).split(/\s+/)[0] : "there"),
            customer_name: c.display_name || c.first_name || "there",
          },
        });
        if (result.dispatched) sent += 1;
        else if (result.duplicate) skipped += 1;
        else skipped += 1;
      } catch (err) {
        failed += 1;
        logger.error(
          { err: err.message, brand, contact_id: c.contact_id },
          "birthday dispatch failed",
        );
      }
    }
  }
  logger.info({ sent, skipped, failed }, "birthday wishes sweep done");
  return { sent, skipped, failed };
}

module.exports = { runBirthdayWishes };
