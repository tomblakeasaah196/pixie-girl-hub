/**
 * Praxis Query Agent (§8.2). Exposes the read-only query catalogue to the LLM as
 * tools, and — when the model picks one — enforces the caller's `view`
 * permission, runs the parameterised brand-scoped read, and asks the model to
 * summarise the result in natural language.
 *
 * Safety contract:
 *   • Only catalogue entries run — the model never supplies SQL.
 *   • Every query is gated on `view` for its RBAC module (CEO bypasses).
 *   • Results are scoped to the conversation's brand.
 *   • Failures degrade to a message; nothing here throws into the orchestrator.
 */

"use strict";

const llm = require("../../services/llm.service");
const permissionsRepo = require("../../shared/org_workflow/permissions.repo");
const catalogue = require("./query-catalogue");
const executor = require("./praxis.executor");
const { logger } = require("../../config/logger");
const { summariseViaFallback } = require("./fallback-summarise");
const { extendIfTruncated } = require("./continuation");

const PREFIX = "query_";

// How many follow-up READ tool calls one turn may chain (query -> query -> sql
// -> answer). Bounded so a confused model can't loop the turn forever, generous
// enough that a lookup can feed a second lookup that feeds the answer.
const MAX_READ_HOPS = 6;
// How much of a tool result (JSON) is handed back to the model. The old 6 000
// hard slice cut multi-row results mid-record — the model then reported the
// severed values as "(cut off)". Results are already row-capped upstream, so a
// larger, row-boundary-aware budget lets the full set through intact.
const TOOL_RESULT_MAX_CHARS = 24000;
// The generic SQL agent's tool names, declared locally so a query-only turn
// never has to load the SQL agent (and its DB dependency) merely to recognise
// them — the agent itself is lazy-required only when such a call is dispatched.
// Kept in sync with sql-agent.isSqlTool.
const SQL_TOOL_NAMES = new Set(["sql_schema", "sql_query"]);
const sqlIsSqlTool = (name) => SQL_TOOL_NAMES.has(name);
const safe = (s) =>
  String(s)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);

/** OpenAI tool definitions for every catalogue query. */
function tools() {
  return catalogue.list().map((q) => ({
    type: "function",
    function: {
      name: PREFIX + safe(q.key),
      description: `[READ] ${q.description}`,
      parameters: q.parameters || { type: "object", properties: {} },
    },
  }));
}

function isQueryTool(name) {
  return typeof name === "string" && name.startsWith(PREFIX);
}

function entryForTool(name) {
  return catalogue.get(String(name).slice(PREFIX.length));
}

function parseArgs(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return {};
  }
}

function sumUsage(a, b) {
  const x = a || {};
  const y = b || {};
  return {
    prompt_tokens: (x.prompt_tokens || 0) + (y.prompt_tokens || 0),
    completion_tokens: (x.completion_tokens || 0) + (y.completion_tokens || 0),
    total_tokens: (x.total_tokens || 0) + (y.total_tokens || 0),
  };
}

/**
 * Serialise a tool result for the model within a char budget. A blind
 * `slice(maxChars)` truncates mid-record, which the model then reports as
 * "(cut off)" values. So for an array we include as many WHOLE elements as fit
 * and tell the model how many were omitted; a non-array is sliced only as a
 * last resort.
 */
function clampToolResult(data, maxChars = TOOL_RESULT_MAX_CHARS) {
  let full;
  try {
    full = JSON.stringify(data);
  } catch {
    return JSON.stringify({ _unserialisable: true });
  }
  if (full.length <= maxChars) return full;

  const arr = Array.isArray(data)
    ? data
    : data && Array.isArray(data.data)
      ? data.data
      : null;
  if (arr) {
    const kept = [];
    let size = 2; // "[]" / "{}" braces
    for (const row of arr) {
      const s = JSON.stringify(row);
      if (size + s.length + 1 > maxChars) break;
      kept.push(row);
      size += s.length + 1;
    }
    return JSON.stringify({
      rows: kept,
      _note: `showing ${kept.length} of ${arr.length} rows — result truncated to fit; ask to narrow or page for the rest`,
    });
  }
  return full.slice(0, maxChars);
}

/** A reply that IS (or starts with) a JSON blob is a raw-data dump, never a
 *  real answer — used to catch the model regurgitating tool output. */
function looksLikeDump(text) {
  const t = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .trim();
  return t.startsWith("{") || t.startsWith("[");
}

/** True when a catalogue action is safe to run inline in a READ turn (no write,
 *  no confirmation gate) — the same trust rule the orchestrator uses. */
function isReadSafeAction(action) {
  return (
    action &&
    action.is_write === false &&
    action.requires_confirmation === false
  );
}

const asstToolMsg = (completion, calls) => ({
  role: "assistant",
  content: completion.content || null,
  // DeepSeek thinking models require the reasoning_content that produced a tool
  // call to be replayed with it, or the follow-up 400s.
  ...(completion.reasoning_content
    ? { reasoning_content: completion.reasoning_content }
    : {}),
  tool_calls: calls,
});
const toolResultMsg = (id, payload) => ({
  role: "tool",
  tool_call_id: id,
  content: clampToolResult(payload),
});

async function hasView(user, module) {
  if (user && user.is_ceo === true) return true;
  const grants = await permissionsRepo.findGrants({
    role_ids: (user && user.role_ids) || [],
    module,
    action: "view",
  });
  return Boolean(grants && grants.length);
}

/**
 * Permission-check and run one catalogue query, WITHOUT the summarise step.
 * Used by `run` below and by the orchestrator's action-resolution loop, which
 * needs the raw rows fed back to the model mid-chain (e.g. look a campaign id
 * up, then fill it into an action's arguments).
 * @returns {Promise<{ok:boolean, rows?:any, denied?:boolean, error?:boolean,
 *                    message?:string, queryKey?:string}|null>}
 *          null when the tool name isn't a catalogue query.
 */
async function execute({ user, brand, name, args }) {
  const entry = entryForTool(name);
  if (!entry) return null;

  if (!(await hasView(user, entry.module))) {
    return {
      ok: false,
      denied: true,
      queryKey: entry.key,
      message: `You don't have permission to view ${entry.module} data, so I can't answer that.`,
    };
  }
  try {
    const rows = await entry.run({ brand, args: args || {}, user });
    return { ok: true, rows, queryKey: entry.key };
  } catch (err) {
    logger.error({ err: err.message, query: entry.key }, "praxis query failed");
    return {
      ok: false,
      error: true,
      queryKey: entry.key,
      message: "I couldn't run that lookup just now — please try again.",
    };
  }
}

/**
 * Run the query tool the model selected, then let it chain follow-up READ
 * lookups until it produces a natural-language answer.
 *
 * A lookup often exists only to feed a SECOND (or third) call — "top styled
 * product?" (a query) then "trace it to its base product" (a generic SQL read),
 * or "what needs attention?" then "pull the customer names behind those
 * orders". Previously the summarise step could chase only ONE hop, and only
 * into a read-safe catalogue action: a follow-up `query_*` or `sql_*` tool call
 * was silently DROPPED and whatever "Let me…" preamble came with it shipped as
 * the whole answer — the exact cut-off the user reported. This now loops over
 * every follow-up read the model asks for (another curated query, a generic SQL
 * read for the CEO, or a read-safe catalogue action), feeds each result back,
 * and only stops when the model answers in text (or the hop budget is spent).
 *
 * Still deliberately NOT chased: writes and confirmation-gated actions — a
 * "tell me about X" read turn must not spontaneously create a pending action;
 * the model can propose one on an ordinary next turn.
 *
 * @returns {Promise<{replyText:string|null, usage:object, queryKey?:string,
 *                    chainedAction?:string, denied?:boolean, error?:boolean,
 *                    degraded?:boolean}>}
 */
async function run({
  vendor,
  user,
  brand,
  messages,
  completion,
  toolCall,
  args,
  allTools,
  byName,
  authHeader,
  requestId,
}) {
  const res = await execute({
    user,
    brand,
    name: toolCall.function.name,
    args,
  });
  if (!res) return { replyText: null, usage: {} };
  if (!res.ok) {
    return {
      replyText: res.message,
      usage: {},
      denied: res.denied || false,
      error: res.error || false,
      queryKey: res.queryKey,
    };
  }

  const fenced = (data) =>
    "Here's what I found:\n```json\n" +
    JSON.stringify(data, null, 2).slice(0, 1000) +
    "\n```";

  // A follow-up tool call is dispatchable here only if it is another READ:
  // a curated query, a generic SQL read, or a read-safe catalogue action we can
  // actually run over loopback (needs the caller's auth header).
  const canDispatch = (name) => {
    if (isQueryTool(name) || sqlIsSqlTool(name)) return true;
    const action = byName && byName.get(name);
    return Boolean(action && isReadSafeAction(action) && authHeader);
  };

  // Plain-English rescue when the model hands back nothing / a raw JSON dump.
  const synthesize = async (convo, from) => {
    try {
      const r = await llm.chat({
        vendor,
        messages: [
          ...convo,
          { role: "assistant", content: from.content || null },
          {
            role: "user",
            content:
              "Using the data above, answer my original question in clear " +
              "plain English — specific figures and a direct conclusion. Do " +
              "NOT output JSON or raw rows.",
          },
        ],
      });
      return { text: (r.content || "").trim(), usage: r.usage, finish_reason: r.finish_reason };
    } catch (err) {
      logger.warn({ err: err.message }, "praxis query synthesis pass failed");
      return { text: "", usage: {} };
    }
  };

  const convo = [
    ...messages,
    asstToolMsg(completion, [toolCall]),
    toolResultMsg(toolCall.id, res.rows),
  ];
  let usage = {};
  let lastResult = res.rows;
  let lastChainedAction;

  for (let hop = 0; hop < MAX_READ_HOPS; hop++) {
    let follow;
    try {
      follow = await llm.chat({
        vendor,
        messages: convo,
        tools: allTools && allTools.length ? allTools : undefined,
      });
    } catch (err) {
      logger.error(
        { err: err.message },
        "praxis query summarise failed — trying fallback vendor",
      );
      const fallbackText = await summariseViaFallback({
        vendor,
        messages: convo,
        result: lastResult,
      });
      return {
        replyText: fallbackText || fenced(lastResult),
        usage,
        queryKey: res.queryKey,
        degraded: !fallbackText,
        ...(lastChainedAction ? { chainedAction: lastChainedAction } : {}),
      };
    }
    usage = sumUsage(usage, follow.usage);

    const calls = (follow.tool_calls || []).filter((c) => c && c.function);
    const dispatchable = calls.filter((c) => canDispatch(c.function.name));

    // No further READ to run → this turn is finished. Translate to plain
    // English (rescuing an empty / dumped reply), then extend it if the vendor
    // cut it off at the token cap, so the answer is never half-written.
    if (!dispatchable.length) {
      let text = (follow.content || "").trim();
      let finishReason = follow.finish_reason;
      if (!text || looksLikeDump(text)) {
        const synth = await synthesize(convo, follow);
        usage = sumUsage(usage, synth.usage);
        if (synth.text) {
          text = synth.text;
          finishReason = synth.finish_reason;
        }
      }
      text = await extendIfTruncated({
        vendor,
        baseMessages: convo,
        text,
        finishReason,
        usage,
      });
      return {
        replyText: text || "Here's what I found.",
        usage,
        queryKey: res.queryKey,
        ...(lastChainedAction ? { chainedAction: lastChainedAction } : {}),
      };
    }

    // Run every follow-up read the model asked for this turn, feed the results
    // back, and loop. Replaying exactly the calls we answer keeps the
    // assistant/tool message counts balanced (a mismatch 400s the vendor).
    const answered = [];
    for (const call of dispatchable) {
      const name = call.function.name;
      const cargs = parseArgs(call.function.arguments);
      let payload;
      if (isQueryTool(name)) {
        const q = await execute({ user, brand, name, args: cargs });
        payload = !q
          ? { error: "unknown query" }
          : q.ok
            ? q.rows
            : { error: q.message };
      } else if (sqlIsSqlTool(name)) {
        // Lazy require: keep the SQL agent's DB dependency out of the import
        // graph for query-only turns (and query-agent's own unit tests).
        payload = await require("./sql-agent").dispatchTool({
          user,
          brand,
          name,
          args: cargs,
        });
      } else {
        const action = byName.get(name);
        try {
          const exec = await executor.executeAction({
            pending: {
              method: action.method,
              route: action.route,
              payload: cargs,
              business: brand,
            },
            authHeader,
            requestId,
          });
          payload = exec.result;
          lastChainedAction = action.action_key;
        } catch (err) {
          logger.error(
            { err: err.message, action_key: action.action_key },
            "praxis: query-chained action failed",
          );
          payload = {
            error:
              err.user_message ||
              `couldn't run ${action.title || action.action_key}`,
          };
        }
      }
      answered.push({ id: call.id, payload });
      lastResult = payload;
    }
    convo.push(asstToolMsg(follow, dispatchable));
    for (const a of answered) convo.push(toolResultMsg(a.id, a.payload));
  }

  // Hop budget spent without a text answer. Summarise the last result we have
  // rather than dead-ending — never leave the turn without a reply.
  const fb = await summariseViaFallback({
    vendor,
    messages: convo,
    result: lastResult,
  });
  return {
    replyText:
      fb ||
      "I couldn't fully pin that down in a few steps — could you narrow it a little (e.g. a date range or the specific detail you want)?",
    usage,
    queryKey: res.queryKey,
    ...(lastChainedAction ? { chainedAction: lastChainedAction } : {}),
  };
}

module.exports = {
  tools,
  isQueryTool,
  execute,
  run,
  PREFIX,
  clampToolResult,
};
