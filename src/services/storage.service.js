/**
 * File storage abstraction (V2.2 §8 — self-hosted, no S3/Cloudinary).
 *
 * Local filesystem storage today; the interface stays stable so we can
 * swap implementations later without touching modules.
 *
 * Methods:
 *   put(buffer, { key, contentType })  → { key, public_url, size }
 *   get(key)                            → Buffer
 *   delete(key)                         → void
 *   signedUrl(key, ttl)                 → string  (for temporary access)
 */

"use strict";

const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { config } = require("../config/env");

/** Build the public URL for a stored key (used by put() and by callers that
 *  already hold a stored file's key, e.g. document dedup reuse). */
function publicUrl(key) {
  return config.CDN_BASE_URL ? `${config.CDN_BASE_URL}/${key}` : `/media/${key}`;
}

async function put(buffer, { key, contentType }) {
  const finalKey = key || crypto.randomBytes(16).toString("hex");
  const filePath = path.join(config.STORAGE_LOCAL_ROOT, finalKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buffer);
  return {
    key: finalKey,
    public_url: publicUrl(finalKey),
    size: buffer.length,
    content_type: contentType,
  };
}

async function get(key) {
  return fs.readFile(path.join(config.STORAGE_LOCAL_ROOT, key));
}

async function del(key) {
  await fs.unlink(path.join(config.STORAGE_LOCAL_ROOT, key));
}

module.exports = { put, get, delete: del, publicUrl };
