/**
 * Stylist Partner Programme sweeps (V2.2 §6.26).
 *
 * Every 15 minutes (offers) / nightly (certifications):
 *   1. Offer expiry — pending offers on lapsed offer-pool assignments expire;
 *      assignments nobody accepted escalate to the admin dispatch queue.
 *   2. Referral hold release — pending attributions past their quality-hold
 *      window flip to payable (Q17/Q14). Assignment holds need no sweep: the
 *      payout queries compare payable_at directly.
 *   3. Certification reminders at T-30/T-7 (idempotent via reminder columns)
 *      and auto-lapse at expiry — the tier clears and the public verify page
 *      reflects it instantly (Q12).
 *
 * One failure never fails the batch — same resilience contract as the other
 * schedulers in this folder.
 */

"use strict";

const programmeRepo = require("../../modules/stylist_programme/programme.repo");
const notify = require("../../modules/stylist_programme/stylist.notify");
const events = require("../../modules/stylist_programme/stylist.events");
const { logger } = require("../../config/logger");

async function runStylistOfferSweep() {
  const out = { offers_expired: 0, escalated: 0, referrals_payable: 0 };
  try {
    const expired = await programmeRepo.expireStaleOffers();
    out.offers_expired = expired.length;
    const escalated = await programmeRepo.escalateExpiredAssignments();
    out.escalated = escalated.length;
    for (const a of escalated)
      events.emit("assignment.escalated", {
        assignment_id: a.assignment_id,
        business: a.business,
      });
  } catch (err) {
    logger.error({ err: err.message }, "stylist sweep: offer expiry failed");
  }
  try {
    const flipped = await programmeRepo.sweepAttributionsPayable();
    out.referrals_payable = flipped.length;
    for (const r of flipped)
      notify
        .notifyStylist({
          stylist_id: r.stylist_id,
          type: "referral",
          title: "Referral commission released",
          body: `₦${r.commission_amount_ngn} from order ${r.order_number || ""} is now payable in your next payout.`,
          data: { attribution_id: r.attribution_id },
        })
        .catch(() => {});
  } catch (err) {
    logger.error({ err: err.message }, "stylist sweep: referral release failed");
  }
  if (out.offers_expired || out.escalated || out.referrals_payable)
    logger.info(out, "stylist offer/referral sweep");
  return out;
}

async function runStylistCertificationSweep() {
  const out = { reminded_30: 0, reminded_7: 0, lapsed: 0 };
  const remind = async (days, column) => {
    const certs = await programmeRepo.certificationsForReminder({
      within_days: days,
      reminder_column: column,
    });
    for (const c of certs) {
      await programmeRepo.markCertReminderSent({
        certification_id: c.certification_id,
        reminder_column: column,
      });
      notify
        .notifyStylist({
          stylist_id: c.stylist_id,
          type: "certification",
          title: `Certification expires in ${days} days`,
          body: `Your ${c.tier_key} certification expires on ${new Date(c.expires_at).toLocaleDateString("en-GB")}. Contact the programme team to re-validate before it lapses.`,
          data: { certification_id: c.certification_id },
          email: {
            subject: `Your Pixie Girl certification expires in ${days} days`,
            bodyHtml: `<p>Your <strong>${c.tier_key}</strong> certification
              expires on ${new Date(c.expires_at).toLocaleDateString("en-GB")}.
              Re-validate before then to keep your badge and routing active.</p>`,
            ctaLabel: "Open your dashboard",
            ctaPath: "/dashboard",
          },
        })
        .catch(() => {});
      events.emit("certification.expiring", {
        stylist_id: c.stylist_id,
        certification_id: c.certification_id,
        days,
      });
    }
    return certs.length;
  };
  try {
    out.reminded_30 = await remind(30, "reminder_30_sent_at");
    out.reminded_7 = await remind(7, "reminder_7_sent_at");
  } catch (err) {
    logger.error({ err: err.message }, "stylist sweep: cert reminders failed");
  }
  try {
    const lapsed = await programmeRepo.lapseExpiredCertifications();
    out.lapsed = lapsed.length;
    for (const c of lapsed) {
      events.emit("certification.lapsed", {
        stylist_id: c.stylist_id,
        certification_id: c.certification_id,
        tier_key: c.tier_key,
      });
      notify
        .notifyStylist({
          stylist_id: c.stylist_id,
          type: "certification",
          title: "Certification lapsed",
          body: `Your ${c.tier_key} certification has expired. Your tier is paused until re-validation — your verify page reflects this.`,
          data: { certification_id: c.certification_id },
          email: {
            subject: "Your Pixie Girl certification has lapsed",
            bodyHtml: `<p>Your <strong>${c.tier_key}</strong> certification has
              expired and your tier is paused until re-validation. Reach out to
              the programme team to schedule it.</p>`,
          },
        })
        .catch(() => {});
    }
  } catch (err) {
    logger.error({ err: err.message }, "stylist sweep: cert lapse failed");
  }
  if (out.reminded_30 || out.reminded_7 || out.lapsed)
    logger.info(out, "stylist certification sweep");
  return out;
}

module.exports = { runStylistOfferSweep, runStylistCertificationSweep };
