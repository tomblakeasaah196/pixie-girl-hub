#!/usr/bin/env node
"use strict";
require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

async function main() {
  const client = await pool.connect();
  try {
    const ROLE_ID = "11111111-1111-1111-1111-000000000007";
    const EMAIL = "manager@chinafactory.com";

    const { rows: role } = await client.query(
      "SELECT role_id, role_name FROM shared.roles WHERE role_id = $1", [ROLE_ID],
    );
    console.log("\n[1] factory_manager role:", role.length ? `✔ EXISTS (${role[0].role_name})` : "✗ MISSING — run: npm run db:migrate:shared");

    const { rows: perms } = await client.query(
      "SELECT module, action, record_scope FROM shared.permissions WHERE role_id = $1", [ROLE_ID],
    );
    console.log("[2] Permissions on role:", perms.length ? `✔ ${perms.map(p => `${p.module}:${p.action}(${p.record_scope})`).join(", ")}` : "✗ NONE — re-run migration manually");

    const { rows: user } = await client.query(
      "SELECT user_id, email, status FROM shared.users WHERE email = $1", [EMAIL],
    );
    console.log("[3] User account:", user.length ? `✔ EXISTS (status: ${user[0].status})` : "✗ MISSING — run: npm run seed:factory-manager");

    if (user.length) {
      const { rows: assignment } = await client.query(
        `SELECT r.role_name, ur.business FROM shared.user_roles ur
         JOIN shared.roles r ON r.role_id = ur.role_id
         WHERE ur.user_id = $1`, [user[0].user_id],
      );
      console.log("[4] Role assignment:", assignment.length
        ? `✔ ${assignment.map(a => `${a.role_name} on '${a.business}'`).join(", ")}`
        : "✗ NO ROLES ASSIGNED — seed failed partway; run seed script again");

      if (assignment.length) {
        const businesses = assignment.map(a => a.business);
        console.log("\n>>> Login tip: after entering credentials, select one of these entities:", businesses.join(", "));
      }
    }

    console.log("");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("✗ DB error:", e.message); process.exit(1); });
