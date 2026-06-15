/**
 * Speech-to-text (Whisper) for Praxis voice input (§6.29 / §8.2). Env-driven and
 * OFF by default — mirrors embeddings/sms. With nothing configured `transcribe`
 * returns null, so the voice path degrades to whatever text the client sent.
 *
 *   TRANSCRIPTION_PROVIDER=none|openai|self_hosted
 *   TRANSCRIPTION_API_KEY=...           TRANSCRIPTION_MODEL=whisper-1
 *   TRANSCRIPTION_API_BASE_URL=...      (OpenAI-compatible /audio/transcriptions)
 *
 * SSRF guard: only audio URLs under the app's own origin (APP_URL) or a
 * configured MEDIA_BASE_URL are fetched — never an arbitrary client-supplied URL.
 */

"use strict";

const axios = require("axios");
const { URL } = require("url");
const FormData = require("form-data");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

const DEFAULT_BASE = "https://api.openai.com/v1";

function isConfigured() {
  return (
    config.TRANSCRIPTION_PROVIDER &&
    config.TRANSCRIPTION_PROVIDER !== "none" &&
    Boolean(config.TRANSCRIPTION_API_KEY)
  );
}

function model() {
  return config.TRANSCRIPTION_MODEL || "whisper-1";
}

/** Only fetch audio from our own media origin(s) — blocks SSRF via user URLs. */
function isAllowedAudioUrl(url) {
  const allowed = [config.MEDIA_BASE_URL, config.APP_URL].filter(Boolean);
  if (!allowed.length) return false;
  try {
    const u = new URL(url);
    return allowed.some((base) => {
      try {
        return new URL(base).origin === u.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * Transcribe audio at a trusted internal URL. Returns text, or null when
 * unconfigured / disallowed / on failure (caller falls back gracefully).
 * @param {{audioUrl:string}} args
 */
async function transcribe({ audioUrl }) {
  if (!isConfigured() || !audioUrl) return null;
  if (!isAllowedAudioUrl(audioUrl)) {
    logger.warn(
      { audioUrl },
      "transcription skipped — audio URL not in allowlist",
    );
    return null;
  }
  try {
    const base = (config.TRANSCRIPTION_API_BASE_URL || DEFAULT_BASE).replace(
      /\/$/,
      "",
    );
    const audio = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    const form = new FormData();
    form.append("file", Buffer.from(audio.data), {
      filename: "audio",
      contentType: audio.headers["content-type"] || "application/octet-stream",
    });
    form.append("model", model());
    const { data } = await axios.post(`${base}/audio/transcriptions`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${config.TRANSCRIPTION_API_KEY}`,
      },
      timeout: 60000,
      maxBodyLength: Infinity,
    });
    return (data && (data.text || data.transcript)) || null;
  } catch (err) {
    logger.error({ err: err.message }, "transcription failed");
    return null;
  }
}

module.exports = { isConfigured, model, transcribe };
