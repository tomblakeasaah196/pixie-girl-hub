"use strict";

// PR 3's embedded-PostgreSQL coverage (retail order links, the /o order-form
// checkout, the manual delivery-fee review lifecycle, Studio bypass and
// wig-only / FLH regressions) runs in a plain Node process: Jest's VM cannot
// load PGlite's Wasm module. Failures carry the node:test TAP output here.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

test("PXG care PR 3 — real SQL order links / /o checkout / delivery-fee review under PGlite", () => {
  const check = spawnSync(
    process.execPath,
    ["--test", path.resolve(__dirname, "../../helpers/care-pr3-pglite.node.cjs")],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (check.error || check.status !== 0)
    throw new Error(`${check.error?.message ?? ""}\n${check.stdout}\n${check.stderr}`);
  // Guard against a silently empty run.
  if (!/# pass 16\b/.test(check.stdout)) throw new Error(`expected 16 passing cases\n${check.stdout}`);
  if (!/# fail 0\b/.test(check.stdout)) throw new Error(check.stdout);
}, 150_000);
