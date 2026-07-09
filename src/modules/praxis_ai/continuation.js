/**
 * Truncation continuation for Praxis answers (§8.2).
 *
 * Chat completions stop with `finish_reason === 'length'` when the answer hits
 * the output-token cap — the text is cut off mid-sentence (users saw tables
 * that stopped partway through, e.g. at "FLH-SO-0069"). This transparently asks
 * the model to continue from where it stopped and stitches the parts into one
 * answer, so a long reply is never shipped half-written.
 *
 * Only used to extend a FINAL, tool-free answer — never mid tool chain (a
 * truncated tool call is a different failure the loops handle separately).
 */

"use strict";

const llm = require("../../services/llm.service");

// A truncated answer is normally finished in one more pass; cap the rounds so a
// pathological model can't run the turn forever.
const MAX_CONTINUATIONS = 4;

function addUsage(acc, u) {
  if (!acc || !u) return;
  acc.prompt_tokens = (acc.prompt_tokens || 0) + (u.prompt_tokens || 0);
  acc.completion_tokens =
    (acc.completion_tokens || 0) + (u.completion_tokens || 0);
  acc.total_tokens = (acc.total_tokens || 0) + (u.total_tokens || 0);
}

/**
 * If `text` was cut off (finishReason === 'length'), keep asking the model to
 * continue and append each part until it finishes cleanly (or the cap is hit).
 * Never throws — on any error it returns whatever text it has so far.
 *
 * @param {object}   args
 * @param {object}   args.vendor        resolved vendor config
 * @param {Array}    args.baseMessages  the conversation that produced `text`
 * @param {string}   args.text          the (possibly truncated) answer so far
 * @param {string}   [args.finishReason]
 * @param {object}   [args.usage]       usage accumulator, mutated in place
 * @param {string}   [args.model]
 * @returns {Promise<string>} the full, stitched answer
 */
async function extendIfTruncated({
  vendor,
  baseMessages,
  text,
  finishReason,
  usage,
  model,
}) {
  let out = text || "";
  let reason = finishReason;
  let guard = 0;
  while (reason === "length" && guard < MAX_CONTINUATIONS) {
    guard += 1;
    let cont;
    try {
      cont = await llm.chat({
        vendor,
        model,
        messages: [
          ...baseMessages,
          { role: "assistant", content: out },
          {
            role: "user",
            content:
              "Your previous answer was cut off. Continue it from exactly " +
              "where it stopped — do not repeat anything already written, do " +
              "not restart, and add no preamble.",
          },
        ],
      });
    } catch {
      break;
    }
    addUsage(usage, cont && cont.usage);
    const piece = (cont && cont.content) || "";
    if (!piece.trim()) break;
    // Join without inserting a space that could split a word across the seam.
    out += piece;
    reason = cont.finish_reason;
  }
  return out;
}

module.exports = { extendIfTruncated };
