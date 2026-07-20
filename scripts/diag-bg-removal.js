#!/usr/bin/env node
"use strict";

/* eslint-disable no-console */

/*
 * Diagnose the isolated AI background-removal worker.
 *
 * Generates a test PNG with sharp (in THIS process), then runs
 * scripts/bg-removal-child.js in a SEPARATE process — which loads onnxruntime
 * but never sharp, exactly as production does. Reports a precise verdict so
 * there's no guesswork. Run it FROM the app directory:
 *
 *   npm run diag:bg-removal
 *
 * Exit codes: 0 = works · 1 = engine not installed · 2 = worker failed.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const sharp = require("sharp");

const CHILD = path.join(__dirname, "bg-removal-child.js");

(async () => {
  console.log("node   :", process.version, `(${process.platform}/${process.arch})`);
  console.log("cwd    :", process.cwd());
  try {
    console.log("engine :", require.resolve("@imgly/background-removal-node"));
  } catch {
    console.error(
      "\n✗ @imgly/background-removal-node is not installed here — run `npm install` and retry.",
    );
    process.exit(1);
  }

  const sub = await sharp({
    create: { width: 60, height: 60, channels: 3, background: "#c86432" },
  })
    .png()
    .toBuffer();
  const png = await sharp({
    create: { width: 160, height: 160, channels: 3, background: "#4a6ea9" },
  })
    .composite([{ input: sub, top: 50, left: 50 }])
    .png()
    .toBuffer();

  const stamp = crypto.randomBytes(6).toString("hex");
  const inPath = path.join(os.tmpdir(), `diag-${stamp}.in.png`);
  const outPath = path.join(os.tmpdir(), `diag-${stamp}.out.png`);
  fs.writeFileSync(inPath, png);

  const t = Date.now();
  const errChunks = [];
  const child = spawn(process.execPath, [CHILD, inPath, outPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (d) => errChunks.push(d));
  child.on("close", (code, signal) => {
    try {
      if (code === 0) {
        const out = fs.readFileSync(outPath);
        console.log(
          `\n✓ removal OK (isolated worker) — ${out.length} bytes, ${Date.now() - t}ms`,
        );
        console.log(
          "The AI engine runs cleanly in its own process. Branded uploads use it;",
        );
        console.log(
          "if it ever fails it falls back to the keyer without touching the backend.",
        );
      } else {
        console.error(`\n✗ worker FAILED — exit code=${code} signal=${signal}`);
        const detail = Buffer.concat(errChunks).toString().trim();
        if (detail) console.error(detail);
        console.error(
          "\nThe isolated worker still can't run onnxruntime on this host — self-hosted",
        );
        console.error(
          "AI isn't viable here. Paste this and we'll switch to a hosted removal API.",
        );
      }
    } finally {
      try {
        fs.unlinkSync(inPath);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(outPath);
      } catch {
        /* ignore */
      }
      process.exit(code === 0 ? 0 : 2);
    }
  });
})().catch((e) => {
  console.error("diag error:", e.stack || e.message);
  process.exit(3);
});
