#!/usr/bin/env node
"use strict";

/**
 * Seed the test China factory manager account.
 *
 * Creates:
 *   manager@chinafactory.com / Factory@2026
 *   Display name: 张伟
 *   Role: factory_manager (purchasing:view/create/edit, scope=own)
 *   Business: faitlynhair (Faitlyn Hair — the brand that works with China factory)
 *
 * Safe to run multiple times — skips if the email already exists.
 *
 * Usage:
 *   npm run seed:factory-manager
 *   node scripts/seed-factory-manager.js [--business faitlynhair]
 */

require("dotenv").config();

const argon2 = require("argon2");
const { Pool } = require("pg");

const EMAIL = "manager@chinafactory.com";
const PASSWORD = "Factory@2026";
const DISPLAY_NAME = "张伟";
const ROLE_NAME = "factory_manager";

async function main() {
  const args = process.argv.slice(2);
  const businessArg =
    args[args.indexOf("--business") + 1] ||
    process.env.FACTORY_BUSINESS ||
    "faitlynhair";

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    // Check if already exists
    const { rows: existing } = await client.query(
      "SELECT user_id FROM shared.users WHERE email = $1",
      [EMAIL],
    );
    if (existing.length) {
      process.stdout.write(
        `\n✔ Account already exists: ${EMAIL} (user_id: ${existing[0].user_id})\n`,
      );
      return;
    }

    // Validate business exists
    const { rows: biz } = await client.query(
      "SELECT business_key FROM shared.business_config WHERE business_key = $1 AND is_active = true",
      [businessArg],
    );
    if (!biz.length) {
      throw new Error(
        `Business '${businessArg}' not found or inactive. Run db:bootstrap:faitlynhair first.`,
      );
    }

    // Validate role exists
    const { rows: roleRows } = await client.query(
      "SELECT role_id FROM shared.roles WHERE role_name = $1 LIMIT 1",
      [ROLE_NAME],
    );
    if (!roleRows.length) {
      throw new Error(
        `'${ROLE_NAME}' role not found — run migration 000214 first (npm run db:migrate:shared)`,
      );
    }
    const roleId = roleRows[0].role_id;

    const passwordHash = await argon2.hash(PASSWORD);

    await client.query("BEGIN");

    // 1. Contact
    const { rows: contactRows } = await client.query(
      `INSERT INTO shared.contacts
         (contact_type, display_name, email, primary_phone, source, visible_to)
       VALUES (ARRAY['staff'], $1, $2, $3, 'system', '{}')
       RETURNING contact_id`,
      [DISPLAY_NAME, EMAIL, "+86-000-0000-0000"],
    );
    const contactId = contactRows[0].contact_id;

    // 2. Staff profile
    const { rows: cnt } = await client.query(
      "SELECT count(*)::int AS n FROM shared.staff_profiles",
    );
    const employeeNumber = `FM-${String(cnt[0].n + 1).padStart(4, "0")}`;
    const { rows: profileRows } = await client.query(
      `INSERT INTO shared.staff_profiles
         (contact_id, employee_number, business, job_title, employment_type, start_date)
       VALUES ($1, $2, $3, 'Factory Manager', 'contract', CURRENT_DATE)
       RETURNING profile_id`,
      [contactId, employeeNumber, businessArg],
    );
    const profileId = profileRows[0].profile_id;

    // 3. User
    const { rows: userRows } = await client.query(
      `INSERT INTO shared.users
         (staff_profile_id, email, password_hash, display_name, status, is_ceo,
          default_business, permitted_businesses, force_password_reset)
       VALUES ($1, $2, $3, $4, 'active', false, $5, $6::text[], false)
       RETURNING user_id`,
      [
        profileId,
        EMAIL,
        passwordHash,
        DISPLAY_NAME,
        businessArg,
        [businessArg],
      ],
    );
    const userId = userRows[0].user_id;

    // 4. Role assignment
    await client.query(
      `INSERT INTO shared.user_roles (user_id, role_id, business, granted_by)
       VALUES ($1, $2, $3, $1)
       ON CONFLICT (user_id, role_id, business) DO NOTHING`,
      [userId, roleId, businessArg],
    );

    await client.query("COMMIT");

    process.stdout.write(
      `\n✔ Factory manager account created:\n` +
        `  email:    ${EMAIL}\n` +
        `  password: ${PASSWORD}\n` +
        `  name:     ${DISPLAY_NAME}\n` +
        `  role:     ${ROLE_NAME} on '${businessArg}'\n` +
        `  user_id:  ${userId}\n\n`,
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    process.stderr.write(`\n✗ Failed: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
