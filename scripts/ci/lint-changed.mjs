#!/usr/bin/env node
/**
 * Scoped ESLint for CI — report only problems on lines THIS change touched.
 *
 * Why not just `eslint <changed files>`:
 *   This repository carries substantial pre-existing lint debt. `sales.service.js`
 *   alone has an `eqeqeq` error and four `no-shadow`/`no-unused-vars` warnings on
 *   lines that are byte-identical at HEAD. A job that lints whole changed files
 *   would be permanently red the moment anyone touches a large existing module,
 *   and a permanently red job gets ignored. "Fix the legacy debt in the same PR"
 *   is also not free: `settings.friend_discount_value != null` is an intentional
 *   null-OR-undefined test, and rewriting it to satisfy `eqeqeq` risks changing
 *   behaviour in an unrelated referral path.
 *
 * So the gate is precise instead of blunt: an ESLint message counts only when its
 * line falls inside a range this change added or modified. New code must be
 * clean; untouched legacy lines are reported as informational, not as failures.
 *
 * Usage:
 *   node scripts/ci/lint-changed.mjs <base-ref> <eslint-config-dir> [file...]
 *   node scripts/ci/lint-changed.mjs origin/main . src/a.js apps/admin/src/b.tsx
 *
 * Files under a directory with its own flat ESLint config (apps/admin) are linted
 * from that directory so its tseslint + react-hooks rules apply.
 */

"use strict";

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function sh(args, opts = {}) {
  try {
    return execFileSync(args[0], args.slice(1), {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      ...opts,
    });
  } catch (err) {
    // eslint exits 1 when it finds problems; that is a result, not a failure.
    if (err.stdout) return err.stdout;
    throw err;
  }
}

/** Added/modified line ranges per file, from a unified diff with no context. */
function changedLines(baseRef) {
  const diff = sh([
    "git",
    "diff",
    "--unified=0",
    "--no-color",
    "--diff-filter=ACMR",
    baseRef,
    "HEAD",
  ]);
  const ranges = new Map();
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      if (!ranges.has(file)) ranges.set(file, []);
      continue;
    }
    if (!file || !line.startsWith("@@")) continue;
    // @@ -a,b +c,d @@ — we want the NEW-file side.
    const m = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!m) continue;
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    if (count > 0) ranges.get(file).push([start, start + count - 1]);
  }
  return ranges;
}

const inRanges = (ranges, line) =>
  ranges.some(([a, b]) => line >= a && line <= b);

/** Lint one batch of files from `cwd` and return ESLint's JSON report. */
function runEslint(cwd, relFiles) {
  if (!relFiles.length) return [];
  const out = sh(
    [
      "npx",
      "eslint",
      "--format",
      "json",
      "--no-error-on-unmatched-pattern",
      ...relFiles,
    ],
    { cwd },
  );
  try {
    return JSON.parse(out || "[]");
  } catch {
    console.error(`Could not parse ESLint JSON from ${cwd}`);
    return [];
  }
}

function main() {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error("usage: lint-changed.mjs <base-ref> [file...]");
    process.exit(2);
  }
  const files = process.argv.slice(3);
  if (!files.length) {
    console.log("No lintable files changed — nothing to do.");
    process.exit(0);
  }

  const ranges = changedLines(baseRef);

  // Group by the nearest directory that owns an ESLint config, so apps/admin is
  // linted with its own tseslint + react-hooks rules rather than the root
  // commonjs config.
  const hasConfig = (dir) =>
    ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs"].some((f) =>
      fs.existsSync(path.join(dir, f)),
    );
  const groups = new Map();
  for (const f of files) {
    if (!fs.existsSync(path.join(ROOT, f))) continue; // deleted or generated
    let dir = path.dirname(path.join(ROOT, f));
    while (dir !== ROOT && !hasConfig(dir)) dir = path.dirname(dir);
    const rel = path.relative(dir, path.join(ROOT, f));
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(rel);
  }

  let scopedErrors = 0;
  let scopedWarnings = 0;
  let legacyErrors = 0;
  let legacyWarnings = 0;

  for (const [dir, relFiles] of groups) {
    const report = runEslint(dir, relFiles);
    for (const result of report) {
      const rel = path.relative(ROOT, result.filePath);
      const fileRanges = ranges.get(rel) || [];
      for (const m of result.messages || []) {
        const scoped = fileRanges.length > 0 && inRanges(fileRanges, m.line || 0);
        const label = `${rel}:${m.line}:${m.column}  ${m.ruleId || "?"}  ${m.message}`;
        if (scoped) {
          if (m.severity === 2) {
            scopedErrors += 1;
            console.error(`  ✖ NEW ERROR   ${label}`);
          } else {
            scopedWarnings += 1;
            console.warn(`  ⚠ NEW WARNING ${label}`);
          }
        } else if (m.severity === 2) {
          legacyErrors += 1;
          console.log(`  · pre-existing error on an untouched line: ${label}`);
        } else {
          legacyWarnings += 1;
        }
      }
    }
  }

  console.log(
    `\nScoped to changed lines: ${scopedErrors} error(s), ${scopedWarnings} warning(s).`,
  );
  console.log(
    `Pre-existing on untouched lines: ${legacyErrors} error(s), ${legacyWarnings} warning(s) — recorded, not gated.`,
  );

  if (scopedErrors > 0) {
    console.error(
      "\n✖ New ESLint errors on lines this change touched. Fix them before merging.",
    );
    process.exit(1);
  }
  console.log("\n✔ scoped lint clean");
  process.exit(0);
}

main();
