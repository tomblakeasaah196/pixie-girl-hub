"use strict";

// PR 2's embedded-PostgreSQL coverage runs in a plain Node process: Jest's VM
// cannot load PGlite's Wasm dynamic module without opt-in flags. The helper
// keeps node:test assertions, so any failure carries its TAP output here.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("PXG care typed sales — real SQL cart/resolver/createOrder/checkout under PGlite", () => {
  const check = spawnSync(
    process.execPath,
    ["--test", path.resolve(__dirname, "../../helpers/care-sales-pglite.node.cjs")],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (check.error || check.status !== 0)
    throw new Error(`${check.error?.message ?? ""}\n${check.stdout}\n${check.stderr}`);
}, 150_000);
