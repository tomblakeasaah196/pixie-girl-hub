"use strict";

// Jest's VM cannot load PGlite's Wasm dynamic module without opt-in flags.
// Run the real embedded PostgreSQL fixture in a plain Node process. Its
// node:test assertions and TAP output are retained on any failure.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("PXG/FLH embedded PostgreSQL upgrade, repair replay and fail-closed triggers", () => {
  const check = spawnSync(process.execPath, ["--test", path.resolve(__dirname, "../../helpers/care-migration-pglite.node.cjs")], {
    encoding: "utf8", timeout: 45_000,
  });
  if (check.error || check.status !== 0) throw new Error(`${check.error?.message ?? ""}\n${check.stdout}\n${check.stderr}`);
}, 60_000);
