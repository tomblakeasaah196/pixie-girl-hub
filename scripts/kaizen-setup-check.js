#!/usr/bin/env node
"use strict";

/**
 * Kaizen backup readiness check. Run on the origin box after §10.4 setup:
 *   node scripts/kaizen-setup-check.js
 *
 * Asserts that rclone, restic, pg_dump/pg_restore are present, the rclone remote
 * is reachable (`rclone about`), the restic repo answers (`restic snapshots`),
 * and the sudoers full-backup trigger exists. Prints a green/red checklist and
 * exits non-zero if anything critical is missing. No secrets are printed.
 */

require("dotenv").config();

const fs = require("fs");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const E = process.env;
const RCLONE = E.KAIZEN_RCLONE_BIN || "rclone";
const RESTIC = E.KAIZEN_RESTIC_BIN || "restic";
const PGDUMP = E.KAIZEN_PGDUMP_BIN || "pg_dump";
const PGRESTORE = E.KAIZEN_PGRESTORE_BIN || "pg_restore";
const REMOTE = E.KAIZEN_RCLONE_REMOTE || "gdrive-crypt:";
const FULLBACKUP_CMD = E.KAIZEN_FULLBACKUP_CMD || "/usr/local/bin/kaizen-fullbackup";

const results = [];
function ok(name, detail = "") { results.push({ name, ok: true, detail }); }
function bad(name, detail = "") { results.push({ name, ok: false, detail }); }

async function version(bin, args = ["version"]) {
  const { stdout, stderr } = await execFileP(bin, args, { timeout: 20000 });
  return (stdout || stderr || "").split("\n")[0].trim();
}

async function main() {
  // 1. Binaries present.
  for (const [label, bin, args] of [
    ["rclone", RCLONE, ["version"]],
    ["restic", RESTIC, ["version"]],
    ["pg_dump", PGDUMP, ["--version"]],
    ["pg_restore", PGRESTORE, ["--version"]],
  ]) {
    try {
      ok(`${label} installed`, await version(bin, args));
    } catch (e) {
      bad(`${label} installed`, e.message.split("\n")[0]);
    }
  }

  // 2. rclone remote reachable.
  try {
    const remoteBase = REMOTE.replace(/:.*/, ":");
    const { stdout } = await execFileP(RCLONE, ["about", "--json", remoteBase], { timeout: 60000 });
    const about = JSON.parse(stdout || "{}");
    const freeGb = about.free != null ? (about.free / 1073741824).toFixed(1) : "?";
    ok(`rclone remote reachable (${remoteBase})`, `free ~${freeGb} GB`);
  } catch (e) {
    bad("rclone remote reachable", e.message.split("\n")[0]);
  }

  // 3. restic repo answers.
  if (E.KAIZEN_RESTIC_REPOSITORY && (E.KAIZEN_RESTIC_PASSWORD || E.RESTIC_PASSWORD)) {
    try {
      const { stdout } = await execFileP(RESTIC, ["snapshots", "--json"], {
        env: {
          ...process.env,
          RESTIC_REPOSITORY: E.KAIZEN_RESTIC_REPOSITORY,
          RESTIC_PASSWORD: E.KAIZEN_RESTIC_PASSWORD || E.RESTIC_PASSWORD,
        },
        timeout: 120000,
      });
      const snaps = JSON.parse(stdout || "[]");
      ok("restic repo reachable", `${snaps.length} snapshot(s)`);
    } catch (e) {
      bad("restic repo reachable", e.message.split("\n")[0]);
    }
  } else {
    bad("restic repo reachable", "KAIZEN_RESTIC_REPOSITORY / password not set");
  }

  // 4. sudoers full-backup trigger present + runnable.
  if (fs.existsSync(FULLBACKUP_CMD)) {
    ok("full-backup wrapper present", FULLBACKUP_CMD);
  } else {
    bad("full-backup wrapper present", `${FULLBACKUP_CMD} not found`);
  }
  try {
    // `sudo -n -l` lists allowed commands without prompting.
    const { stdout } = await execFileP("sudo", ["-n", "-l"], { timeout: 15000 });
    if (stdout.includes(FULLBACKUP_CMD)) ok("sudoers NOPASSWD trigger", "whitelisted");
    else bad("sudoers NOPASSWD trigger", "wrapper not in sudo -l output");
  } catch (e) {
    bad("sudoers NOPASSWD trigger", e.message.split("\n")[0]);
  }

  // 5. staging dir writable.
  const staging = E.KAIZEN_BACKUP_STAGING_DIR || "/var/backups/kaizen/staging";
  try {
    fs.mkdirSync(staging, { recursive: true });
    fs.accessSync(staging, fs.constants.W_OK);
    ok("staging dir writable", staging);
  } catch (e) {
    bad("staging dir writable", e.message.split("\n")[0]);
  }

  // ── Report ──
  let failed = 0;
  process.stdout.write("\nKaizen backup readiness:\n\n");
  for (const r of results) {
    const mark = r.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
    if (!r.ok) failed += 1;
    process.stdout.write(`  ${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ""}\n`);
  }
  process.stdout.write(
    failed === 0
      ? "\n\x1b[32mAll checks passed.\x1b[0m\n"
      : `\n\x1b[31m${failed} check(s) failed.\x1b[0m Fix these before relying on backups.\n`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`\nsetup-check crashed: ${err.message}\n`);
  process.exit(1);
});
