/**
 * Local-disk backup destination — same interface as destinations/rclone.js but
 * against a local directory (no rclone needed). Used as a fallback and as the
 * staging area. Artifacts here are NOT encrypted, so a local destination is only
 * appropriate for a trusted, access-controlled volume (or as staging before an
 * rclone crypt upload).
 */

"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { config } = require("../../../../config/env");

function baseDir() {
  return config.KAIZEN_LOCAL_BACKUP_DIR || config.KAIZEN_BACKUP_STAGING_DIR || "/var/backups/kaizen/local";
}

function resolve(...parts) {
  return path.join(baseDir(), ...parts.map((p) => String(p).replace(/^\/+/, "")));
}

async function copyto(localPath, destRel) {
  const dest = resolve(destRel);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.copyFile(localPath, dest);
  return { stdout: "", stderr: "" };
}

async function download(srcRel, localPath) {
  await fsp.mkdir(path.dirname(localPath), { recursive: true });
  await fsp.copyFile(resolve(srcRel), localPath);
  return { stdout: "", stderr: "" };
}

async function lsjson(dirRel) {
  const dir = resolve(dirRel);
  try {
    const names = await fsp.readdir(dir);
    return Promise.all(
      names.map(async (Name) => {
        const st = await fsp.stat(path.join(dir, Name));
        return { Name, Size: st.size, ModTime: st.mtime.toISOString(), IsDir: st.isDirectory() };
      }),
    );
  } catch {
    return [];
  }
}

async function del(relPath) {
  await fsp.rm(resolve(relPath), { force: true });
  return { stdout: "", stderr: "" };
}

async function about() {
  // No cheap cross-platform free-space without a syscall; return unknown.
  return {};
}

async function verifySize(relFile, expectedBytes) {
  try {
    const st = fs.statSync(resolve(relFile));
    if (expectedBytes != null && st.size !== Number(expectedBytes)) {
      return { ok: false, reason: `size mismatch: ${st.size} vs ${expectedBytes}` };
    }
    return { ok: true, size: st.size };
  } catch {
    return { ok: false, reason: "artifact not found after copy" };
  }
}

function remotePath(_remote, ...parts) {
  return parts.filter(Boolean).join("/");
}

module.exports = { remotePath, copyto, download, lsjson, del, about, verifySize };
