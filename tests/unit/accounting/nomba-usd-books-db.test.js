"use strict";

// Nomba NGN/USD books under real SQL: migrations 000390/000391 (+ template
// 000098), the USD wallet journal line, a parked USD reconciliation row, the
// ledger sweep's webhook bridge and USD suggestions. Runs in a plain Node
// process: Jest's VM cannot load PGlite's Wasm module.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("Nomba USD wallet + reconciliation currency — real SQL under PGlite", () => {
  const check = spawnSync(
    process.execPath,
    ["--test", path.resolve(__dirname, "../../helpers/nomba-usd-books-pglite.node.cjs")],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (check.error || check.status !== 0)
    throw new Error(`${check.error?.message ?? ""}\n${check.stdout}\n${check.stderr}`);
  // Guard against a silently empty run.
  if (!/# pass 7\b/.test(check.stdout)) throw new Error(`expected 7 passing cases\n${check.stdout}`);
  if (!/# fail 0\b/.test(check.stdout)) throw new Error(check.stdout);
}, 150_000);
