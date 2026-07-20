#!/usr/bin/env node
"use strict";

/* eslint-disable no-console */

/**
 * Diagnose the self-hosted AI background-removal engine.
 *
 * Answers what the logs alone can't: does removeBackground() actually RUN on
 * THIS host, from THIS folder's node_modules — or does it fall back to the
 * keyer, and if so, with exactly what error? Run it FROM the app directory:
 *
 *   npm run diag:bg-removal
 *
 * Exit codes: 0 = AI works · 1 = require failed · 2 = inference failed.
 */

const { Blob } = require("buffer");
const sharp = require("sharp");

(async () => {
  console.log("node    :", process.version, `(${process.platform}/${process.arch})`);
  console.log("cwd     :", process.cwd());

  let removeBackground;
  try {
    ({ removeBackground } = require("@imgly/background-removal-node"));
    console.log(
      "require : OK →",
      require.resolve("@imgly/background-removal-node"),
    );
  } catch (err) {
    console.error("\n✗ require FAILED —", err.message);
    console.error(
      "  The engine is not resolvable from this folder's node_modules.",
    );
    console.error(
      "  Fix: run `npm install @imgly/background-removal-node` HERE, then restart the app.",
    );
    process.exit(1);
  }

  // A busy-ish synthetic image: a subject block sitting on a coloured field.
  const subject = await sharp({
    create: { width: 220, height: 220, channels: 3, background: "#c86432" },
  })
    .png()
    .toBuffer();
  const img = await sharp({
    create: { width: 560, height: 560, channels: 3, background: "#4a6ea9" },
  })
    .composite([{ input: subject, top: 170, left: 170 }])
    .jpeg()
    .toBuffer();

  try {
    const t = Date.now();
    // Feed a typed PNG Blob — a raw Buffer throws "Unsupported format".
    const source = new Blob([await sharp(img).png().toBuffer()], {
      type: "image/png",
    });
    const blob = await removeBackground(source, {
      output: { format: "image/png" },
    });
    const out = Buffer.from(await blob.arrayBuffer());
    const meta = await sharp(out).metadata();
    console.log(
      `\n✓ removal OK — ${out.length} bytes, ${meta.width}x${meta.height}, alpha=${meta.hasAlpha}, ${Date.now() - t}ms`,
    );
    console.log(
      "The AI engine works here. If the app still shows the keyer warning, the app",
    );
    console.log(
      "process is likely on a DIFFERENT node/binary than this shell — compare",
    );
    console.log(
      "`pm2 describe <app>` node version with `node -v`, then restart it under the same node.",
    );
  } catch (err) {
    console.error("\n✗ removal FAILED at inference:\n", err.stack || err.message);
    console.error(
      "\nThe package loads but cannot run — typically the native onnxruntime binary",
    );
    console.error(
      "cannot load on this host, or the model assets cannot be read. Paste this whole",
    );
    console.error("error back and it can be fixed precisely.");
    process.exit(2);
  }
})();
