#!/usr/bin/env node
"use strict";

/**
 * Seed the first Kaizen operator (JBS Praxis maintenance console).
 *
 * Kaizen operators live in shared.kaizen_operators — SEPARATE from the client's
 * platform users. This creates one active operator with `must_change_password`
 * set, so they rotate the seeded password on first login.
 *
 * The password is NEVER committed. Supply it via env/flag, or the script
 * prompts for it interactively.
 *
 *   KAIZEN_ADMIN_EMAIL=tom.asaah@jbspraxis.com \
 *   KAIZEN_ADMIN_NAME="Tom Asaah" \
 *   KAIZEN_ADMIN_PHONE=09020868023 \
 *   KAIZEN_ADMIN_PASSWORD='<set-at-deploy>' \
 *   node scripts/kaizen-create-operator.js
 *
 *   # or with flags (password will be prompted if omitted):
 *   node scripts/kaizen-create-operator.js --email tom.asaah@jbspraxis.com \
 *        --name "Tom Asaah" --phone 09020868023
 */

require("dotenv").config();

const argon2 = require("argon2");
const readline = require("readline");
const { Pool } = require("pg");

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

function prompt(question, { hidden = false } = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  if (hidden) {
    // Suppress echo for password entry.
    const onData = () => {
      rl.output.write("\x1b[2K\r" + question);
    };
    rl.input.on("data", onData);
    rl._writeToOutput = () => rl.output.write(question);
  }
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(ans);
    }),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let email = args.email || process.env.KAIZEN_ADMIN_EMAIL;
  let name = args.name || process.env.KAIZEN_ADMIN_NAME;
  let phone = args.phone || process.env.KAIZEN_ADMIN_PHONE;
  let password = args.password || process.env.KAIZEN_ADMIN_PASSWORD;

  if (!email) email = (await prompt("Operator email: ")).trim();
  if (!name) name = (await prompt("Display name: ")).trim();
  if (!phone) phone = (await prompt("Phone (optional): ")).trim();
  if (!password)
    password = (
      await prompt(
        "Password (min 8, incl. uppercase + number): ",
        { hidden: true },
      )
    ).trim();

  email = String(email).toLowerCase().trim();
  name = name || email;

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
      `SELECT status FROM shared.kaizen_operators WHERE email = $1`,
      [email],
    );
    if (dup.length && dup[0].status === "active") {
      throw new Error(`An active operator with email '${email}' already exists`);
    }

    const hash = await argon2.hash(password);

    if (dup.length) {
      await client.query(
        `UPDATE shared.kaizen_operators
            SET display_name = $2, phone = $3, password_hash = $4,
                status = 'active', must_change_password = TRUE, updated_at = now()
          WHERE email = $1`,
        [email, name, phone || null, hash],
      );
    } else {
      await client.query(
        `INSERT INTO shared.kaizen_operators
           (email, display_name, phone, password_hash, status, must_change_password)
         VALUES ($1, $2, $3, $4, 'active', TRUE)`,
        [email, name, phone || null, hash],
      );
    }

    process.stdout.write(
      `\n✓ Kaizen operator ready: ${name} <${email}>\n` +
        `  They must change this password on first login.\n`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`\n✗ ${err.message}\n`);
  process.exit(1);
});
