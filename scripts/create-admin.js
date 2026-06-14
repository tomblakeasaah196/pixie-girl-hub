#!/usr/bin/env node
"use strict";

/**
 * Create the first CEO / owner admin — full access to the entire system and
 * every business. A staff member is also a CONTACT, so this builds the whole
 * chain (the same shape the HR/invite flows use):
 *
 *   shared.contacts (contact_type ['staff'])
 *     └─ shared.staff_profiles (business, employee_number, job_title)
 *          └─ shared.users (staff_profile_id, is_ceo=true, status='active')
 *               └─ shared.user_roles (owner role on '*' = all businesses)
 *
 * Pixie specifics (differ from a generic bcrypt/jewelry example):
 *   • password hashed with ARGON2 (what auth.service verifies — NOT bcrypt)
 *   • is_ceo=true is the §3 bypass: RBAC + brand-context grant a CEO every
 *     module and every brand implicitly. `permitted_businesses` is still set to
 *     all current brands (a 000113 trigger fans it to user_business_access).
 *   • status='active' drives is_active via the 000113 sync trigger.
 *
 * Requires at least one bootstrapped business (staff_profiles.business is NOT
 * NULL): run db:bootstrap:<brand> first.
 *
 * Usage (flags, env, or interactive prompts for anything missing):
 *   node scripts/create-admin.js --email ceo@pixie.com --password 'Secret123' \
 *        [--name "Faith"] [--business pixiegirl] [--phone 08012345678]
 *   ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/create-admin.js
 */

require("dotenv").config();

const argon2 = require("argon2");
const readline = require("readline");
const { Pool } = require("pg");

const OWNER_ROLE = "owner";
const PASSWORD_RE = /^(?=.*[A-Z])(?=.*\d).{8,}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[k] = true;
    else {
      out[k] = next;
      i++;
    }
  }
  return out;
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await new Promise((resolve) => rl.question(question, resolve));
  } finally {
    rl.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let email = args.email || process.env.ADMIN_EMAIL;
  let password = args.password || process.env.ADMIN_PASSWORD;
  let displayName = args.name || process.env.ADMIN_NAME;

  if (!email) email = (await prompt("Email: ")).trim();
  if (!password)
    password = (
      await prompt(
        "Password (min 8 chars, incl. an uppercase letter and a number): ",
      )
    ).trim();
  if (!displayName) displayName = (await prompt("Display name [CEO]: ")).trim();

  email = String(email).toLowerCase().trim();
  displayName = displayName || "CEO";
  const phone = (args.phone || "00000000000").toString();

  if (!EMAIL_RE.test(email)) {
    process.stderr.write(`\n✗ '${email}' is not a valid email.\n`);
    process.exit(1);
  }
  if (!PASSWORD_RE.test(password)) {
    process.stderr.write(
      "\n✗ Password must be at least 8 characters and include an uppercase letter and a number.\n",
    );
    process.exit(1);
  }

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
    const { rows: dup } = await client.query(
      `SELECT 1 FROM shared.users WHERE email = $1`,
      [email],
    );
    if (dup.length)
      throw new Error(`A user with email '${email}' already exists`);

    const { rows: roleRows } = await client.query(
      `SELECT role_id FROM shared.roles WHERE role_name = $1 LIMIT 1`,
      [OWNER_ROLE],
    );
    if (!roleRows.length)
      throw new Error(
        `'${OWNER_ROLE}' role not found — run db:migrate:shared first`,
      );
    const ownerRoleId = roleRows[0].role_id;

    const { rows: bizRows } = await client.query(
      `SELECT business_key FROM shared.business_config WHERE is_active = true ORDER BY business_key`,
    );
    const businesses = bizRows.map((r) => r.business_key);
    if (!businesses.length)
      throw new Error(
        "No active business found — run db:bootstrap:<brand> first (a staff profile must belong to a business).",
      );
    const homeBusiness = args.business || businesses[0];
    if (!businesses.includes(homeBusiness))
      throw new Error(
        `--business '${homeBusiness}' is not active (have: ${businesses.join(", ")})`,
      );

    const password_hash = await argon2.hash(password);

    await client.query("BEGIN");

    // 1. Contact — a staff member is also a contact.
    const { rows: contactRows } = await client.query(
      `INSERT INTO shared.contacts
         (contact_type, display_name, primary_phone, email, source, visible_to)
       VALUES (ARRAY['staff'], $1, $2, $3, 'system', '{}')
       RETURNING contact_id`,
      [displayName, phone, email],
    );
    const contactId = contactRows[0].contact_id;

    // 2. Staff profile (unique employee number; belongs to the home business).
    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS n FROM shared.staff_profiles`,
    );
    const employeeNumber = `ADMIN-${String(cnt[0].n + 1).padStart(4, "0")}`;
    const { rows: profileRows } = await client.query(
      `INSERT INTO shared.staff_profiles
         (contact_id, employee_number, business, job_title, employment_type, start_date)
       VALUES ($1, $2, $3, 'Chief Executive', 'full_time', CURRENT_DATE)
       RETURNING profile_id`,
      [contactId, employeeNumber, homeBusiness],
    );
    const profileId = profileRows[0].profile_id;

    // 3. User — linked to the staff profile, CEO, active, all brands.
    // Same column shape as invitations.repo.createUser (the proven path): status
    // drives is_active; permitted_businesses fans out to user_business_access.
    const { rows: userRows } = await client.query(
      `INSERT INTO shared.users
         (staff_profile_id, email, password_hash, display_name, status, is_ceo,
          default_business, permitted_businesses, force_password_reset)
       VALUES ($1, $2, $3, $4, 'active', true, $5, $6::text[], false)
       RETURNING user_id`,
      [profileId, email, password_hash, displayName, homeBusiness, businesses],
    );
    const userId = userRows[0].user_id;

    // 4. Owner role for ALL businesses ('*'); self-granted.
    await client.query(
      `INSERT INTO shared.user_roles (user_id, role_id, business, granted_by)
       VALUES ($1, $2, '*', $1)
       ON CONFLICT (user_id, role_id, business) DO NOTHING`,
      [userId, ownerRoleId],
    );

    await client.query("COMMIT");

    process.stdout.write(
      `\n✔ Admin created: ${email}\n` +
        `  user_id:    ${userId}\n` +
        `  contact_id: ${contactId} (contact_type ['staff'])\n` +
        `  profile:    ${employeeNumber} · Chief Executive · ${homeBusiness}\n` +
        `  is_ceo:     true (full system + cross-brand access)\n` +
        `  role:       owner on '*' (all businesses)\n` +
        `  businesses: ${businesses.join(", ")}\n`,
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    process.stderr.write(`\n✗ Failed to create admin: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
