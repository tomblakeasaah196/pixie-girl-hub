/**
 * Speech-to-text (Whisper) for Praxis/CoS voice input (§6.29 / §8.2).
 *
 * Config resolution — AI Control is the single source of truth:
 *   1. The `groq` row in AI Control → Vendors & Models (encrypted key,
 *      endpoint, current model — governance.getVendorConfig, which itself
 *      falls back to GROQ_API_KEY from .env when the row has no stored key).
 *   2. Legacy TRANSCRIPTION_* env vars, only when no active groq vendor row
 *      exists at all:
 *        TRANSCRIPTION_PROVIDER=none|openai|groq|self_hosted
 *        TRANSCRIPTION_API_KEY=...           TRANSCRIPTION_MODEL=whisper-1
 *        TRANSCRIPTION_API_BASE_URL=...      (OpenAI-compatible endpoint)
 *
 * With neither configured, `transcribe`/`transcribeBuffer` return null and
 * `isAvailable()` is false — the client then keeps voice input on the
 * browser's Web Speech API (its fallback path).
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
// Same layering as llm.service: shared AI infra reads vendor creds through
// the governance module's internal accessor.
const governance = require("../modules/ai_governance/governance.service");

const DEFAULT_BASE = "https://api.openai.com/v1";
const GROQ_DEFAULT_MODEL = "whisper-large-v3";

function envConfigured() {
  return (
    config.TRANSCRIPTION_PROVIDER &&
    config.TRANSCRIPTION_PROVIDER !== "none" &&
    Boolean(config.TRANSCRIPTION_API_KEY)
  );
}

/**
 * Resolve the effective transcription config: AI Control groq vendor row
 * first, legacy TRANSCRIPTION_* env second, null when neither is usable.
 * @returns {Promise<{provider:string, api_key:string, base_url:string, model:string}|null>}
 */
async function resolveConfig() {
  try {
    const groq = await governance.getVendorConfig({ vendor: "groq" });
    if (groq && groq.api_key) {
      return {
        provider: "groq",
        api_key: groq.api_key,
        base_url: groq.endpoint_url || "https://api.groq.com/openai/v1",
        model: groq.default_model || GROQ_DEFAULT_MODEL,
      };
    }
  } catch (err) {
    // DB hiccup — fall through to env so voice keeps degrading gracefully.
    logger.warn({ err: err.message }, "groq vendor config lookup failed");
  }
  if (envConfigured()) {
    return {
      provider: config.TRANSCRIPTION_PROVIDER,
      api_key: config.TRANSCRIPTION_API_KEY,
      base_url: config.TRANSCRIPTION_API_BASE_URL || DEFAULT_BASE,
      model: config.TRANSCRIPTION_MODEL || "whisper-1",
    };
  }
  return null;
}

/** Is server-side transcription usable right now? (Feeds the client's choice
 *  between recording for the server and browser speech recognition.) */
async function isAvailable() {
  return Boolean(await resolveConfig());
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
 * Transcribe an in-memory audio buffer (the composer's recorded clip).
 * Returns { text, provider, model }, or null when unconfigured / on failure —
 * the HTTP layer turns null into a 503 so the client falls back to the
 * browser recognizer.
 * @param {{buffer:Buffer, contentType?:string, filename?:string}} args
 */
async function transcribeBuffer({ buffer, contentType, filename }) {
  if (!buffer || !buffer.length) return null;
  const cfg = await resolveConfig();
  if (!cfg) return null;
  try {
    const base = cfg.base_url.replace(/\/$/, "");
    const form = new FormData();
    form.append("file", buffer, {
      filename: filename || "audio",
      contentType: contentType || "application/octet-stream",
    });
    form.append("model", cfg.model);
    const { data } = await axios.post(`${base}/audio/transcriptions`, form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${cfg.api_key}`,
      },
      timeout: 60000,
      maxBodyLength: Infinity,
    });
    const text = (data && (data.text || data.transcript)) || null;
    if (!text) return null;
    return { text, provider: cfg.provider, model: cfg.model };
  } catch (err) {
    logger.error(
      { err: err.message, provider: cfg.provider, status: err.response?.status },
      "transcription failed",
    );
    return null;
  }
}

/**
 * Transcribe audio at a trusted internal URL (legacy voice-note path).
 * Returns text, or null when unconfigured / disallowed / on failure.
 * @param {{audioUrl:string}} args
 */
async function transcribe({ audioUrl }) {
  if (!audioUrl) return null;
  if (!(await isAvailable())) return null;
  if (!isAllowedAudioUrl(audioUrl)) {
    logger.warn(
      { audioUrl },
      "transcription skipped — audio URL not in allowlist",
    );
    return null;
  }
  try {
    const audio = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
    });
    const result = await transcribeBuffer({
      buffer: Buffer.from(audio.data),
      contentType: audio.headers["content-type"],
    });
    return result ? result.text : null;
  } catch (err) {
    logger.error({ err: err.message }, "transcription audio fetch failed");
    return null;
  }
}

module.exports = { isAvailable, resolveConfig, transcribe, transcribeBuffer };
