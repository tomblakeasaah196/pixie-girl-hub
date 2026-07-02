#!/usr/bin/env node
/**
 * File-naming convention check (CLAUDE.md: files are kebab-case.js or
 * snake_case.js, CONSISTENT WITHIN A MODULE).
 *
 * Enforced per directory under src/modules and src/shared: a directory may
 * use hyphens or underscores in its .js names, but not both, and names must
 * be lowercase. Two pre-existing mixed directories are grandfathered — do
 * not add new mixing to them, and do not extend this list; new modules must
 * pick one style.
 *
 * Runs as part of `npm run lint` (see package.json → lint:naming).
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOTS = ["src/modules", "src/shared"];

// Pre-existing mixed directories (kebab + snake side by side). Warn, don't
// fail — renaming files churns every require and belongs to its own change.
const GRANDFATHERED = new Set([
  path.normalize("src/modules/catalogue"),
  path.normalize("src/shared/hr_payroll"),
]);

function walk(dir, out = []) {
  out.push(dir);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), out);
  }
  return out;
}

let failed = false;

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const dir of walk(root)) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".js"));
    if (!files.length) continue;

    const uppercase = files.filter((f) => /[A-Z]/.test(f));
    if (uppercase.length) {
      failed = true;
      console.error(
        `✖ ${dir}: filenames must be lowercase → ${uppercase.join(", ")}`,
      );
    }

    const kebab = files.filter((f) => f.includes("-"));
    const snake = files.filter((f) => f.includes("_"));
    if (kebab.length && snake.length) {
      if (GRANDFATHERED.has(path.normalize(dir))) {
        console.warn(
          `⚠ ${dir}: mixes kebab-case and snake_case (grandfathered — do not add more)`,
        );
        continue;
      }
      failed = true;
      console.error(
        `✖ ${dir}: mixes kebab-case and snake_case .js filenames — pick ONE style per module\n` +
          `    kebab: ${kebab.join(", ")}\n` +
          `    snake: ${snake.join(", ")}`,
      );
    }
  }
}

if (failed) {
  console.error(
    "\nFile-naming check failed (CLAUDE.md → Conventions → Naming).",
  );
  process.exit(1);
}
console.log("file naming ok");
