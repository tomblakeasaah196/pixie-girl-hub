#!/usr/bin/env node
"use strict";

/*
 * Isolated AI background-removal worker.
 *
 * Runs in its OWN process so the native onnxruntime engine never shares memory
 * with sharp (libvips) — that pairing corrupts the heap and hard-crashes the
 * whole process with "munmap_chunk(): invalid pointer" (a core dump no JS
 * try/catch can catch). This worker MUST NOT require sharp.
 *
 * Contract: read a PNG from <inPath>, write the cut-out PNG to <outPath>.
 *   node bg-removal-child.js <inPath> <outPath>
 * Exit 0 = success; non-zero (or a crash signal) = the caller falls back.
 */

const fs = require("fs");
const { Blob } = require("buffer");

(async () => {
  const inPath = process.argv[2];
  const outPath = process.argv[3];
  if (!inPath || !outPath) {
    process.stderr.write("usage: bg-removal-child.js <in.png> <out.png>");
    process.exit(2);
  }
  const input = fs.readFileSync(inPath);
  // Required here (not sharp): this process exists precisely to load the native
  // engine in isolation from sharp.
  const { removeBackground } = require("@imgly/background-removal-node");
  const blob = await removeBackground(new Blob([input], { type: "image/png" }), {
    output: { format: "image/png" },
  });
  fs.writeFileSync(outPath, Buffer.from(await blob.arrayBuffer()));
})().catch((e) => {
  process.stderr.write(String((e && (e.stack || e.message)) || e));
  process.exit(1);
});
