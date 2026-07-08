/**
 * LLM chat client (X-2) — OpenAI-compatible chat/completions with tool-calling.
 *
 * Vendor-agnostic: creds + endpoint + model + per-token costs come from the
 * encrypted ai_vendor_credentials row (governance.getVendorConfig), i.e. they
 * are managed in the AI Control admin surface, NOT env. DeepSeek / OpenAI /
 * Groq etc. all speak this shape. `resolveVendor()` returns null when no active
 * vendor is configured, so the Praxis orchestrator falls back to its graceful
 * stub instead of erroring.
 */

"use strict";

const axios = require("axios");
const governance = require("../modules/ai_governance/governance.service");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

/** Decrypted config for the configured Praxis chat vendor, or null. */
async function resolveVendor(vendorName) {
  const vendor = vendorName || config.PRAXIS_LLM_VENDOR;
  const cfg = await governance.getVendorConfig({ vendor });
  if (!cfg || !cfg.api_key || !cfg.endpoint_url) return null;
  return cfg;
}

// ── Tool-markup leak detection ─────────────────────────────
// DeepSeek (and other vendors) occasionally emit their INTERNAL tool-call
// markup as plain text instead of a parsed `tool_calls` array — the user
// then sees "<｜DSML｜>…invoke name=…" garbage as the assistant's answer
// (observed in production Praxis chats). Detect the leak, retry once, and
// never ship raw markup to the UI.
const TOOL_MARKUP_RE = new RegExp(
  [
    "[<＜][|｜]?\\s*DSML", // <|DSML|…  / ＜｜DSML…
    "[|｜]\\s*DSML\\s*[|｜]", // |DSML| mid-text
    "tool[▁_]?calls?[▁_]?(begin|end)", // <｜tool▁calls▁begin｜> etc.
    "<[|｜]tool[▁_]?calls?[|｜]>", // <|tool_calls|>
    "<invoke\\s+name\\s*=", // DSML invoke blocks
    "</?tool_call>", // bare tool_call tags
  ].join("|"),
  "i",
);

/** True when a completion's text content looks like leaked tool markup. */
function isToolMarkupLeak(content) {
  return typeof content === "string" && TOOL_MARKUP_RE.test(content);
}

/** Strip leaked markup; returns the cleaned text (may be empty). */
function stripToolMarkup(content) {
  return String(content || "")
    .split("\n")
    .filter((line) => !TOOL_MARKUP_RE.test(line))
    .join("\n")
    .trim();
}

/**
 * One chat completion turn.
 * @param {object} args
 * @param {object} args.vendor    resolveVendor() result (endpoint_url, api_key, default_model, costs)
 * @param {Array}  args.messages  OpenAI-style messages
 * @param {Array}  [args.tools]   OpenAI-style tool definitions
 * @param {string} [args.model]   override vendor.default_model
 * @param {number} [args.temperature=0.2]
 * @returns {Promise<{content:string, tool_calls:Array, usage:object, model:string}>}
 */
async function chat({ vendor, messages, tools, model, temperature = 0.2 }) {
  if (!vendor) throw new Error("llm.chat: no vendor config");
  const base = vendor.endpoint_url.replace(/\/$/, "");
  const body = {
    model: model || vendor.default_model,
    messages,
    temperature,
  };
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  // Up to 2 attempts: a leak of internal tool markup into `content` (parsed
  // tool_calls absent) is a transient vendor parse failure — retry once
  // before degrading, and NEVER return raw markup to the caller.
  let result;
  for (let attempt = 0; attempt < 2; attempt++) {
    let data;
    try {
      ({ data } = await axios.post(`${base}/chat/completions`, body, {
        headers: {
          Authorization: `Bearer ${vendor.api_key}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }));
    } catch (err) {
      // Surface the vendor's actual error (axios only gives "status code 400").
      // The response body says WHY — bad model, invalid tool schema, duplicate
      // tool name, unsupported param — which is what we need to debug.
      const r = err.response;
      const detail =
        r?.data?.error?.message ||
        r?.data?.message ||
        (r?.data ? JSON.stringify(r.data).slice(0, 800) : null);
      throw new Error(
        `LLM ${vendor.vendor} ${r?.status ?? ""} ${detail || err.message}`.trim(),
      );
    }
    const choice = (data.choices && data.choices[0]) || {};
    const msg = choice.message || {};
    result = {
      content: msg.content || "",
      tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
      usage: data.usage || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      model: data.model || body.model,
    };
    if (result.tool_calls.length || !isToolMarkupLeak(result.content)) {
      return result;
    }
    logger.warn(
      { vendor: vendor.vendor, attempt: attempt + 1 },
      "llm.chat: tool markup leaked into content — retrying",
    );
  }

  // Both attempts leaked: salvage whatever readable text remains, or degrade
  // to an honest failure message — anything but raw markup in the chat.
  const cleaned = stripToolMarkup(result.content);
  result.content =
    cleaned ||
    "I couldn't complete that response cleanly — please ask me again in a moment.";
  return result;
}

module.exports = {
  resolveVendor,
  chat,
  isToolMarkupLeak,
  stripToolMarkup,
};
