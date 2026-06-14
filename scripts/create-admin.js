#!/usr/bin/env node
/**
 * Create (or promote) a super-admin / CEO user.
 *
 * Grants is_ceo + all-active-brand access. The AFTER trigger on
 * shared.users rebuilds shared.user_business_access from
 * permitted_businesses, so the new user gets full cross-brand reach
 * (effectively full CRUD until the permissions module lands).
 *
 * Inputs (priority order): CLI flags → env → interactive prompt.
 *   flags:  --email <e> --password <p> --name <n>
 *           (also supports --email=e form)
 *   env:    CREATE_ADMIN_EMAIL / CREATE_ADMIN_PASSWORD / CREATE_ADMIN_NAME
 *
 * Password policy (matches auth.service.assertStrongPassword): ≥8 chars,
 * one uppercase, one number, one special character.
 *
 * PowerShell usage:
 *   node scripts/create-admin.js --email you@pixiegirlglobal.com --password "Sup3r!Pass" --name "Tom-Blake"
 *   # or interactively:
 *   node scripts/create-admin.js
 */

"use strict";

const readline = require("node:readline");
const argon2 = require("argon2");
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

// ── arg parsing ──────────────────────────────────────────
// Supports both `--email x` and `--email=x`.
function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

// Same rule as src/shared/hr_payroll/auth.service.assertStrongPassword —
// kept in lock-step here so the script can't seed a password the API
// would later reject.
function isStrongPassword(pw) {
  return (
    typeof pw === "string" &&
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

function prompt(question, { mute = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    // Best-effort echo muting for the password prompt. Node's readline
    // has no first-class masked input; we intercept the output stream's
    // writes while the prompt is active. If the terminal doesn't support
    // it the value is still read correctly (it just echoes) — noted here
    // so a non-TTY CI run isn't a surprise.
    if (mute) {
      const onData = (char) => {
        const c = String(char);
        if (c === "\n" || c === "\r" || c === "") {
          process.stdin.removeListener("data", onData);
        }
      };
      rl._writeToOutput = function (str) {
        if (str.includes(question)) {
          rl.output.write(str);
        }
        // swallow keystroke echoes
      };
      process.stdin.on("data", onData);
    }
    rl.question(question, (answer) => {
      rl.close();
      if (mute) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function resolveInputs(flags) {
  let email = flags.email || process.env.CREATE_ADMIN_EMAIL;
  let password = flags.password || process.env.CREATE_ADMIN_PASSWORD;
  let name = flags.name || process.env.CREATE_ADMIN_NAME;

  if (!email) email = await prompt("Admin email: ");
  if (!name) name = await prompt("Display name: ");
  if (!password) password = await prompt("Password: ", { mute: true });

  return {
    email: String(email || "").toLowerCase().trim(),
    password: String(password || ""),
    name: String(name || "").trim(),
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const { email, password, name } = await resolveInputs(flags);

  if (!email || !email.includes("@")) {
    console.error("Error: a valid --email is required.");
    process.exit(1);
  }
  if (!isStrongPassword(password)) {
    console.error(
      "Error: password must be at least 8 characters and include an uppercase letter, a number, and a special character.",
    );
    process.exit(1);
  }

  const passwordHash = await argon2.hash(password);

  // All active brands → full cross-brand access via the access trigger.
  const { rows: brands } = await pool.query(
    `SELECT business_key
       FROM shared.business_config
      WHERE is_active = true
      ORDER BY display_name`,
  );
  const permitted = brands.map((b) => b.business_key);
  const defaultBusiness = permitted[0] || null;

  await pool.query(
    `INSERT INTO shared.users
       (email, display_name, password_hash, status, is_ceo,
        permitted_businesses, default_business_key, force_password_reset)
     VALUES ($1, $2, $3, 'active', true, $4::text[], $5, false)
     ON CONFLICT (email) DO UPDATE
       SET password_hash        = EXCLUDED.password_hash,
           display_name         = EXCLUDED.display_name,
           status               = 'active',
           is_ceo               = true,
           permitted_businesses = EXCLUDED.permitted_businesses,
           default_business_key = EXCLUDED.default_business_key`,
    [email, name || email.split("@")[0], passwordHash, permitted, defaultBusiness],
  );

  console.warn(
    `created/updated super-admin ${email} with access to ${permitted.length} businesses`,
  );
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {
    /* pool may already be closed */
  }
  process.exit(1);
});
