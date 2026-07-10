#!/usr/bin/env node
"use strict";

/**
 * User-account & access audit — read-only.
 *
 * Finds the account/RBAC inconsistencies behind "I granted a role but the
 * user still sees nothing" and duplicate people in Users & Access:
 *
 *   1. DUPLICATE LOGINS   — staff profiles linked to more than one login
 *                           (role grants split across the accounts).
 *   2. ORPHANED INVITES   — accepted invitations tied to a staff profile
 *                           whose created login lost the profile link
 *                           (acceptInvitation historically dropped it).
 *   3. INVISIBLE GRANTS   — role grants for a business the user cannot
 *                           enter (brand-context 403s before RBAC runs).
 *   4. EXPIRED GRANTS     — user_roles rows past expires_at (historically
 *                           still honoured at runtime).
 *   5. ROLE-LESS USERS    — active non-CEO logins with no role at all
 *                           (they see only the ungated shell).
 *   6. SAME-NAME USERS    — distinct active logins sharing a display name
 *                           (likely the same person, different emails).
 *   7. ALL-BUSINESS/CEO   — accounts with '*' grants or the CEO bypass,
 *                           for periodic review.
 *
 * Prints a report plus suggested remediation SQL. NEVER executes fixes —
 * review and run them yourself.
 *
 * Usage:  npm run audit:users        (or node scripts/audit-user-accounts.js)
 */

require("dotenv").config();

const { Pool } = require("pg");

const line = (s = "") => process.stdout.write(s + "\n");
const header = (title) => {
  line();
  line("═".repeat(64));
  line(title);
  line("═".repeat(64));
};

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  let findings = 0;

  try {
    // ── 1. Duplicate logins per staff profile ──────────────
    const { rows: dupProfiles } = await client.query(`
      SELECT u.staff_profile_id,
             c.display_name AS staff_name,
             json_agg(json_build_object(
               'user_id', u.user_id,
               'email', u.email,
               'status', u.status,
               'is_ceo', u.is_ceo,
               'created_at', u.created_at,
               'last_login_at', u.last_login_at,
               'roles', (SELECT COALESCE(json_agg(json_build_object(
                            'role', r.role_name, 'business', ur.business)), '[]'::json)
                           FROM shared.user_roles ur
                           JOIN shared.roles r ON r.role_id = ur.role_id
                          WHERE ur.user_id = u.user_id)
             ) ORDER BY u.created_at) AS accounts
        FROM shared.users u
        LEFT JOIN shared.staff_profiles sp ON sp.profile_id = u.staff_profile_id
        LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       WHERE u.staff_profile_id IS NOT NULL
         AND u.status <> 'disabled'
       GROUP BY u.staff_profile_id, c.display_name
      HAVING count(*) > 1
    `);
    header(
      `1. Staff profiles with MULTIPLE active logins: ${dupProfiles.length}`,
    );
    for (const row of dupProfiles) {
      findings++;
      line(
        `\n▶ ${row.staff_name || "(no contact name)"} — profile ${row.staff_profile_id}`,
      );
      for (const a of row.accounts) {
        line(
          `   • ${a.email}  status=${a.status}${a.is_ceo ? "  IS_CEO" : ""}  ` +
            `last_login=${a.last_login_at || "never"}  roles=${JSON.stringify(a.roles)}`,
        );
      }
      line(
        `   Remediation (KEEP the account the person actually signs in with):`,
      );
      line(`     -- move role grants from the duplicate to the kept account:`);
      line(
        `     -- UPDATE shared.user_roles SET user_id = '<keep>' WHERE user_id = '<dupe>'`,
      );
      line(`     --   ON CONFLICT: delete the duplicate grant row instead.`);
      line(`     -- unlink + disable the duplicate:`);
      line(
        `     -- UPDATE shared.users SET staff_profile_id = NULL, status = 'disabled' WHERE user_id = '<dupe>';`,
      );
    }
    if (!dupProfiles.length) line("   none ✓");

    // ── 2. Accepted invites whose login lost the profile link ─
    const { rows: orphaned } = await client.query(`
      SELECT i.invitation_id, i.email, i.staff_profile_id, i.accepted_user_id,
             u.email AS user_email, u.staff_profile_id AS user_profile_id,
             c.display_name AS staff_name
        FROM shared.staff_invitations i
        JOIN shared.users u ON u.user_id = i.accepted_user_id
        LEFT JOIN shared.staff_profiles sp ON sp.profile_id = i.staff_profile_id
        LEFT JOIN shared.contacts c ON c.contact_id = sp.contact_id
       WHERE i.status = 'accepted'
         AND i.staff_profile_id IS NOT NULL
         AND u.staff_profile_id IS NULL
    `);
    header(
      `2. Accepted invites whose login is NOT linked to its staff profile: ${orphaned.length}`,
    );
    for (const row of orphaned) {
      findings++;
      line(
        `\n▶ ${row.staff_name || row.email} — login ${row.user_email} should link profile ${row.staff_profile_id}`,
      );
      line(
        `   Remediation (only if no OTHER active login holds that profile):`,
      );
      line(
        `     -- UPDATE shared.users SET staff_profile_id = '${row.staff_profile_id}' WHERE user_id = '${row.accepted_user_id}';`,
      );
    }
    if (!orphaned.length) line("   none ✓");

    // ── 3. Role grants the user cannot use (no brand access) ─
    const { rows: invisible } = await client.query(`
      SELECT u.user_id, u.email, r.role_name, ur.business,
             u.permitted_businesses
        FROM shared.user_roles ur
        JOIN shared.users u ON u.user_id = ur.user_id
        JOIN shared.roles r ON r.role_id = ur.role_id
       WHERE ur.business <> '*'
         AND u.is_ceo = false
         AND u.status = 'active'
         AND NOT (ur.business = ANY(u.permitted_businesses))
    `);
    header(
      `3. Role grants for a business the user cannot enter: ${invisible.length}`,
    );
    for (const row of invisible) {
      findings++;
      line(
        `\n▶ ${row.email} holds '${row.role_name}' for '${row.business}' but permitted_businesses=${JSON.stringify(row.permitted_businesses)}`,
      );
      line(`   Remediation:`);
      line(
        `     -- UPDATE shared.users SET permitted_businesses = array_append(permitted_businesses, '${row.business}') WHERE user_id = '${row.user_id}';`,
      );
    }
    if (!invisible.length) line("   none ✓");

    // ── 4. Expired grants still present ────────────────────
    const { rows: expired } = await client.query(`
      SELECT u.email, r.role_name, ur.business, ur.expires_at
        FROM shared.user_roles ur
        JOIN shared.users u ON u.user_id = ur.user_id
        JOIN shared.roles r ON r.role_id = ur.role_id
       WHERE ur.expires_at IS NOT NULL AND ur.expires_at <= now()
    `);
    header(`4. Expired role grants still on file: ${expired.length}`);
    for (const row of expired) {
      findings++;
      line(
        `   • ${row.email} — ${row.role_name}/${row.business} expired ${row.expires_at}`,
      );
    }
    if (expired.length) {
      line(`   Remediation:`);
      line(
        `     -- DELETE FROM shared.user_roles WHERE expires_at IS NOT NULL AND expires_at <= now();`,
      );
    } else line("   none ✓");

    // ── 5. Active non-CEO users with zero roles ────────────
    const { rows: roleless } = await client.query(`
      SELECT u.user_id, u.email, u.display_name, u.permitted_businesses
        FROM shared.users u
       WHERE u.status = 'active' AND u.is_ceo = false
         AND NOT EXISTS (SELECT 1 FROM shared.user_roles ur WHERE ur.user_id = u.user_id)
       ORDER BY u.created_at DESC
    `);
    header(
      `5. Active non-CEO logins with NO role (see nothing): ${roleless.length}`,
    );
    for (const row of roleless) {
      findings++;
      line(
        `   • ${row.display_name || "?"} <${row.email}> businesses=${JSON.stringify(row.permitted_businesses)}`,
      );
    }
    if (!roleless.length) line("   none ✓");

    // ── 6. Same display name on multiple active logins ─────
    const { rows: sameName } = await client.query(`
      SELECT lower(display_name) AS name,
             json_agg(json_build_object('email', email, 'user_id', user_id,
                       'staff_profile_id', staff_profile_id) ORDER BY created_at) AS accounts
        FROM shared.users
       WHERE status <> 'disabled' AND display_name IS NOT NULL
       GROUP BY lower(display_name)
      HAVING count(*) > 1
    `);
    header(
      `6. Same display name across multiple active logins: ${sameName.length}`,
    );
    for (const row of sameName) {
      findings++;
      line(`\n▶ "${row.name}"`);
      for (const a of row.accounts)
        line(
          `   • ${a.email}  profile=${a.staff_profile_id || "—"}  (${a.user_id})`,
        );
      line(`   Likely the same person — merge as in section 1 if confirmed.`);
    }
    if (!sameName.length) line("   none ✓");

    // ── 7. Broad-access accounts (review list) ─────────────
    const { rows: broad } = await client.query(`
      SELECT u.email, u.is_ceo, u.status,
             COALESCE((SELECT json_agg(json_build_object('role', r.role_name, 'business', ur.business))
                FROM shared.user_roles ur JOIN shared.roles r ON r.role_id = ur.role_id
               WHERE ur.user_id = u.user_id AND ur.business = '*'), '[]'::json) AS star_grants
        FROM shared.users u
       WHERE u.status <> 'disabled'
         AND (u.is_ceo = true OR EXISTS (
              SELECT 1 FROM shared.user_roles ur
               WHERE ur.user_id = u.user_id AND ur.business = '*'))
       ORDER BY u.is_ceo DESC, u.email
    `);
    header(
      `7. Broad-access accounts (CEO bypass or '*' grants): ${broad.length}`,
    );
    for (const row of broad) {
      line(
        `   • ${row.email}${row.is_ceo ? "  [CEO — bypasses ALL permission checks]" : ""}  ` +
          `star_grants=${JSON.stringify(row.star_grants)}`,
      );
    }
    if (!broad.length) line("   none ✓");

    header(`Summary: ${findings} finding(s) needing attention`);
    line(
      findings
        ? "Review each section's remediation SQL, run it manually, then re-run this audit."
        : "Access data is consistent ✓",
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`✗ audit failed: ${err.message}\n`);
  process.exit(1);
});
