/**
 * Background cut-out — isolate the subject of a catalogue photo onto
 * transparency so the upload modal can drop it onto a brand-colour backdrop
 * (the "branded background" feature). The heavy step (subject segmentation)
 * runs here on the server; the client then composites the returned cut-out
 * over the chosen brand colour with a canvas, so switching colours is instant.
 *
 * Engine policy (agreed with product — mirrors the icon-pipeline stance):
 *   1. AI  — a self-hosted segmentation model (@imgly/background-removal-node).
 *            Clean cut on ANY photo (models, busy backgrounds). Optional +
 *            lazy-loaded: the app boots and this feature still works (via the
 *            keyer) even if the native model isn't installed on the box, so a
 *            failed native build never destabilises the platform. Install the
 *            package on the server to light this path up.
 *   2. alpha — the upload already carries transparency; respect it untouched.
 *   3. keyer — best-effort corner-colour key. Only sound for a product shot on
 *            a flat, solid backdrop; we flag it so the UI can say so.
 *
 * Pure-ish: takes a decodable image buffer, returns a PNG buffer + metadata.
 * HEIC normalisation and storage wiring live in the caller.
 */

"use strict";

const { Blob } = require("buffer");
const sharp = require("sharp");
const { hasAlpha, keyOutBackground } = require("./icon-pipeline.service");
const { logger } = require("../config/logger");

// Longest-edge cap for the cut-out. Catalogue tiles/galleries never need more,
// and it keeps the transparent PNG (returned to the browser as a data URL, and
// the final composited file) light for the Nigeria-first, mobile-heavy audience.
const CUTOUT_MAX_EDGE = 1600;

// Remember why the AI engine is (un)available so the reason is logged ONCE, not
// on every upload. It re-logs whenever the state changes (e.g. ready → failing),
// so a genuinely new problem is never swallowed.
let aiEngineNote = null;

/**
 * Try the optional self-hosted AI segmentation engine. Returns a transparent
 * PNG buffer, or null if the engine isn't installed or fails — the caller then
 * falls back to the corner keyer. Never throws.
 *
 * Both failure modes are now logged (loudly, with the real error) so a server
 * that installed the engine but can't run it is diagnosable from the logs:
 *   • require fails  → the package isn't resolvable from the app's node_modules
 *   • inference fails → it loads but can't run (native onnxruntime / model asset)
 */
async function tryAiCutout(buffer) {
  let removeBackground;
  try {
    // Lazy + guarded: only pulled when present. Declared as an OPTIONAL
    // dependency so `npm ci`/CI stay green even where the native build fails.
    ({ removeBackground } = require("@imgly/background-removal-node"));
  } catch (err) {
    if (aiEngineNote !== `require:${err.message}`) {
      aiEngineNote = `require:${err.message}`;
      logger.warn(
        { err: err.message },
        "AI background-removal engine could not be loaded (require failed) — " +
          "using the keyer fallback. Ensure @imgly/background-removal-node is " +
          "installed in the app's node_modules and the app was restarted.",
      );
    }
    return null;
  }
  try {
    // @imgly can't sniff a raw Buffer — it throws "Unsupported format" — so
    // hand it a typed PNG Blob, giving its decoder an unambiguous MIME type.
    const png = await sharp(buffer).png().toBuffer();
    const source = new Blob([png], { type: "image/png" });
    const blob = await removeBackground(source, {
      output: { format: "image/png" },
    });
    const ab = await blob.arrayBuffer();
    if (aiEngineNote !== "ready") {
      aiEngineNote = "ready";
      logger.info("AI background-removal engine is active");
    }
    return Buffer.from(ab);
  } catch (err) {
    if (aiEngineNote !== `infer:${err.message}`) {
      aiEngineNote = `infer:${err.message}`;
      logger.error(
        { err: err.stack || err.message },
        "AI background removal failed at inference — using the keyer fallback. " +
          "This usually means the native onnxruntime binary cannot load on this " +
          "host, or the model assets cannot be read.",
      );
    }
    return null;
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
  // returned payload stay light.
  const pre = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(CUTOUT_MAX_EDGE, CUTOUT_MAX_EDGE, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  let engine;
  let keyed = false;
  let warning = null;
  let cut;

  const ai = await tryAiCutout(pre);
  if (ai) {
    cut = ai;
    engine = "ai";
  } else if (await hasAlpha(pre)) {
    // Already transparent — keep it exactly as uploaded.
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
  CUTOUT_MAX_EDGE,
};
