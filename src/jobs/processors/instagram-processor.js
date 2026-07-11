/**
 * BullMQ processor: instagram-send (J-2).
 *
 * Sends one Instagram Messenger DM via services/instagram.service. Durable
 * async path for smartcomm: provider 5xx/rate limits retry instead of
 * losing the message inline.
 *
 * Expected job.data:
 *   { brand, recipient_id, text }                          — free-form (in 24h window)
 *   { brand, recipient_id, text, tag: 'HUMAN_AGENT' }      — outside-window
 *   { brand, recipient_id, image_url }                     — image (legacy shape)
 *   { brand, recipient_id, media_kind, media_url }         — image|audio|video
 *
 * `brand` is REQUIRED — every send resolves the per-brand IG token
 * from shared.messaging_accounts. A job missing brand fails fast
 * (surfaced to the queue's dead-letter view rather than silently
 * sending from the wrong account).
 *
 * The processor stamps the provider mid back onto the smartcomm row
 * and flips delivery_status from queued → sent.
 */

"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const instagram = require("../../services/instagram.service");
const storage = require("../../services/storage.service");
const ffmpeg = require("./media.ffmpeg");
const { logger } = require("../../config/logger");

// Audio formats Instagram DM attachments accept as-is (aac/m4a/wav/mp4).
// Anything else (notably the browser's webm/opus voice note) must be
// transcoded or Meta rejects it with code 100, subcode 2534080.
const IG_AUDIO_OK = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
]);

/**
 * Transcode a stored voice note to m4a (AAC) and re-host it, returning the
 * new public URL that Meta can fetch. Returns null when the source is
 * already an accepted format (send as-is) or when we don't hold the
 * storage key. Throws only if the transcode itself fails — the caller
 * falls back to sending the note as a downloadable link.
 */
async function transcodeIgAudio({ media_key, source_mime }) {
  if (!media_key) return null;
  if (source_mime && IG_AUDIO_OK.has(String(source_mime).toLowerCase())) {
    return null;
  }
  const stamp = crypto.randomBytes(8).toString("hex");
  const inAbs = path.join(os.tmpdir(), `igaudio-${stamp}.in`);
  const outAbs = path.join(os.tmpdir(), `igaudio-${stamp}.m4a`);
  try {
    const buf = await storage.get(media_key);
    await fs.writeFile(inAbs, buf);
    await ffmpeg.transcodeAudioToAac(inAbs, outAbs);
    const outBuf = await fs.readFile(outAbs);
    const outKey = `${media_key}.m4a`;
    await storage.put(outBuf, { key: outKey, contentType: "audio/mp4" });
    return storage.absoluteUrl(outKey) || null;
  } finally {
    fs.unlink(inAbs).catch(() => {});
    fs.unlink(outAbs).catch(() => {});
  }
}

// Delivery outcomes route through the service (not the repo) so the
// status change also emits message.edited — the operator's open thread
// flips the tick/error icon live instead of on the next poll.
function smartcomm() {
  return require("../../modules/smartcomm/smartcomm.service");
}

module.exports = async function process(job) {
  const data = job.data || {};
  if (!data.recipient_id) {
    logger.warn(
      { jobId: job.id },
      "instagram-send: missing recipient_id — skipping",
    );
    return { skipped: true };
  }
  if (!data.brand) {
    logger.error(
      { jobId: job.id },
      "instagram-send: missing 'brand' — every send needs a brand context",
    );
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: "IG_SEND_BRAND_REQUIRED",
      });
    }
    throw new Error("IG_SEND_BRAND_REQUIRED");
  }
  if (!(await instagram.isConfigured({ brand: data.brand }))) {
    logger.warn(
      { jobId: job.id, brand: data.brand },
      "instagram-send: brand has no IG config on file — skipping",
    );
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: "IG_NOT_CONFIGURED",
      });
    }
    return { skipped: true };
  }
  // Voice notes: convert the browser's webm/opus recording to an
  // Instagram-accepted m4a before sending. If transcoding isn't available
  // (no ffmpeg), degrade gracefully to a downloadable link so the note
  // still reaches the customer instead of failing outright.
  if (data.media_kind === "audio" && data.media_url) {
    const originalUrl = data.media_url;
    try {
      const converted = await transcodeIgAudio({
        media_key: data.media_key,
        source_mime: data.source_mime,
      });
      if (converted) data.media_url = converted;
    } catch (err) {
      logger.warn(
        { jobId: job.id, brand: data.brand, err: err.message },
        "instagram-send: voice-note transcode failed — sending as link",
      );
      data.media_url = null;
      data.media_key = undefined;
      data.text = `🎤 Voice note: ${originalUrl}`;
    }
  }
  try {
    let res;
    if (data.media_url) {
      res = await instagram.sendMedia({
        brand: data.brand,
        recipient_id: data.recipient_id,
        kind: data.media_kind || "image",
        media_url: data.media_url,
        tag: data.tag,
      });
    } else if (data.image_url) {
      // Legacy job shape (pre media_kind) — jobs already queued keep working.
      res = await instagram.sendImage({
        brand: data.brand,
        recipient_id: data.recipient_id,
        image_url: data.image_url,
        tag: data.tag,
      });
    } else {
      res = await instagram.sendText({
        brand: data.brand,
        recipient_id: data.recipient_id,
        text: data.text,
        tag: data.tag,
      });
    }
    const mid = res && (res.message_id || res.recipient_id);
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "sent",
        external_ref: mid ? String(mid) : null,
      });
    }
    logger.info(
      { jobId: job.id, brand: data.brand, recipient: data.recipient_id, mid },
      "instagram sent",
    );
    return { mid };
  } catch (err) {
    // instagram.service already unwrapped Meta's structured error, so
    // err.message names the real cause ("Invalid OAuth access token",
    // "(#10) … outside of allowed window", …) — that's what the operator
    // sees on the failed bubble. Log the FULL Meta error body (code,
    // subcode, fbtrace_id) alongside the recipient so ambiguous rejections
    // (e.g. code 508 / subcode 2534122 "Invalid message id") are
    // diagnosable from the logs instead of guessed at.
    logger.error(
      {
        jobId: job.id,
        brand: data.brand,
        recipient: data.recipient_id,
        media_kind: data.media_kind || null,
        had_tag: data.tag || null,
        meta_error: err.meta_error || null,
        fbtrace_id: (err.meta_error && err.meta_error.fbtrace_id) || null,
        err: err.message,
      },
      "instagram-send: delivery failed",
    );
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "failed",
        delivery_error: String(err.message || err).slice(0, 1000),
      });
    }
    throw err;
  }
};
