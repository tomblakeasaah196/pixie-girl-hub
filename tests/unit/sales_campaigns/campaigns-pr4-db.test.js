"use strict";

// PGlite must run in a plain Node process; this Jest wrapper makes the PR 4
// real-SQL campaign/bundle/incentive/first-wig/FLH suite part of CI.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test(
  "PXG Care PR 4 — real SQL campaign, bundle, incentive and FLH edge cases",
  () => {
    const check = spawnSync(
      process.execPath,
      ["--test", path.resolve(__dirname, "../../helpers/care-pr4-pglite.node.cjs")],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (check.error || check.status !== 0) {
      throw new Error(`${check.error?.message ?? ""}\n${check.stdout}\n${check.stderr}`);
    }
    if (!/# pass 6\b/.test(check.stdout)) {
      throw new Error(`expected 6 passing PR 4 SQL cases\n${check.stdout}`);
    }
    if (!/# fail 0\b/.test(check.stdout)) throw new Error(check.stdout);
  },
  150_000,
);
