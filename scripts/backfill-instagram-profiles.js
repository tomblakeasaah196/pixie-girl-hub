/**
 * One-off backfill: resolve real names + profile pictures for Instagram
 * contacts that landed in the inbox as a raw IGSID.
 *
 * Inbound Instagram webhooks carry only the sender's Instagram-scoped ID
 * (IGSID) — no name, no picture. PR 457 added a profile lookup, but it
 * only runs when a NEW DM arrives, so contacts created before that shipped
 * (or whose lookup failed) still show a numeric name and no avatar. This
 * walks those handles and fills them via the IG User Profile API.
 *
 * READ-ONLY toward customers: it only *fetches* profiles — it never sends
 * a message. Safe to run against real customers.
 *
 * Idempotent + best-effort: only touches unresolved handles; a failed
 * fetch leaves the row untouched (safe to re-run). A name a human typed is
 * never overwritten — only the "New contact" / raw-IGSID placeholder heals.
 *
 * RUN (project root):
 *   node scripts/backfill-instagram-profiles.js
 *   BACKFILL_LIMIT=500 node scripts/backfill-instagram-profiles.js
 *   DRY_RUN=1 node scripts/backfill-instagram-profiles.js   (report only)
 */

"use strict";

const {
  initDatabase,
  closeDatabase,
  query,
} = require("../src/config/database");
const instagram = require("../src/services/instagram.service");
const maRepo = require("../src/modules/messaging_accounts/messaging-accounts.repo");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Mirror smartcomm's placeholder test: heal a name that is empty, the
// literal "New contact", or the raw IGSID — never a name a human typed.
function isPlaceholder(name, igsid) {
  if (!name) return true;
  const n = String(name).trim().toLowerCase();
  return n === "new contact" || n === String(igsid).toLowerCase();
}

(async () => {
  try {
    await initDatabase();
    const limit = Number(process.env.BACKFILL_LIMIT) || 2000;
    const gapMs = Number(process.env.BACKFILL_GAP_MS) || 300; // be gentle on Graph
    const dryRun = !!process.env.DRY_RUN;

    // Which brands have an active IG account (and so a usable token).
    const igAccounts = await maRepo.listActiveByPlatform({ platform: "instagram" });
    const igBrands = igAccounts.map((a) => a.business);
    if (igBrands.length === 0) {
      console.error("No active Instagram account configured — nothing to backfill.");
      process.exitCode = 1;
      return;
    }
    const soleBrand = igBrands.length === 1 ? igBrands[0] : null;

    // Handles that came from Instagram but still lack an identity: no
    // picture, no name, or the contact is still named after its IGSID.
    const { rows } = await query(
      `SELECT h.contact_id,
              h.external_user_id,
              h.display_name        AS handle_name,
              h.profile_picture_url,
              c.display_name        AS contact_name,
              c.visible_to
         FROM shared.contact_social_handles h
         JOIN shared.contacts c ON c.contact_id = h.contact_id
        WHERE h.platform = 'instagram'
          AND h.external_user_id IS NOT NULL
          AND ( h.profile_picture_url IS NULL
                OR h.display_name IS NULL
                OR c.display_name = h.external_user_id )
        ORDER BY c.created_at DESC NULLS LAST
        LIMIT $1`,
      [limit],
    );

    console.warn(
      `Found ${rows.length} Instagram contact(s) to resolve` +
        (dryRun ? " (DRY_RUN — no writes)" : "") +
        `.`,
    );

    const summary = { checked: 0, resolved: 0, healed: 0, missed: 0, skipped: 0 };

    for (const r of rows) {
      summary.checked += 1;
      const igsid = r.external_user_id;
      // Use the brand that ingested this contact (its visible_to), falling
      // back to the sole active IG brand when unambiguous.
      const visible = Array.isArray(r.visible_to) ? r.visible_to : [];
      const brand = visible.find((b) => igBrands.includes(b)) || soleBrand;
      if (!brand) {
        summary.skipped += 1;
        continue;
      }

      let profile = null;
      try {
        profile = await instagram.fetchUserProfile({ brand, igsid });
      } catch (err) {
        console.warn(`  ${igsid}: fetch error — ${err.message}`);
      }
      if (!profile || (!profile.name && !profile.username && !profile.profile_pic)) {
        summary.missed += 1;
        await sleep(gapMs);
        continue;
      }

      const name = profile.name || profile.username || null;
      const username = profile.username || null;
      const pic = profile.profile_pic || null;

      if (dryRun) {
        console.warn(
          `  ${igsid} → ${name || "(no name)"}${username ? ` (@${username})` : ""}${pic ? " +photo" : ""}`,
        );
        summary.resolved += 1;
        await sleep(gapMs);
        continue;
      }

      await query(
        `UPDATE shared.contact_social_handles
            SET display_name        = COALESCE($2, display_name),
                handle              = COALESCE($3, handle),
                profile_picture_url = COALESCE($4, profile_picture_url),
                updated_at          = now()
          WHERE platform = 'instagram' AND external_user_id = $1`,
        [igsid, name, username, pic],
      );
      summary.resolved += 1;

      // Heal the contact's placeholder name only (never a human-typed one).
      if (name && isPlaceholder(r.contact_name, igsid)) {
        const first = name.split(" ")[0] || null;
        const last = name.split(" ").slice(1).join(" ") || null;
        await query(
          `UPDATE shared.contacts
              SET display_name = $2,
                  first_name   = COALESCE(first_name, $3),
                  last_name    = COALESCE(last_name, NULLIF($4, ''))
            WHERE contact_id = $1`,
          [r.contact_id, name, first, last],
        );
        summary.healed += 1;
      }
      await sleep(gapMs);
    }

    console.warn(
      `Done. checked=${summary.checked} resolved=${summary.resolved} ` +
        `names_healed=${summary.healed} unresolved=${summary.missed} skipped=${summary.skipped}`,
    );
  } catch (err) {
    console.error("Backfill failed:", err.message);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
