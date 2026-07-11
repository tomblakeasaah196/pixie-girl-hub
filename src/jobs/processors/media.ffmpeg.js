/**
 * FFmpeg / FFprobe helpers for the media pipeline (V2.2 §6.4 self-hosted
 * video). Thin wrappers over the binaries at config.FFMPEG_PATH /
 * config.FFPROBE_PATH. All paths are ABSOLUTE filesystem paths (callers
 * resolve them under STORAGE_LOCAL_ROOT).
 */

"use strict";

const { spawn } = require("child_process");
const { config } = require("../../config/env");

/** Run a binary, resolving stdout (or rejecting with stderr) on exit. */
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
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) =>
      reject(new Error(`${bin} not runnable: ${err.message}`)),
    );
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/** Probe a media file → { duration_sec, width, height }. */
async function probe(absPath) {
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
  const duration =
    meta.format && meta.format.duration ? Number(meta.format.duration) : null;
  return {
    duration_sec: Number.isFinite(duration) ? duration : null,
    width: video ? video.width : null,
    height: video ? video.height : null,
  };
}

/** Transcode to a web-friendly H.264/AAC MP4, capped at 720p, faststart. */
async function transcodeVideo(inAbs, outAbs) {
  await run(config.FFMPEG_PATH, [
    "-y",
    "-i",
    inAbs,
    "-vcodec",
    "libx264",
    "-crf",
    "23",
    "-preset",
    "medium",
    "-vf",
    "scale='min(1280,iw)':-2",
    "-acodec",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outAbs,
  ]);
}

/**
 * Transcode any audio input (typically a browser voice note recorded as
 * webm/opus) to AAC in an MP4/M4A container. Instagram DM audio
 * attachments only accept aac/m4a/wav/mp4 — a webm/opus note is rejected
 * with "attachment format is not supported" (code 100, subcode 2534080).
 * `-vn` drops any video track; 96 kbps mono-friendly AAC is plenty for
 * speech and stays well under Meta's 25 MB cap.
 */
async function transcodeAudioToAac(inAbs, outAbs) {
  await run(config.FFMPEG_PATH, [
    "-y",
    "-i",
    inAbs,
    "-vn",
    "-acodec",
    "aac",
    "-b:a",
    "96k",
    "-movflags",
    "+faststart",
    outAbs,
  ]);
}

/** Extract a single still frame (used for poster + thumbnail). */
async function extractFrame(inAbs, outAbs, { atSec = 1, height = 720 } = {}) {
  await run(config.FFMPEG_PATH, [
    "-y",
    "-ss",
    String(atSec),
    "-i",
    inAbs,
    "-frames:v",
    "1",
    "-vf",
    `scale=-2:${height}`,
    outAbs,
  ]);
}

module.exports = { run, probe, transcodeVideo, transcodeAudioToAac, extractFrame };
