/**
 * Shared last-resort summariser for Praxis read paths (§8.2).
 *
 * Both the curated Query Agent and the generic SQL Agent turn a live-data
 * result into natural language with a second LLM call. When the in-loop call
 * fails, the result was being dumped as raw JSON into the chat. That in-loop
 * call carries the FULL system prompt + every tool schema + the whole history,
 * which is the usual reason it 400s (oversized / tool-schema issue).
 *
 * So the safety net now has three rungs, cheapest-first:
 *   1. PRIMARY vendor, MINIMAL request — a fresh, tools-free call with only a
 *      short system line, the user's question and the data. Sidesteps whatever
 *      bloated the failing call; this is the rung that actually rescues most
 *      failures.
 *   2. GEMINI fallback — a different vendor, in case the primary is down.
 *   3. null — caller degrades (fenced raw result) only if both rungs fail.
 */

"use strict";

const gemini = require("../../services/gemini.service");
const llm = require("../../services/llm.service");
const { logger } = require("../../config/logger");

function lastUserQuestion(messages) {
  const m = [...(messages || [])].reverse().find((x) => x.role === "user");
  return (m && m.content) || "(see result)";
}

/**
 * Rung 1: minimal, tools-free call on the primary vendor. A tiny fresh request
 * avoids the tool schemas / long context that make the in-loop summarise 400.
 */
async function minimalPrimary({ vendor, messages, result }) {
  if (!vendor) return null;
  try {
    const r = await llm.chat({
      vendor,
      messages: [
        {
          role: "system",
          content:
            "You are Praxis, an operations assistant. Answer the user's " +
            "question using ONLY the DATA provided, in clear plain English — " +
            "specific figures and a direct conclusion. Never output JSON or raw rows.",
        },
        {
          role: "user",
          content:
            `Question: ${lastUserQuestion(messages)}\n\n` +
            `DATA:\n${JSON.stringify(result).slice(0, 6000)}`,
        },
      ],
    });
    return (r && r.content && r.content.trim()) || null;
  } catch (err) {
    logger.warn(
      { err: err.message },
      "praxis summarise rung 1 (minimal primary) failed",
    );
    return null;
  }
}

/** Rung 2: Gemini, a different vendor entirely. */
async function geminiFallback({ messages, result }) {
  if (!gemini.isConfigured()) {
    logger.warn(
      "praxis fallback summarise: GEMINI_API_KEY not configured — no cross-vendor safety net",
    );
    return null;
  }
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
            `Question: ${lastUserQuestion(messages)}\n\n` +
            `Query result JSON:\n${JSON.stringify(result).slice(0, 6000)}`,
        },
      ],
      temperature: 0.3,
      maxOutputTokens: 500,
      // Plain-text extraction, not reasoning — disable thinking so Gemini 2.5
      // doesn't silently spend the whole token budget and return empty text.
      thinkingBudget: 0,
    });
    return (r && r.text) || null;
  } catch (err) {
    logger.warn({ err: err.message }, "praxis summarise rung 2 (gemini) failed");
    return null;
  }
}

/**
 * @param {object} args
 * @param {object} [args.vendor]    Primary vendor config (enables rung 1).
 * @param {Array}  args.messages    Conversation so far (to find the question).
 * @param {*}      args.result      The already-fetched data to summarise.
 * @returns {Promise<string|null>}  Plain-English summary, or null if all rungs fail.
 */
async function summariseViaFallback({ vendor, messages, result }) {
  return (
    (await minimalPrimary({ vendor, messages, result })) ||
    (await geminiFallback({ messages, result }))
  );
}

module.exports = { summariseViaFallback };
