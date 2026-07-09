/**
 * Google Gemini API client.
 *
 * Uses the public Generative Language API endpoint (NOT Vertex AI).
 * Auth is a single API key passed as `?key=…`. Cheaper than Vertex
 * for non-enterprise volume and what the CEO already has set up.
 *
 * Exposed surface:
 *   - chatCompletion({ system, messages, model, temperature })
 *   - isConfigured()
 *   - resolveVendor() — DB (AI Control) primary, .env fallback
 *
 * Returns a vendor-neutral shape so the orchestrator can swap providers
 * without branching: { text, input_tokens, output_tokens, model }.
 *
 * Vision + structured output (Shade Finder):
 *   - A message's `content` may be an ARRAY of parts instead of a string:
 *       { type: 'text',  text: '…' }
 *       { type: 'image', mime_type: 'image/jpeg', data: '<base64>' }
 *     Image bytes ride inline (`inlineData`) — nothing is uploaded to Google
 *     file storage, so the photo lives only for the duration of the call.
 *   - `responseSchema` (plus responseMimeType: application/json) forces the
 *     model to emit JSON matching the schema — used to keep perception
 *     grounded (enums of OUR shade slugs, never free-typed product names).
 *
 * Key/endpoint resolution (post-Jul-2026 outage):
 *   AI Control (encrypted DB row) is the SOURCE OF TRUTH; .env is a
 *   fallback used only when no active DB row exists. `resolveVendor()`
 *   below is what every caller in the storefront + Praxis path now goes
 *   through — no more direct `config.GEMINI_*` reads.
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

// Lazy require to avoid a require cycle (gemini.service ↔ governance.service).
let _governance = null;
function governance() {
  if (!_governance) _governance = require("../modules/ai_governance/governance.service");
  return _governance;
}

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";
const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * The public Generative Language API lives ONLY at this host. A .env or
 * AI Control row that overrides the endpoint with a plausible-but-wrong
 * host (the classic gemini.api.google.com typo — which caused the Jul-2026
 * multi-day storefront outage) makes every call die with getaddrinfo
 * ENOTFOUND before it leaves the box.
 *
 * The Test-connection endpoint (Q2 admin gate) uses this hardcoded default
 * as its fallback; the checkConfigAtBoot() ping also logs an error when a
 * non-official host is in use.
 */
const EXPECTED_GEMINI_HOSTS = new Set([
  "generativelanguage.googleapis.com",
]);
const OFFICIAL_GEMINI_URL = DEFAULT_BASE_URL;

/**
 * Resolve the live Gemini vendor config: AI Control (encrypted DB row)
 * first, `.env` second. Returns `null` when neither has an API key —
 * callers can then produce a friendly "AI unavailable" message instead
 * of hitting a null-key crash.
 *
 * The `source` field ('db' | 'env') is surfaced so the Health page can
 * tell operators exactly where the live key is coming from — critical
 * because the whole Jul-2026 confusion was thinking the key was in DB
 * when it was actually in .env.
 */
async function resolveVendor() {
  // Try AI Control first.
  let cfg = null;
  try {
    cfg = await governance().getVendorConfig({ vendor: "gemini" });
  } catch (err) {
    // Encryption-key mismatch, DB blip, etc — do NOT take AI down just
    // because the DB lookup failed. Fall through to env.
    logger.warn({ err: err.message }, "gemini.resolveVendor: DB lookup failed, using env");
  }
  if (cfg && cfg.api_key) {
    return {
      source: "db",
      vendor: "gemini",
      api_key: cfg.api_key,
      endpoint_url: cfg.endpoint_url || DEFAULT_BASE_URL,
      default_model: cfg.default_model || DEFAULT_MODEL,
      cost_per_1k_input_tokens: Number(cfg.cost_per_1k_input_tokens || 0),
      cost_per_1k_output_tokens: Number(cfg.cost_per_1k_output_tokens || 0),
    };
  }
  // Env fallback.
  if (config.GEMINI_API_KEY) {
    return {
      source: "env",
      vendor: "gemini",
      api_key: config.GEMINI_API_KEY,
      endpoint_url: config.GEMINI_BASE_URL || DEFAULT_BASE_URL,
      default_model: config.GEMINI_MODEL || DEFAULT_MODEL,
      cost_per_1k_input_tokens: 0,
      cost_per_1k_output_tokens: 0,
    };
  }
  return null;
}

/** Legacy shape kept for callers that only need a boolean. */
async function isConfigured() {
  return Boolean(await resolveVendor());
}

/**
 * Boot-time sanity ping. Warns loudly if the resolved endpoint isn't the
 * canonical Google host or the URL is unparseable — this is the guard that
 * would have caught the Jul-2026 outage the moment PM2 restarted.
 * Never throws.
 */
async function checkConfigAtBoot() {
  let v = null;
  try {
    v = await resolveVendor();
  } catch (err) {
    logger.error({ err: err.message }, "gemini.checkConfigAtBoot: resolver crashed");
    return;
  }
  if (!v) {
    logger.warn("Gemini is not configured (no AI Control row and no GEMINI_API_KEY) — Gemini-backed AI features are disabled");
    return;
  }
  let host = null;
  try {
    host = new URL(v.endpoint_url).hostname;
  } catch {
    logger.error(
      { endpoint_url: v.endpoint_url, source: v.source },
      "Gemini endpoint URL is not a valid URL — every call will fail; expected " + OFFICIAL_GEMINI_URL,
    );
    return;
  }
  if (!EXPECTED_GEMINI_HOSTS.has(host)) {
    logger.error(
      { host, endpoint_url: v.endpoint_url, source: v.source },
      "Gemini endpoint URL points at an unexpected host — calls will likely fail with ENOTFOUND; expected generativelanguage.googleapis.com",
    );
  } else {
    logger.info({ source: v.source, model: v.default_model }, "Gemini configured");
  }
}

/**
 * Translate our generic message array into Gemini's `contents` shape.
 *
 *   our role  | Gemini role
 *   ---------- | -------------
 *   'system'   | systemInstruction (top-level)
 *   'user'     | user
 *   'assistant'| model
 */
function toGeminiParts(content) {
  // String content → single text part (the pre-vision behaviour).
  if (!Array.isArray(content)) return [{ text: String(content || "") }];
  return content.map((p) => {
    if (p && p.type === "image" && p.data) {
      return {
        inlineData: {
          mimeType: p.mime_type || "image/jpeg",
          data: String(p.data),
        },
      };
    }
    return { text: String((p && p.text) || "") };
  });
}

function toGeminiContents({ system, messages }) {
  const contents = (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(m.content),
  }));
  const systemInstruction = system
    ? { role: "user", parts: [{ text: String(system) }] }
    : undefined;
  return { contents, systemInstruction };
}

/**
 * Send a chat completion request. Returns the vendor-neutral shape.
 *
 * If `vendor` isn't provided the resolver runs (AI Control → env). Callers
 * that already resolved (e.g. failover, retry) pass the vendor arg to
 * avoid a redundant DB round-trip.
 *
 * @param {object} args
 * @param {object} [args.vendor]      pre-resolved vendor {api_key, endpoint_url, default_model}
 * @param {string} [args.system]      System prompt
 * @param {Array<{role:'user'|'assistant', content:string}>} args.messages
 * @param {string} [args.model]       Defaults to vendor.default_model
 * @param {number} [args.temperature] 0..1, default 0.7
 * @param {number} [args.maxOutputTokens]
 * @param {object} [args.responseSchema] Gemini structured-output schema; when
 *                 set the response is forced to application/json.
 * @param {number} [args.thinkingBudget] Max thinking tokens (Gemini 2.5).
 *                 Pass 0 to disable thinking — otherwise thought tokens are
 *                 billed against maxOutputTokens and can leave no room for
 *                 the actual answer. Omit to keep the model default.
 */
async function chatCompletion({
  vendor,
  system,
  messages,
  model,
  temperature = 0.7,
  maxOutputTokens = 1024,
  timeoutMs = 30000,
  responseSchema,
  thinkingBudget,
}) {
  const v = vendor || (await resolveVendor());
  if (!v || !v.api_key) {
    const err = new Error("GEMINI_NOT_CONFIGURED");
    err.code = "GEMINI_NOT_CONFIGURED";
    err.retryable = false;
    throw err;
  }
  const modelId = model || v.default_model || DEFAULT_MODEL;
  const base = (v.endpoint_url || DEFAULT_BASE_URL).replace(/\/$/, "");
  const url =
    `${base}/v1beta/models/${encodeURIComponent(modelId)}:generateContent` +
    `?key=${encodeURIComponent(v.api_key)}`;
  const { contents, systemInstruction } = toGeminiContents({
    system,
    messages,
  });
  const body = {
    contents,
    systemInstruction,
    generationConfig: {
      temperature,
      maxOutputTokens,
      ...(responseSchema
        ? { responseMimeType: "application/json", responseSchema }
        : {}),
      // Gemini 2.5 models "think" by default and the thought tokens come out
      // of maxOutputTokens — a tight budget can be consumed entirely by
      // thinking, returning HTTP 200 with finishReason=MAX_TOKENS and NO text
      // parts. Callers that want fast deterministic output (e.g. structured
      // JSON extraction) pass thinkingBudget: 0 to disable thinking.
      ...(thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget } }
        : {}),
    },
  };
  const startedAt = Date.now();
  try {
    const { data } = await axios.post(url, body, { timeout: timeoutMs });
    const latency_ms = Date.now() - startedAt;
    const candidate = data && data.candidates && data.candidates[0];
    const parts =
      (candidate && candidate.content && candidate.content.parts) || [];
    const text = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (!text) {
      logger.warn(
        {
          model: modelId,
          finish_reason: (candidate && candidate.finishReason) || null,
          block_reason:
            (data && data.promptFeedback && data.promptFeedback.blockReason) ||
            null,
          parts_count: parts.length,
          thoughts_token_count:
            (data &&
              data.usageMetadata &&
              data.usageMetadata.thoughtsTokenCount) ||
            0,
        },
        "gemini.chatCompletion returned no text",
      );
    }
    const usage = data && data.usageMetadata;
    return {
      text,
      input_tokens: usage ? usage.promptTokenCount || 0 : 0,
      output_tokens: usage ? usage.candidatesTokenCount || 0 : 0,
      model: modelId,
      vendor: "gemini",
      source: v.source || "env",
      latency_ms,
    };
  } catch (err) {
    const latency_ms = Date.now() - startedAt;
    const status =
      err.response && err.response.status ? err.response.status : null;
    // Google's response body says WHY (bad schema, blocked key, quota…) —
    // without it a 400 is undiagnosable from our logs.
    const apiError =
      (err.response &&
        err.response.data &&
        err.response.data.error &&
        err.response.data.error.message) ||
      null;
    logger.warn(
      {
        status,
        err: err.message,
        api_error: apiError,
        model: modelId,
        source: v.source,
        latency_ms,
      },
      "gemini.chatCompletion failed",
    );
    const e = new Error(`gemini call failed (${status || "no response"})`);
    e.code = "GEMINI_CALL_FAILED";
    e.status = status;
    e.api_message = apiError;
    e.latency_ms = latency_ms;
    e.retryable =
      status === null || status >= 500 || status === 429 || status === 408;
    throw e;
  }
}

module.exports = {
  isConfigured,
  checkConfigAtBoot,
  chatCompletion,
  resolveVendor,
  OFFICIAL_GEMINI_URL,
  EXPECTED_GEMINI_HOSTS,
  DEFAULT_MODEL,
  DEFAULT_BASE_URL,
};
