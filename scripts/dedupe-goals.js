/**
 * One-off: archive duplicate live goals left behind by the Chief-of-Staff
 * duplicate-plan bug (two approvable copies of the same plan each created
 * "UK Popup Pilot — London Salon Partnership"). NOT a recurring sweep — the
 * executor's duplicate-goal guard prevents new twins going forward.
 *
 * WHAT IT DOES
 * For every (business, lower(title)) group of ACTIVE/ON_HOLD goals with more
 * than one row, it KEEPS the earliest-created goal and archives the rest
 * (status='archived'). Nothing is deleted; milestones/tasks/notes stay
 * attached to their goal. Duplicates that already carry milestones, linked
 * tasks or notes are SKIPPED (a human should merge those by hand) — the
 * CoS-bug twins are bare, so they qualify.
 *
 * RUN (project root, same .env as the app):
 *   node scripts/dedupe-goals.js            # dry run — prints what it WOULD do
 *   node scripts/dedupe-goals.js --apply    # actually archive
 */

"use strict";

const { initDatabase, closeDatabase, query, transaction } = require("../src/config/database");

const APPLY = process.argv.includes("--apply");

async function main() {
  await initDatabase();

  // Later-created twins of a live goal, bare of any attached work.
  const { rows } = await query(
    `WITH ranked AS (
       SELECT g.goal_id, g.business, g.title, g.status, g.created_at,
              row_number() OVER (
                PARTITION BY g.business, lower(g.title)
                ORDER BY g.created_at ASC
              ) AS rn
         FROM shared.goals g
        WHERE g.is_deleted = false AND g.status IN ('active','on_hold')
     )
     SELECT r.goal_id, r.business, r.title, r.created_at,
            (SELECT count(*)::int FROM shared.goal_milestones m WHERE m.goal_id = r.goal_id)            AS milestones,
            (SELECT count(*)::int FROM shared.tasks t WHERE t.goal_id = r.goal_id AND t.is_deleted = false) AS tasks,
            (SELECT count(*)::int FROM shared.workspace_notes n WHERE n.goal_id = r.goal_id)             AS notes
       FROM ranked r
      WHERE r.rn > 1
      ORDER BY r.business, lower(r.title), r.created_at`,
  );

  if (!rows.length) {
    console.log("No duplicate live goals found — nothing to do.");
    return;
  }

  let archived = 0;
  let skipped = 0;
  for (const g of rows) {
    const attached = g.milestones + g.tasks + g.notes;
    if (attached > 0) {
      skipped++;
      console.log(
        `SKIP   ${g.business} · “${g.title}” (${g.goal_id}) — carries ${g.milestones} milestone(s), ` +
          `${g.tasks} task(s), ${g.notes} note(s); merge by hand.`,
      );
      continue;
    }
    if (APPLY) {
      await transaction(async (client) => {
        await client.query(
          `UPDATE shared.goals SET status = 'archived', updated_at = now()
            WHERE goal_id = $1 AND status IN ('active','on_hold')`,
          [g.goal_id],
        );
      });
      archived++;
      console.log(`ARCHIVED ${g.business} · “${g.title}” (${g.goal_id}, created ${g.created_at})`);
    } else {
      archived++;
      console.log(
        `WOULD ARCHIVE ${g.business} · “${g.title}” (${g.goal_id}, created ${g.created_at})`,
      );
    }
  }

  console.log(
    `\n${APPLY ? "Archived" : "Would archive"} ${archived} duplicate goal(s); skipped ${skipped}.` +
      (APPLY ? "" : "  Re-run with --apply to make it real."),
  );
}

main()
  .catch((err) => {
    console.error("dedupe-goals failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
