#!/usr/bin/env node
/**
 * Assert a Jest `--json` unit run against an explicit pre-existing-failure
 * allowlist.
 *
 * Why this exists: `npm run test:unit` is NOT green on main. Three suites were
 * already failing before the PXG Care & Accessories work started (two
 * Praxis-AI SQL-agent call-count expectations and a Babel/Jest factory error in
 * the currency suite). A CI gate that simply runs the suite would be
 * permanently red, and a permanently red gate gets ignored — which is worse
 * than no gate. A gate that `continue-on-error`s everything is worthless too.
 *
 * So: the known-bad suites are quarantined BY NAME, in one visible place, and
 * everything else must pass. Any NEW failure fails the build. If a quarantined
 * suite starts passing, the run warns so the entry can be deleted rather than
 * silently rotting into a place to hide future breakage.
 *
 * Usage: node scripts/ci/assert-unit-results.mjs <jest-json-file>
 */

"use strict";

import fs from "node:fs";

// Pre-existing failures on main as of the PR 3 baseline (2026-09-24), verified
// with `npm run test:unit -- --runInBand`:
//   Test Suites: 3 failed, 273 passed, 276 total
//   Tests:       2 failed, 2431 passed, 2433 total
// These are NOT this feature's to fix. Each entry needs a reason — an
// unexplained allowlist entry is how real breakage gets buried.
const KNOWN_FAILING_SUITES = [
  {
    // "an unhandled non-sql tool call triggers synthesis, not a preamble dump"
    // expects 2 LLM calls, gets 3 — a Praxis-AI prompt-chain expectation that
    // drifted from the implementation.
    suite: "tests/unit/praxis_ai/sql-agent-chain.test.js",
    reason: "pre-existing Praxis-AI call-count expectation drift",
  },
  {
    suite: "tests/unit/praxis_ai/sql-agent-fallback.test.js",
    reason: "pre-existing Praxis-AI SQL-agent fallback expectations",
  },
  {
    // Fails during Babel transform / Jest module-factory resolution, before any
    // assertion runs — a suite-level harness error, not a behavioural one.
    suite: "tests/unit/services/currency-service.test.js",
    reason: "pre-existing Jest module-factory error at transform time",
  },
];

const normalise = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");

function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: assert-unit-results.mjs <jest-json-file>");
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`✖ no Jest JSON report at ${file}`);
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`✖ could not parse ${file}: ${err.message}`);
    process.exit(2);
  }

  const results = Array.isArray(report.testResults) ? report.testResults : [];
  if (!results.length) {
    console.error("✖ the Jest report contains no suites — nothing actually ran.");
    process.exit(2);
  }

  const root = normalise(report.rootDir || process.cwd());
  const rel = (p) => {
    const n = normalise(p);
    return n.startsWith(root) ? n.slice(root.length).replace(/^\//, "") : n;
  };

  const failed = results
    .filter((r) => r.status === "failed")
    .map((r) => rel(r.name));
  const passed = results.filter((r) => r.status === "passed").map((r) => rel(r.name));

  const allowed = new Set(KNOWN_FAILING_SUITES.map((k) => normalise(k.suite)));
  const unexpected = failed.filter((f) => !allowed.has(normalise(f)));
  const nowPassing = [...allowed].filter(
    (a) => !failed.some((f) => normalise(f) === a) && passed.some((p) => normalise(p) === a),
  );
  const notRun = [...allowed].filter(
    (a) => !failed.some((f) => normalise(f) === a) && !passed.some((p) => normalise(p) === a),
  );

  console.log(
    `Suites: ${results.length} total · ${passed.length} passed · ${failed.length} failed`,
  );
  console.log(
    `Tests:  ${report.numTotalTests} total · ${report.numPassedTests} passed · ${report.numFailedTests} failed`,
  );

  if (failed.length) {
    console.log("\nFailing suites:");
    for (const f of failed) {
      const entry = KNOWN_FAILING_SUITES.find((k) => normalise(k.suite) === normalise(f));
      console.log(`  ${entry ? "· known  " : "✖ NEW   "} ${f}${entry ? ` — ${entry.reason}` : ""}`);
    }
  }

  if (nowPassing.length) {
    console.log("\n⚠ quarantined suite(s) now PASS — delete the allowlist entry:");
    for (const s of nowPassing) console.log(`    ${s}`);
  }
  if (notRun.length) {
    console.log("\n⚠ allowlisted suite(s) did not run at all (renamed or deleted?):");
    for (const s of notRun) console.log(`    ${s}`);
  }

  if (unexpected.length) {
    console.error(
      `\n✖ ${unexpected.length} suite(s) failed that are NOT in the pre-existing allowlist:`,
    );
    for (const s of unexpected) console.error(`    ${s}`);
    console.error(
      "\nFix these, or — only with an explicit, reasoned decision — add them to\n" +
        "KNOWN_FAILING_SUITES in scripts/ci/assert-unit-results.mjs.",
    );
    process.exit(1);
  }

  console.log(
    `\n✔ unit gate satisfied (${allowed.size} known pre-existing failure(s) quarantined by name)`,
  );
  process.exit(0);
}

main();
