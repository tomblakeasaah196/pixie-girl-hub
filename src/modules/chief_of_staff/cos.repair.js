/**
 * Chief of Staff — one-shot self-repair of a failed plan step.
 *
 * The "Hostinger feel": when an approved step fails on a fixable error (a bad
 * enum, a missing/soft field, a malformed datetime), the agent gets ONE chance
 * to correct its own payload and the executor retries — instead of parking the
 * whole plan on the CEO (docs/COS_ARCHITECTURE_AUDIT.md §5, fix #5).
 *
 * makeRepairFn() returns an async repair(step, action, errorText) that asks the
 * model — with the action's schema, the failed payload and the real error — for
 * a corrected payload, runs it back through pre-flight (so a repair can't
 * smuggle in a hallucinated key either), and returns the cleaned payload or null
 * (no usable change / no vendor / cross-step tokens it must not touch). Bounded,
 * governed, and metered; never throws into the executor.
 */

"use strict";

const llmRouter = require("../../services/llm-router");
const { preflight } = require("./cos.preflight");
const { recordUsageSafe } = require("./cos.usage");
const { logger } = require("../../config/logger");

const FEATURE = "cos_chat";

const SYSTEM = [
  "You fix ONE failed workspace action from a Chief of Staff plan.",
  "You are given the action's JSON Schema, the payload that failed, and the exact error.",
  "Return ONLY the corrected payload as a single minified JSON object — no prose, no markdown, no code fences.",
  "Rules:",
  "- Keep any {{step:N.field}} tokens byte-for-byte; never replace them with a guess.",
  "- Only change what the error requires. Use values allowed by the schema (respect enums).",
  "- Never invent a UUID. If the error is an id you cannot resolve from the payload, return the payload unchanged.",
].join("\n");

/** Pull the first balanced top-level {…} JSON object out of a model reply. */
function extractJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * @param {{user:object, brand:string}} ctx
 * @returns {(step:object, action:object, errorText:string) => Promise<object|null>}
 */
function makeRepairFn({ user, brand }) {
  return async function repair(step, action, errorText) {
    if (!action || !action.payload_schema) return null;
    let completion;
    try {
      completion = await llmRouter.chatWithFailover({
        capability: "chat",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content:
              `ACTION: ${action.action_key}\n` +
              `SCHEMA: ${JSON.stringify(action.payload_schema)}\n` +
              `FAILED PAYLOAD: ${JSON.stringify(step.payload)}\n` +
              `ERROR: ${String(errorText).slice(0, 800)}\n\n` +
              "Corrected JSON:",
          },
        ],
        user,
        brand,
        feature_key: FEATURE,
        temperature: 0,
      });
    } catch (err) {
      logger.warn({ err: err.message, action: action.action_key }, "cos repair: vendor call failed");
      return null;
    }

    // Meter the repair round like any other CoS completion (best-effort).
    recordUsageSafe({ user, brand, convId: step.conversation_id, completion, ok: true });

    const parsed = extractJson(completion.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const { payload: cleaned } = preflight({ action, payload: parsed });
    // A no-op "fix" isn't worth a retry — the executor would just fail again.
    if (JSON.stringify(cleaned) === JSON.stringify(step.payload || {})) return null;
    return cleaned;
  };
}

module.exports = { makeRepairFn, extractJson };
