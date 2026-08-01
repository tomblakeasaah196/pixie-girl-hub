/**
 * Background cut-out — isolate the subject of a catalogue photo onto
 * transparency for the "branded background" feature. The heavy step (subject
 * segmentation) runs here; the client then composites the returned cut-out over
 * the chosen brand colour on a canvas, so switching colours is instant.
 *
 * Engine policy:
 *   1. AI — a self-hosted segmentation model (@imgly/background-removal-node),
 *           run in an ISOLATED CHILD PROCESS. The native onnxruntime engine and
 *           sharp (libvips) corrupt each other's heap when loaded in the same
 *           process — "munmap_chunk(): invalid pointer", a hard core dump that
 *           no JS try/catch can catch. Running the model in a child that never
 *           loads sharp both fixes the crash AND means any failure there can
 *           only kill the child, never the backend — we fall back to the keyer.
 *           Optional; opt out with BG_REMOVAL_AI=off.
 *   2. alpha — the upload already carries transparency; respect it untouched.
 *   3. keyer — best-effort corner-colour key (flat, solid backdrops only),
 *           flagged so the UI can say so.
 *
 * Pure-ish: takes a decodable image buffer, returns a PNG buffer + metadata.
 * HEIC normalisation and storage wiring live in the caller.
 */

"use strict";

const os = require("os");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const sharp = require("sharp");
const { hasAlpha, keyOutBackground } = require("./icon-pipeline.service");
const { logger } = require("../config/logger");

// Longest-edge cap for the cut-out. Catalogue tiles/galleries never need more,
// and it keeps the transparent PNG (returned to the browser as a data URL, and
// the final composited file) light for the Nigeria-first, mobile-heavy audience.
const CUTOUT_MAX_EDGE = 1600;

// The isolated worker + how long we let it run before giving up on it.
const AI_CHILD = path.join(__dirname, "..", "..", "scripts", "bg-removal-child.js");
const AI_TIMEOUT_MS = 45000;

// Log the engine's (un)availability / failures ONCE per distinct state, not on
// every upload; re-logs when the state changes so a new problem is never hidden.
let aiEngineNote = null;
function noteOnce(key, level, obj, msg) {
  if (aiEngineNote === key) return;
  aiEngineNote = key;
  logger[level](obj, msg);
}

function aiOptedOut() {
  return String(process.env.BG_REMOVAL_AI || "").toLowerCase() === "off";
}

/**
 * Is the AI engine usable? `require.resolve` only resolves the PATH — it does
 * NOT execute the module, so onnxruntime is never loaded in this (sharp-owning)
 * process. Actual inference always happens in the child.
 */
function aiEngineEnabled() {
  if (aiOptedOut()) return false;
  try {
    require.resolve("@imgly/background-removal-node");
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the AI cut-out in an isolated child process. Input is a PNG buffer (the
 * caller, which owns sharp, encodes it). Returns a transparent PNG buffer, or
 * null on ANY failure (missing engine, child crash, timeout) — the caller then
 * falls back. Never throws; never crashes the parent.
 */
async function tryAiCutout(pngBuffer) {
  if (!aiEngineEnabled()) {
    if (!aiOptedOut()) {
      noteOnce(
        "missing",
        "warn",
        {},
        "AI background-removal engine not resolvable — using the keyer " +
          "fallback. Install @imgly/background-removal-node in the app's " +
          "node_modules and restart.",
      );
    }
    return null;
  }

  const stamp = crypto.randomBytes(8).toString("hex");
  const inPath = path.join(os.tmpdir(), `bgrm-${stamp}.in.png`);
  const outPath = path.join(os.tmpdir(), `bgrm-${stamp}.out.png`);
  try {
    await fs.writeFile(inPath, pngBuffer);
    const ok = await new Promise((resolve) => {
      const child = spawn(process.execPath, [AI_CHILD, inPath, outPath], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      const errChunks = [];
      let settled = false;
      const finish = (value, failNote) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (failNote) {
          noteOnce(`fail:${failNote}`, "error", { err: failNote }, "AI " +
            "background removal failed in the worker — using the keyer fallback.");
        }
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(false, "timeout after 45s");
      }, AI_TIMEOUT_MS);
      child.stderr.on("data", (d) => errChunks.push(d));
      child.on("error", (e) => finish(false, `spawn: ${e.message}`));
      child.on("close", (code, signal) => {
        if (code === 0) return finish(true);
        const detail = Buffer.concat(errChunks).toString().slice(0, 400);
        finish(false, `exit code=${code} signal=${signal} ${detail}`.trim());
      });
    });
    if (!ok) return null;
    const out = await fs.readFile(outPath);
    noteOnce("ready", "info", {}, "AI background-removal engine is active");
    return out;
  } catch (err) {
    noteOnce(
      `fail:${err.message}`,
      "error",
      { err: err.message },
      "AI background removal failed — using the keyer fallback.",
    );
    return null;
  } finally {
    fs.unlink(inPath).catch(() => {});
    fs.unlink(outPath).catch(() => {});
  }
}

/**
 * Isolate the subject of an image onto transparency.
 *
 * @param {Buffer} input  decodable image bytes (HEIC already normalised upstream)
 * @returns {Promise<{
 *   buffer: Buffer, engine: 'ai'|'alpha'|'keyer', keyed: boolean,
 *   warning: string|null, width: number|null, height: number|null
 * }>}
 */
async function isolateSubject(input) {
  if (!Buffer.isBuffer(input) || input.length === 0) {
    throw new Error("isolateSubject: an image buffer is required");
  }

  // Downscale + honour EXIF orientation first, so both the engine and the
  // returned payload stay light. Format is preserved so the alpha check below
  // can still see real transparency.
  const pre = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(CUTOUT_MAX_EDGE, CUTOUT_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  let cut = null;
  let engine;
  let keyed = false;
  let warning = null;

  // 1. AI — encode a PNG HERE (this process owns sharp) and hand it to the
  //    isolated worker (which must never load sharp).
  if (aiEngineEnabled()) {
    const aiPng = await sharp(pre).png().toBuffer();
    cut = await tryAiCutout(aiPng);
    if (cut) engine = "ai";
  }

  // 2/3. Fallbacks — respect existing transparency, else key a flat backdrop.
  if (!cut) {
    if (await hasAlpha(pre)) {
      cut = await sharp(pre).ensureAlpha().png().toBuffer();
      engine = "alpha";
    } else {
      cut = await keyOutBackground(pre);
      engine = "keyer";
      keyed = true;
      warning =
        "The background was removed automatically from a flat backdrop. For a " +
        "clean cut on busy photos (models, real-world scenes), enable the AI " +
        "engine on the server.";
    }
  }

  const meta = await sharp(cut).metadata();
  return {
    buffer: cut,
    engine,
    keyed,
    warning,
    width: meta.width ?? null,
    height: meta.height ?? null,
  };
}

module.exports = {
  isolateSubject,
  tryAiCutout,
  aiEngineEnabled,
  CUTOUT_MAX_EDGE,
};
