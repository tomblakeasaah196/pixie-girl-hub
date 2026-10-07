"use strict";

// The collections / cash-collected embedded-PostgreSQL coverage (the audited
// production snapshot, the Outstanding Balance and Partially Paid filters, the
// collections summary reconciliation and the Cash Collected MTD window) runs in
// a plain Node process: Jest's VM cannot load PGlite's Wasm module. Failures
// carry the node:test TAP output here.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("Sales collections + Cash Collected KPI — real SQL under PGlite", () => {
  const check = spawnSync(
    process.execPath,
    [
      "--test",
      path.resolve(
        __dirname,
        "../../helpers/sales-collections-pglite.node.cjs",
      ),
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (check.error || check.status !== 0)
    throw new Error(
      `${check.error?.message ?? ""}\n${check.stdout}\n${check.stderr}`,
    );
  // Guard against a silently empty run.
  if (!/# pass 10\b/.test(check.stdout))
    throw new Error(`expected 10 passing cases\n${check.stdout}`);
  if (!/# fail 0\b/.test(check.stdout)) throw new Error(check.stdout);
}, 150_000);
