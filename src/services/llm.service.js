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

/** Decrypted config for the configured Praxis chat vendor, or null. */
async function resolveVendor(vendorName) {
  const vendor = vendorName || config.PRAXIS_LLM_VENDOR;
  const cfg = await governance.getVendorConfig({ vendor });
  if (!cfg || !cfg.api_key || !cfg.endpoint_url) return null;
  return cfg;
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
  const { data } = await axios.post(`${base}/chat/completions`, body, {
    headers: {
      Authorization: `Bearer ${vendor.api_key}`,
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });
  const choice = (data.choices && data.choices[0]) || {};
  const msg = choice.message || {};
  return {
    content: msg.content || "",
    tool_calls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    usage: data.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    model: data.model || body.model,
  };
}

module.exports = { resolveVendor, chat };
