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
 *   { brand, recipient_id, sequence: [{...step}, ...] }    — multi-bubble send
 *
 * The `sequence` shape sends every step in ORDER on a single job so IG
 * can't shuffle the bubbles the way it did when each bubble rode its own
 * concurrent job (catalogue shares dropped the tap-to-order link mid-way
 * through the product list). Each step is either { text } or
 * { image_url } / { media_kind, media_url }. The message row is stamped
 * "sent" only after the last step lands; a failed intermediate step
 * marks the row failed and stops the sequence.
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
const {
  extractUrls,
  stripUrls,
  buttonTitleForUrl,
} = require("../../utils/urls");

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

/**
 * True when Meta's rejection looks like the raw-URL bounce. Meta reuses
 * code 508 ("Invalid message id") for both a bad recipient id AND a
 * text message whose body carries a link its filter dislikes, so the
 * caller must ALSO confirm the text contained a URL before treating
 * this as link-blocking (a genuinely bad IGSID fails every send).
 */
function isLinkRejection(err) {
  const metaErr = err && err.meta_error;
  if (metaErr && Number(metaErr.code) === 508) return true;
  return /invalid message id/i.test(String((err && err.message) || ""));
}

/**
 * Re-send a link-carrying text that Meta bounced as a button template —
 * the prose stays as the template text and each URL becomes a tappable
 * web_url button (max 3). Returns the provider response; throws when
 * the template send is rejected too.
 */
async function resendAsLinkButtons({ data, urls }) {
  return instagram.sendButtonTemplate({
    brand: data.brand,
    recipient_id: data.recipient_id,
    text: stripUrls(data.text, urls),
    buttons: urls.slice(0, 3).map((u) => ({
      url: u,
      title: buttonTitleForUrl(u),
    })),
    tag: data.tag,
  });
}

// What the operator reads on the bubble when even the button-template
// fallback is rejected. Kept explicit — the raw Meta line ("Invalid
// message id — code 508…") told them nothing actionable.
const LINK_BLOCKED_ERROR =
  "Instagram blocked the link in this message — Meta rejected it as raw text " +
  "AND as a link button. This usually clears once the customer follows the " +
  "account or replies again; otherwise move the conversation to WhatsApp.";

/**
 * Send an ordered sequence of IG bubbles under one BullMQ job. Each
 * step is either { text } or { image_url, media_kind? } — the same
 * per-bubble shape a single-send job carries. Awaits each provider
 * call so the customer sees the bubbles in the composer's order.
 *
 * The sequence job is enqueued with attempts=1 (see
 * smartcomm.service.buildOutboundJobsForChannel) — a retry would re-send
 * every bubble that already landed and spam the customer with duplicate
 * product images. Retries come from the operator's Retry button, not
 * from BullMQ.
 *
 * Text steps run the same raw-URL → button-template fallback as the
 * single-send path: Meta blocks plain-text DMs carrying a link with
 * "Invalid message id" (code 508 / subcode 2534122), so the catalogue-
 * share tap-to-order card (which IS a URL) bounced hard. When a text
 * step trips the block, the URL(s) get re-sent as a tappable button
 * template and the sequence continues — the customer gets the order
 * link as an "Order here" button instead of a bounced bubble.
 */
async function sendSequenceStep(step, data) {
  const stepData = {
    brand: data.brand,
    recipient_id: data.recipient_id,
    tag: data.tag,
    ...step,
  };
  if (stepData.image_url && !stepData.media_url) {
    stepData.media_url = stepData.image_url;
    stepData.media_kind = stepData.media_kind || "image";
  }
  if (stepData.media_url) {
    const res = await instagram.sendMedia({
      brand: stepData.brand,
      recipient_id: stepData.recipient_id,
      kind: stepData.media_kind || "image",
      media_url: stepData.media_url,
      tag: stepData.tag,
    });
    return res && (res.message_id || res.recipient_id);
  }
  try {
    const res = await instagram.sendText({
      brand: stepData.brand,
      recipient_id: stepData.recipient_id,
      text: stepData.text,
      tag: stepData.tag,
    });
    return res && (res.message_id || res.recipient_id);
  } catch (err) {
    // Same fallback the single-send path uses. Only fires on genuine
    // link-blocks; anything else (bad token, expired window) bubbles
    // up so the sequence stops and the operator sees the real cause.
    const urls = extractUrls(stepData.text || "");
    if (urls.length === 0 || !isLinkRejection(err)) throw err;
    const res = await resendAsLinkButtons({ data: stepData, urls });
    return res && (res.message_id || res.recipient_id);
  }
}

async function sendSequence(job, data) {
  let lastMid = null;
  try {
    for (const step of data.sequence) {
      lastMid = await sendSequenceStep(step, data);
    }
    if (data.smartcomm_message_id) {
      await smartcomm().applyDeliveryResult({
        message_id: data.smartcomm_message_id,
        delivery_status: "sent",
        external_ref: lastMid ? String(lastMid) : null,
      });
    }
    logger.info(
      {
        jobId: job.id,
        brand: data.brand,
        recipient: data.recipient_id,
        steps: data.sequence.length,
        mid: lastMid,
      },
      "instagram sent (sequence)",
    );
    return { mid: lastMid, steps: data.sequence.length };
  } catch (err) {
    logger.error(
      {
        jobId: job.id,
        brand: data.brand,
        recipient: data.recipient_id,
        sequence_len: data.sequence.length,
        meta_error: err.meta_error || null,
        fbtrace_id: (err.meta_error && err.meta_error.fbtrace_id) || null,
        err: err.message,
      },
      "instagram-send: sequence step failed",
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
  // Multi-bubble catalogue share: send each step in order on this one
  // job so the customer receives image → name → image → name → order-
  // link in the sequence the composer emitted. See the `sequence` block
  // in smartcomm.service.buildOutboundJobsForChannel for why per-bubble
  // jobs were shuffling.
  if (Array.isArray(data.sequence) && data.sequence.length > 0) {
    return await sendSequence(job, data);
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
    // Raw-URL bounce: Meta rejects plain text DMs that carry a link
    // (code 508 / "Invalid message id" — the customer's YouTube tip or
    // our own onboarding-form link). Links ARE deliverable as button
    // templates, so retry the same message once with the URL(s) as
    // tappable buttons before declaring failure.
    const wasTextSend = !data.media_url && !data.image_url && data.text;
    const urls = wasTextSend ? extractUrls(data.text) : [];
    if (urls.length > 0 && isLinkRejection(err)) {
      try {
        const res = await resendAsLinkButtons({ data, urls });
        const mid = res && (res.message_id || res.recipient_id);
        if (data.smartcomm_message_id) {
          await smartcomm().applyDeliveryResult({
            message_id: data.smartcomm_message_id,
            delivery_status: "sent",
            external_ref: mid ? String(mid) : null,
          });
        }
        logger.info(
          {
            jobId: job.id,
            brand: data.brand,
            recipient: data.recipient_id,
            urls,
            mid,
          },
          "instagram-send: raw link bounced — delivered as button template",
        );
        return { mid, link_button_fallback: true };
      } catch (err2) {
        logger.error(
          {
            jobId: job.id,
            brand: data.brand,
            recipient: data.recipient_id,
            urls,
            meta_error: err2.meta_error || null,
            err: err2.message,
          },
          "instagram-send: button-template fallback rejected too",
        );
        if (data.smartcomm_message_id) {
          await smartcomm().applyDeliveryResult({
            message_id: data.smartcomm_message_id,
            delivery_status: "failed",
            delivery_error: LINK_BLOCKED_ERROR,
          });
        }
        throw err2;
      }
    }
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
