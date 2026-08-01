/**
 * One-off backfill: derive shared.contacts.country_code from primary_phone.
 *
 * The CRM clients "filter by country" box matches a phone dialing prefix OR the
 * ISO country_code column. country_code was only ever set by storefront
 * geo-detection, so walk-in / imported / manually-added clients have it NULL
 * and the ISO half of the filter can't see them. This fills those NULLs from
 * the phone number they already have.
 *
 * Rules (see src/modules/crm/country-codes.js isoFromPhone):
 *   - a leading '+' (or '00') is trusted as the international marker → map it
 *   - any 234… number is Nigeria
 *   - otherwise it's a local number → assume the home country (BACKFILL_HOME_ISO,
 *     default NG, since both businesses store most numbers as 080…)
 *
 * Idempotent + safe: only touches rows WHERE country_code IS NULL. Unresolvable
 * numbers are left NULL (re-run anytime). Nothing is overwritten.
 *
 * RUN (project root):
 *   node scripts/backfill-contact-country-codes.js            # apply
 *   node scripts/backfill-contact-country-codes.js --dry-run  # preview counts
 *   BACKFILL_HOME_ISO="" node scripts/backfill-contact-country-codes.js  # no home default
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const { isoFromPhone } = require("../src/modules/crm/country-codes");

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  const homeIso =
    process.env.BACKFILL_HOME_ISO === undefined
      ? "NG"
      : process.env.BACKFILL_HOME_ISO || null;

  try {
    await initDatabase();

    const { rows } = await query(
      `SELECT contact_id, primary_phone
         FROM shared.contacts
        WHERE country_code IS NULL
          AND primary_phone IS NOT NULL
          AND primary_phone <> ''`,
    );
    console.warn(
      `Contacts missing country_code: ${rows.length}` +
        (dryRun ? " (dry run — no writes)" : ""),
    );

    const byIso = {};
    let filled = 0;
    let skipped = 0;

    for (const r of rows) {
      const iso = isoFromPhone(r.primary_phone, homeIso);
      if (!iso) {
        skipped++;
        continue;
      }
      byIso[iso] = (byIso[iso] || 0) + 1;
      filled++;
      if (!dryRun) {
        await query(
          `UPDATE shared.contacts
              SET country_code = $2
            WHERE contact_id = $1 AND country_code IS NULL`,
          [r.contact_id, iso],
        );
      }
    }

    console.warn(
      `${dryRun ? "Would fill" : "Filled"}: ${filled}, left NULL: ${skipped}.`,
    );
    const breakdown = Object.entries(byIso)
      .sort((a, b) => b[1] - a[1])
      .map(([iso, n]) => `${iso}=${n}`)
      .join("  ");
    if (breakdown) console.warn(`By country: ${breakdown}`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
