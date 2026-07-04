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
 */

"use strict";

const axios = require("axios");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

function isConfigured() {
  return !!config.GEMINI_API_KEY;
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
 * @param {object} args
 * @param {string} [args.system]      System prompt
 * @param {Array<{role:'user'|'assistant', content:string}>} args.messages
 * @param {string} [args.model]       Defaults to env GEMINI_MODEL
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
  system,
  messages,
  model,
  temperature = 0.7,
  maxOutputTokens = 1024,
  timeoutMs = 30000,
  responseSchema,
  thinkingBudget,
}) {
  if (!isConfigured()) {
    const err = new Error("GEMINI_NOT_CONFIGURED");
    err.code = "GEMINI_NOT_CONFIGURED";
    throw err;
  }
  const modelId = model || config.GEMINI_MODEL || "gemini-2.5-flash";
  const url =
    `${config.GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(modelId)}:generateContent` +
    `?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;
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
  try {
    const { data } = await axios.post(url, body, { timeout: timeoutMs });
    const candidate = data && data.candidates && data.candidates[0];
    const parts =
      (candidate && candidate.content && candidate.content.parts) || [];
    const text = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    // An empty reply on HTTP 200 is otherwise invisible — surface WHY
    // (MAX_TOKENS = thinking ate the budget, SAFETY/blockReason = filtered).
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
    };
  } catch (err) {
    const status =
      err.response && err.response.status ? err.response.status : null;
    logger.warn(
      {
        status,
        err: err.message,
        model: modelId,
      },
      "gemini.chatCompletion failed",
    );
    const e = new Error(`gemini call failed (${status || "no response"})`);
    e.code = "GEMINI_CALL_FAILED";
    e.status = status;
    e.retryable =
      status === null || status >= 500 || status === 429 || status === 408;
    throw e;
  }
}

module.exports = { isConfigured, chatCompletion };
