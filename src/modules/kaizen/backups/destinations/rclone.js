/**
 * Thin wrapper over the `rclone` CLI. We NEVER string-concat a shell command —
 * always execFile with an args array (no shell = no injection). rclone is the
 * universal transport: one tool, 70+ providers, native crypt for
 * encryption-at-rest. Swapping providers later = `rclone config` a new remote
 * and change the destination's `rclone_remote` in Kaizen settings — no code.
 *
 * The remote (e.g. 'gdrive-crypt:') is configured once on the box via
 * `rclone config`; credentials live in the rclone config file, never here.
 *
 * See guide §7.6.
 */

"use strict";

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileP = promisify(execFile);

const { config } = require("../../../../config/env");

function bin() {
  return config.KAIZEN_RCLONE_BIN || "rclone";
}

/** Join a remote + prefix + path into 'remote:prefix/path' (no double slashes). */
function remotePath(remote, ...parts) {
  const clean = parts
    .filter(Boolean)
    .map((p) => String(p).replace(/^\/+|\/+$/g, ""))
    .join("/");
  return `${remote}${clean}`;
}

async function run(args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  const { stdout, stderr } = await execFileP(bin(), args, {
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout, stderr };
}

/** Upload a single local file to <remote:dest>. */
async function copyto(localPath, dest, opts) {
  return run(["copyto", localPath, dest], opts);
}

/** Download <remote:src> to a local file. */
async function download(src, localPath, opts) {
  return run(["copyto", src, localPath], opts);
}

/** List a remote path as JSON (array of { Name, Size, ModTime, ... }). */
async function lsjson(remoteDir, { recursive = false } = {}) {
  const args = ["lsjson"];
  if (recursive) args.push("--recursive");
  args.push(remoteDir);
  const { stdout } = await run(args, { timeoutMs: 5 * 60 * 1000 });
  try {
    return JSON.parse(stdout || "[]");
  } catch {
    return [];
  }
}

/** Delete a remote file/path. */
async function del(remotePathStr) {
  return run(["delete", remotePathStr], { timeoutMs: 5 * 60 * 1000 });
}

/** Free/used/total for a remote (feeds the storage meter). */
async function about(remote) {
  const { stdout } = await run(["about", "--json", remote], {
    timeoutMs: 60 * 1000,
  });
  try {
    return JSON.parse(stdout || "{}"); // { total, used, free, trashed }
  } catch {
    return {};
  }
}

/** Verify an uploaded artifact exists and matches expected size. */
async function verifySize(remoteFile, expectedBytes) {
  const parent = remoteFile.replace(/\/[^/]+$/, "");
  const name = remoteFile.split("/").pop();
  const listing = await lsjson(parent);
  const hit = listing.find((e) => e.Name === name);
  if (!hit) return { ok: false, reason: "artifact not found after upload" };
  if (expectedBytes != null && Number(hit.Size) !== Number(expectedBytes)) {
    return { ok: false, reason: `size mismatch: ${hit.Size} vs ${expectedBytes}` };
  }
  return { ok: true, size: hit.Size };
}

module.exports = {
  remotePath,
  copyto,
  download,
  lsjson,
  del,
  about,
  verifySize,
  _run: run,
};
