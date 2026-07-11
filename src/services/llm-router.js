/**
 * LLM failover router (Chief of Staff, PR3) — reusable multi-vendor chat.
 *
 * `chatWithFailover` runs ONE chat-completion turn against an ordered vendor
 * chain (DeepSeek → Gemini → OpenAI by default), advancing to the next vendor
 * on a transient failure (network / timeout / HTTP error / tool-markup leak)
 * or when a vendor is unconfigured. On a real failover (a vendor failed and a
 * later one succeeded) it records a `failover_engaged` incident so ops sees the
 * primary is degraded — the request still succeeds.
 *
 * Vendor creds + the active model per (vendor, capability) come from AI Control
 * (governance / ai_model_catalogue), exactly like the Praxis orchestrator, so a
 * key rotation or model switch needs no redeploy. This module is deliberately
 * decoupled from the CoS agent (the guide's "parallelisable now" piece) —
 * Praxis can adopt it later with no behaviour change.
 *
 * Returns { content, tool_calls, usage, vendor, model, finish_reason,
 *           reasoning_content }. The caller meters usage on the governance
 * ledger (the router does not — it has no feature/cost context of its own).
 */

"use strict";

const llm = require("./llm.service");
const governance = require("../modules/ai_governance/governance.service");
const modelCatalogue = require("../modules/ai_governance/model-catalogue.repo");
const health = require("../modules/ai_governance/health.service");
const { config } = require("../config/env");
const { logger } = require("../config/logger");

// The preferred order when nothing else disambiguates. The primary/fallback
// env vars (shared with Praxis) take precedence; the rest of this list fills in
// after them, de-duplicated.
const DEFAULT_CHAIN = ["deepseek", "gemini", "openai"];

/**
 * Ordered vendor chain for a capability. Primary + fallback env vars first
 * (DeepSeek → Gemini by default), then the remaining DEFAULT_CHAIN, de-duped.
 * Vendors currently flagged `red` in ai_vendor_credentials are pushed to the
 * BACK (not dropped — a red flag can be stale and every other vendor may be
 * down), so a healthy vendor is always tried first.
 */
async function resolveChain() {
  const primary = config.PRAXIS_LLM_VENDOR || "deepseek";
  const fallback = config.PRAXIS_LLM_FALLBACK_VENDOR || "gemini";
  const ordered = [];
  for (const v of [primary, fallback, ...DEFAULT_CHAIN]) {
    if (v && !ordered.includes(v)) ordered.push(v);
  }
  const healthByVendor = {};
  try {
    const vendors = await governance.listVendors();
    for (const v of vendors) healthByVendor[v.vendor] = v.last_health_status;
  } catch (err) {
    logger.debug({ err: err.message }, "llm-router: vendor health load failed");
  }
  const healthy = ordered.filter((v) => healthByVendor[v] !== "red");
  const red = ordered.filter((v) => healthByVendor[v] === "red");
  return [...healthy, ...red];
}

/**
 * One chat turn with automatic multi-vendor failover.
 *
 * @param {object}   args
 * @param {string}   [args.capability='chat']
 * @param {Array}    args.messages           OpenAI-style messages
 * @param {Array}    [args.tools]            OpenAI-style tool definitions
 * @param {object}   [args.user]             the requesting user (context only)
 * @param {string}   [args.brand]            business key (incident context)
 * @param {string}   [args.feature_key='cos_chat']
 * @param {number}   [args.temperature]
 * @returns {Promise<{content,tool_calls,usage,vendor,model,finish_reason,reasoning_content}>}
 */
async function chatWithFailover({
  capability = "chat",
  messages,
  tools,
  user, // eslint-disable-line no-unused-vars -- reserved for future per-user routing
  brand,
  feature_key = "cos_chat",
  temperature,
}) {
  const chain = await resolveChain();
  const attempts = [];
  let firstFailedVendor = null;
  let lastError = null;

  for (const vendorName of chain) {
    const vendor = await llm.resolveVendor(vendorName);
    if (!vendor) {
      attempts.push({ vendor: vendorName, skipped: "unconfigured" });
      continue;
    }
    let model = vendor.default_model;
    try {
      const m = await modelCatalogue.resolveActiveModel({
        vendor: vendorName,
        capability,
      });
      if (m && m.model_id) model = m.model_id;
    } catch (err) {
      logger.debug(
        { err: err.message, vendor: vendorName },
        "llm-router: model resolve failed — using vendor default",
      );
    }

    const started = Date.now();
    try {
      const completion = await llm.chat({
        vendor,
        model,
        messages,
        tools,
        ...(temperature !== undefined ? { temperature } : {}),
      });

      // A completion with no tool_calls whose content still looks like leaked
      // tool markup means llm.chat exhausted its own retry — treat it as a
      // transient vendor parse failure and fail over rather than shipping it.
      if (
        (!completion.tool_calls || !completion.tool_calls.length) &&
        llm.isToolMarkupLeak(completion.content)
      ) {
        throw new Error(`${vendorName}: tool-markup leak (unrecoverable)`);
      }

      health.markCallOutcome({
        vendor: vendorName,
        ok: true,
        latency_ms: Date.now() - started,
      });

      // Real failover engaged: an earlier vendor failed, this one recovered.
      if (firstFailedVendor && firstFailedVendor !== vendorName) {
        Promise.resolve()
          .then(() =>
            health.recordFailover({
              primary_vendor: firstFailedVendor,
              fallback_vendor: vendorName,
              feature_key,
              business: brand || null,
              primary_error: lastError && lastError.message,
            }),
          )
          .catch((e) =>
            logger.debug({ err: e.message }, "llm-router: failover incident skipped"),
          );
      }

      return {
        content: completion.content || "",
        tool_calls: completion.tool_calls || [],
        usage: completion.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        vendor: vendorName,
        model: completion.model || model,
        finish_reason: completion.finish_reason || null,
        reasoning_content: completion.reasoning_content || null,
      };
    } catch (err) {
      lastError = err;
      if (!firstFailedVendor) firstFailedVendor = vendorName;
      attempts.push({ vendor: vendorName, error: err.message });
      health.markCallOutcome({
        vendor: vendorName,
        ok: false,
        latency_ms: Date.now() - started,
        error_message: err.message,
      });
      logger.warn(
        { vendor: vendorName, err: err.message },
        "llm-router: vendor failed — advancing to next in chain",
      );
    }
  }

  const summary = attempts
    .map(
      (a) =>
        a.vendor +
        (a.error ? `(${a.error})` : a.skipped ? `(${a.skipped})` : ""),
    )
    .join(", ");
  const e = new Error(`All chat vendors failed or unconfigured: ${summary}`);
  e.code = "AI_UNAVAILABLE";
  e.attempts = attempts;
  throw e;
}

module.exports = { chatWithFailover, resolveChain, DEFAULT_CHAIN };
