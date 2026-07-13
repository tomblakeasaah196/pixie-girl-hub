/**
 * Short looping video clips ("living images") for the storefront.
 *
 * Takes one raw upload (phone .mp4/.mov, screen capture, whatever) plus the
 * operator's trim window and crop choice from Storefront Studio, and produces
 * a web-ready loop set:
 *
 *   loop-hd.mp4   H.264, long edge ≤1280, CRF 22 slow  — the default source
 *   loop-sd.mp4   H.264, long edge ≤720,  CRF 27       — poor-network fallback
 *   poster.jpg    first frame of the clip, HD-sized     — instant paint
 *
 * Both renditions are silent (-an): the storefront plays them like a GIF
 * (autoplay/muted/loop/playsinline), and stripping audio is also what lets
 * mobile browsers autoplay at all. The filter chain gently denoises and
 * sharpens after scaling, so a compressed phone video comes out looking
 * cleaner than it went in while the file gets dramatically smaller.
 *
 * Clip length is capped at MAX_CLIP_SECONDS server-side regardless of what
 * the client asks for. All the geometry maths (trim clamping, crop rects,
 * even-dimension scaling) lives in pure functions so it can be unit-tested
 * without FFmpeg.
 */

"use strict";

const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { config } = require("../config/env");
const { logger } = require("../config/logger");
const { AppError } = require("../utils/errors");
const storage = require("./storage.service");

/**
 * Hard cap on the loop length. The storefront hero plays the full clip on
 * desktop (fat bandwidth) and trims playback to the first ~12s on mobile, so
 * 20s gives the cinematic desktop loop without bloating the mobile first paint
 * (which also has the SD rendition). Kept in one place so the trim clamp, the
 * admin trim studio and the copy stay in agreement.
 */
const MAX_CLIP_SECONDS = 20;
/** Shortest clip that still reads as a loop rather than a flicker. */
const MIN_CLIP_SECONDS = 0.5;

/** Output renditions. `edge` caps the LONG edge (never upscaled). */
const RENDITIONS = {
  hd: { edge: 1280, crf: 22, preset: "slow" },
  sd: { edge: 720, crf: 27, preset: "medium" },
};

/** Crop aspects the Studio offers. "original" = no crop. */
const ASPECTS = {
  original: null,
  "16:9": 16 / 9,
  "4:3": 4 / 3,
  "1:1": 1,
  "4:5": 4 / 5,
  "9:16": 9 / 16,
};

/* ── pure geometry helpers (unit-tested) ─────────────────────── */

const even = (n) => Math.max(2, 2 * Math.floor(n / 2));
// Offsets may be zero — only dimensions need the ≥2 floor.
const evenOffset = (n) => Math.max(0, 2 * Math.floor(n / 2));

/**
 * Clamp a requested trim window to the source duration and the clip cap.
 * Returns { start, duration } in seconds. A missing/garbage window falls
 * back to "first MAX_CLIP_SECONDS of the video".
 */
function clampTrim({ duration_sec, trim_start, trim_end }) {
  const total = Number(duration_sec);
  if (!Number.isFinite(total) || total <= 0) {
    throw new AppError("BAD_VIDEO", "The video has no readable duration", 422, {
      user_message:
        "We couldn't read that video's length. Try re-exporting it as MP4 and uploading again.",
    });
  }
  let start = Number(trim_start);
  let end = Number(trim_end);
  if (!Number.isFinite(start) || start < 0) start = 0;
  start = Math.min(start, Math.max(0, total - MIN_CLIP_SECONDS));
  if (!Number.isFinite(end) || end <= start) end = total;
  end = Math.min(end, total);
  let duration = end - start;
  duration = Math.min(duration, MAX_CLIP_SECONDS);
  duration = Math.max(duration, Math.min(MIN_CLIP_SECONDS, total));
  return {
    start: Math.round(start * 1000) / 1000,
    duration: Math.round(duration * 1000) / 1000,
  };
}

/**
 * Crop rect for an aspect key + focus (0..1 along the cropped axis;
 * 0.5 = centre). Returns { x, y, w, h } in even pixels, or null when no crop
 * is needed (aspect "original"/unknown, or already at the target ratio).
 */
function cropRect({ width, height, aspect, focus }) {
  const ratio = ASPECTS[aspect];
  if (!ratio || !width || !height) return null;
  const f = Number.isFinite(Number(focus))
    ? Math.min(1, Math.max(0, Number(focus)))
    : 0.5;
  const current = width / height;
  if (Math.abs(current - ratio) < 0.01) return null;
  let w, h, x, y;
  if (current > ratio) {
    // Source is wider than the target: crop the sides.
    h = even(height);
    w = even(height * ratio);
    x = evenOffset(Math.round(f * (width - w)));
    y = 0;
  } else {
    // Source is taller: crop top/bottom.
    w = even(width);
    h = even(width / ratio);
    x = 0;
    y = evenOffset(Math.round(f * (height - h)));
  }
  // Keep the rect inside the frame after even-rounding.
  x = Math.min(x, width - w);
  y = Math.min(y, height - h);
  return { x: Math.max(0, x), y: Math.max(0, y), w, h };
}

/** Fit (w,h) inside a long-edge cap without upscaling; even dimensions. */
function fitScale({ width, height, edge }) {
  const long = Math.max(width, height);
  const s = long > edge ? edge / long : 1;
  return { width: even(Math.round(width * s)), height: even(Math.round(height * s)) };
}

/**
 * Turn a probe result + operator choices into a full processing plan.
 * Pure — no FFmpeg, no IO.
 */
function planClip({ source, trim_start, trim_end, aspect, focus }) {
  const trim = clampTrim({
    duration_sec: source.duration_sec,
    trim_start,
    trim_end,
  });
  // Rotated phone video: the display frame is the swapped coded frame.
  const swap = Math.abs(source.rotation || 0) % 180 === 90;
  const width = swap ? source.height : source.width;
  const height = swap ? source.width : source.height;
  if (!width || !height) {
    throw new AppError("BAD_VIDEO", "The file has no video stream", 422, {
      user_message: "That file doesn't contain a video we can read.",
    });
  }
  const crop = cropRect({ width, height, aspect, focus });
  const frame = crop ? { width: crop.w, height: crop.h } : { width, height };
  const outputs = {};
  for (const [name, r] of Object.entries(RENDITIONS)) {
    outputs[name] = { ...fitScale({ ...frame, edge: r.edge }), crf: r.crf, preset: r.preset };
  }
  // Only resample when the source runs faster than 30fps — duplicating a
  // 24fps clip up to 30 would just add judder and bytes.
  const capFps = Number(source.fps) > 31;
  return { trim, crop, outputs, capFps };
}

/* ── FFmpeg wrappers ─────────────────────────────────────────── */

function run(bin, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      child = spawn(bin, args);
    } catch (err) {
      reject(new Error(`${bin} spawn failed: ${err.message}`));
      return;
    }
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => reject(new Error(`${bin} not runnable: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-600)}`));
    });
  });
}

/** Probe → { duration_sec, width, height, fps, rotation }. */
async function probeClip(absPath) {
  const out = await run(config.FFPROBE_PATH, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    absPath,
  ]);
  const meta = JSON.parse(out);
  const video = (meta.streams || []).find((s) => s.codec_type === "video");
  if (!video) {
    throw new AppError("BAD_VIDEO", "The file has no video stream", 422, {
      user_message: "That file doesn't contain a video we can read.",
    });
  }
  const duration = Number(
    (meta.format && meta.format.duration) || video.duration,
  );
  // Rotation lives either in a display-matrix side data entry or a tag.
  let rotation = 0;
  for (const sd of video.side_data_list || []) {
    if (sd.rotation !== undefined && sd.rotation !== null)
      rotation = Number(sd.rotation) || 0;
  }
  if (!rotation && video.tags && video.tags.rotate) {
    rotation = Number(video.tags.rotate) || 0;
  }
  let fps = null;
  if (video.avg_frame_rate && video.avg_frame_rate !== "0/0") {
    const [n, d] = video.avg_frame_rate.split("/").map(Number);
    if (n && d) fps = n / d;
  }
  return {
    duration_sec: Number.isFinite(duration) ? duration : null,
    width: video.width || null,
    height: video.height || null,
    fps,
    rotation,
  };
}

/** Build the -vf chain for a rendition: crop → scale → fps → clean-up. */
function filterChain({ crop, out, capFps }) {
  const parts = [];
  if (crop) parts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  parts.push(`scale=${out.width}:${out.height}:flags=lanczos`);
  if (capFps) parts.push("fps=30");
  // Light temporal denoise kills phone-camera grain (the big byte-eater on
  // re-encode), then a gentle unsharp restores perceived crispness at the
  // new size — this is the "compress AND look better" half of the brief.
  parts.push("hqdn3d=1.5:1.5:6:6");
  parts.push("unsharp=5:5:0.4:5:5:0.0");
  parts.push("format=yuv420p");
  return parts.join(",");
}

async function encodeRendition({ inAbs, outAbs, trim, crop, out, capFps }) {
  await run(config.FFMPEG_PATH, [
    "-y",
    "-ss",
    String(trim.start),
    "-t",
    String(trim.duration),
    "-i",
    inAbs,
    "-vf",
    filterChain({ crop, out, capFps }),
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    out.preset,
    "-crf",
    String(out.crf),
    "-profile:v",
    "high",
    "-movflags",
    "+faststart",
    outAbs,
  ]);
}

/** Poster = the clip's first frame, cropped/scaled like the HD rendition. */
async function extractPoster({ inAbs, outAbs, trim, crop, out }) {
  const parts = [];
  if (crop) parts.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`);
  parts.push(`scale=${out.width}:${out.height}:flags=lanczos`);
  await run(config.FFMPEG_PATH, [
    "-y",
    "-ss",
    String(trim.start),
    "-i",
    inAbs,
    "-frames:v",
    "1",
    "-vf",
    parts.join(","),
    "-q:v",
    "3",
    outAbs,
  ]);
}

/* ── the one entry point ─────────────────────────────────────── */

/**
 * Process a raw uploaded video into a storefront loop set and store it.
 *
 * @param {object} p
 * @param {string} p.brand           pixiegirl | faitlynhair
 * @param {string} p.inputPath      absolute path of the raw upload on disk
 * @param {number} [p.trim_start]   seconds
 * @param {number} [p.trim_end]     seconds
 * @param {string} [p.aspect]       original | 16:9 | 4:3 | 1:1 | 4:5 | 9:16
 * @param {number} [p.focus]        0..1 along the cropped axis (0.5 centre)
 * @returns {Promise<{url, sd_url, poster_url, width, height, duration_sec, bytes}>}
 */
async function processClip({ brand, inputPath, trim_start, trim_end, aspect, focus }) {
  let source;
  try {
    source = await probeClip(inputPath);
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err: err.message }, "video probe failed");
    throw new AppError("BAD_VIDEO", "Could not read that video", 422, {
      user_message:
        "We couldn't read that video file. Try exporting it as MP4 and uploading again.",
    });
  }

  const plan = planClip({ source, trim_start, trim_end, aspect, focus });
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sf-clip-"));
  const tmp = (name) => path.join(tmpDir, name);

  try {
    await encodeRendition({
      inAbs: inputPath,
      outAbs: tmp("loop-hd.mp4"),
      trim: plan.trim,
      crop: plan.crop,
      out: plan.outputs.hd,
      capFps: plan.capFps,
    });
    await encodeRendition({
      inAbs: inputPath,
      outAbs: tmp("loop-sd.mp4"),
      trim: plan.trim,
      crop: plan.crop,
      out: plan.outputs.sd,
      capFps: plan.capFps,
    });
    await extractPoster({
      inAbs: inputPath,
      outAbs: tmp("poster.jpg"),
      trim: plan.trim,
      crop: plan.crop,
      out: plan.outputs.hd,
    });

    const dir = `storefront/${brand}/video/${crypto.randomBytes(9).toString("hex")}`;
    const [hdBuf, sdBuf, posterBuf] = await Promise.all([
      fs.readFile(tmp("loop-hd.mp4")),
      fs.readFile(tmp("loop-sd.mp4")),
      fs.readFile(tmp("poster.jpg")),
    ]);
    const [hd, sd, poster] = await Promise.all([
      storage.put(hdBuf, { key: `${dir}/loop-hd.mp4`, contentType: "video/mp4" }),
      storage.put(sdBuf, { key: `${dir}/loop-sd.mp4`, contentType: "video/mp4" }),
      storage.put(posterBuf, { key: `${dir}/poster.jpg`, contentType: "image/jpeg" }),
    ]);

    return {
      url: hd.public_url,
      sd_url: sd.public_url,
      poster_url: poster.public_url,
      width: plan.outputs.hd.width,
      height: plan.outputs.hd.height,
      duration_sec: plan.trim.duration,
      bytes: { hd: hdBuf.length, sd: sdBuf.length, poster: posterBuf.length },
    };
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err: err.message, brand }, "video clip processing failed");
    throw new AppError("VIDEO_PROCESSING_FAILED", "Video processing failed", 422, {
      user_message:
        "We couldn't process that video. Try a shorter MP4 clip, or re-export it and upload again.",
    });
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = {
  processClip,
  probeClip,
  // pure helpers exported for unit tests
  planClip,
  clampTrim,
  cropRect,
  fitScale,
  MAX_CLIP_SECONDS,
  MIN_CLIP_SECONDS,
  RENDITIONS,
  ASPECTS,
};
