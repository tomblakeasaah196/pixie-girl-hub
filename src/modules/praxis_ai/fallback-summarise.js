/**
 * Shared last-resort summariser for Praxis read paths (§8.2).
 *
 * Both the curated Query Agent and the generic SQL Agent turn a live-data
 * result into natural language with a second LLM call on the PRIMARY vendor.
 * When that call fails (vendor outage, rate limit, timeout), each agent used
 * to either dump raw JSON straight into the chat or (for the SQL agent only)
 * retry on Gemini with its own copy of this logic. Centralised here so both
 * paths get the same fallback, and so a skipped fallback (Gemini never
 * configured) is distinguishable in logs from an attempted-and-failed one —
 * previously the unconfigured case returned null silently, which looked
 * identical to "we tried and it broke" when reading logs after the fact.
 */

"use strict";

const gemini = require("../../services/gemini.service");
const { logger } = require("../../config/logger");

/**
 * @param {object} args
 * @param {Array}  args.messages  Conversation so far (used to find the user's question).
 * @param {*}      args.result    The already-fetched data to summarise.
 * @returns {Promise<string|null>} Plain-English summary, or null if unavailable.
 */
async function summariseViaFallback({ messages, result }) {
  if (!gemini.isConfigured()) {
    logger.warn(
      "praxis fallback summarise skipped — GEMINI_API_KEY not configured, no safety net for primary-vendor failures",
    );
    return null;
  }
  const lastUser = [...(messages || [])].reverse().find((m) => m.role === "user");
  try {
    const r = await gemini.chatCompletion({
      system:
        "You are Praxis, the AI operations assistant inside Pixie Girl Hub. " +
        "Answer the user's question using ONLY the JSON query result provided. " +
        "Be concise and specific; use plain English, not JSON. If the result " +
        "doesn't answer the question, say so plainly.",
      messages: [
        {
          role: "user",
          content:
            `Question: ${(lastUser && lastUser.content) || "(see result)"}\n\n` +
            `Query result JSON:\n${JSON.stringify(result).slice(0, 6000)}`,
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 500,
    });
    return (r && r.text) || null;
  } catch (err) {
    logger.warn(
      { err: err.message },
      "praxis fallback summarise failed",
    );
    return null;
  }
}

module.exports = { summariseViaFallback };
