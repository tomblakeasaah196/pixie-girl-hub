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

const PREFIX = "query_";
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

/** A reply that is (or starts with) a JSON blob is a raw dump, not an answer. */
function looksLikeDump(text) {
  const t = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .trim();
  return t.startsWith("{") || t.startsWith("[");
}

// One user turn can need several curated lookups ("no overdue invoices — let me
// also check receivables…"). Bound the chase so a turn always terminates.
const MAX_QUERY_ROUNDS = 6;

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
 * Run a query tool the model selected, then summarise the live result.
 *
 * A lookup often exists only to feed a SECOND call — "who was our last
 * campaign?" (a query) then "was it a success?" (a read-safe catalogue
 * action needing the campaign id the query just found). Previously the
 * summarise step offered no tools at all, so the model could only report
 * what the query already returned and had to claim it "doesn't have a
 * tool" for the follow-up even when one exists. When `allTools`/`byName`
 * are supplied, one extra hop into a READ-SAFE catalogue action (is_write
 * false, requires_confirmation false) is chased inline over loopback, the
 * same trust model `resolveCatalogueAction`'s inline-read branch uses.
 * Writes and confirmation-gated actions are deliberately NOT chased here —
 * a "tell me about X" read turn shouldn't spontaneously create a pending
 * action; the model can still propose one as an ordinary next turn.
 *
 * @returns {Promise<{replyText:string|null, usage:object, queryKey?:string, denied?:boolean, error?:boolean}>}
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
  let rows = res.rows;

  // Feed the result back and let the model keep going until it produces a FINAL
  // text answer (no tool call). A turn often needs several lookups in a row
  // ("no overdue invoices — let me also check receivables…"); the old code only
  // chased ONE follow-up, so a multi-step answer stopped half-way. This bounded
  // loop chases further curated queries and read-safe actions inline.
  //
  // Each replayed assistant message carries ONLY the tool_call it answers (or
  // the vendor 400s "insufficient tool messages") plus reasoning_content (which
  // DeepSeek thinking models require back).
  let convo = [
    ...messages,
    {
      role: "assistant",
      content: completion.content || null,
      ...(completion.reasoning_content
        ? { reasoning_content: completion.reasoning_content }
        : {}),
      tool_calls: [toolCall],
    },
    {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(rows).slice(0, 6000),
    },
  ];
  let usageAcc = {};

  const degradeToData = (extra) => ({
    replyText:
      "Here's what I found:\n```json\n" +
      JSON.stringify(rows, null, 2).slice(0, 1000) +
      "\n```",
    usage: usageAcc,
    queryKey: res.queryKey,
    ...extra,
  });

  for (let round = 0; round < MAX_QUERY_ROUNDS; round++) {
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
        result: rows,
      });
      return fallbackText
        ? { replyText: fallbackText, usage: usageAcc, queryKey: res.queryKey }
        : degradeToData({ degraded: true });
    }
    usageAcc = sumUsage(usageAcc, follow.usage);

    const next = follow.tool_calls && follow.tool_calls[0];

    // No more tool calls → this is the final answer. Guard empty/dump.
    if (!next) {
      let text = (follow.content || "").trim();
      if (!text || looksLikeDump(text)) {
        const fb = await summariseViaFallback({
          vendor,
          messages: convo,
          result: rows,
        });
        if (fb) text = fb;
      }
      return text
        ? { replyText: text, usage: usageAcc, queryKey: res.queryKey }
        : degradeToData({});
    }

    // Replay only the call we answer next (+ reasoning_content).
    const assistantMsg = {
      role: "assistant",
      content: follow.content || null,
      ...(follow.reasoning_content
        ? { reasoning_content: follow.reasoning_content }
        : {}),
      tool_calls: [next],
    };
    const nextArgs = parseArgs(next.function.arguments);

    // (a) Another curated query → run it and keep going.
    if (isQueryTool(next.function.name)) {
      const q = await execute({
        user,
        brand,
        name: next.function.name,
        args: nextArgs,
      });
      const payload = !q
        ? { error: "unknown query" }
        : q.ok
          ? q.rows
          : { error: q.message };
      if (q && q.ok) rows = q.rows; // freshest data for any later fallback
      convo = [
        ...convo,
        assistantMsg,
        {
          role: "tool",
          tool_call_id: next.id,
          content: JSON.stringify(payload).slice(0, 6000),
        },
      ];
      continue;
    }

    // (b) A read-safe catalogue action → chase it inline and keep going.
    const nextAction = byName ? byName.get(next.function.name) : null;
    const readSafe =
      nextAction &&
      nextAction.is_write === false &&
      nextAction.requires_confirmation === false;
    if (readSafe && authHeader) {
      try {
        const exec = await executor.executeAction({
          pending: {
            method: nextAction.method,
            route: nextAction.route,
            payload: nextArgs,
            business: brand,
          },
          authHeader,
          requestId,
        });
        convo = [
          ...convo,
          assistantMsg,
          {
            role: "tool",
            tool_call_id: next.id,
            content: JSON.stringify(exec.result).slice(0, 6000),
          },
        ];
        continue;
      } catch (err) {
        logger.error(
          { err: err.message, action_key: nextAction.action_key },
          "praxis: query-chained action failed",
        );
        return {
          replyText:
            err.user_message ||
            `I looked that up but couldn't finish "${nextAction.title || nextAction.action_key}" — please try again.`,
          usage: usageAcc,
          queryKey: res.queryKey,
        };
      }
    }

    // (c) A write / confirmation-gated / unknown tool — not chaseable in a read
    // turn. Return the model's text if it gave any, else summarise the data.
    const text = (follow.content || "").trim();
    if (text && !looksLikeDump(text)) {
      return { replyText: text, usage: usageAcc, queryKey: res.queryKey };
    }
    const fb = await summariseViaFallback({
      vendor,
      messages: convo,
      result: rows,
    });
    return fb
      ? { replyText: fb, usage: usageAcc, queryKey: res.queryKey }
      : degradeToData({});
  }

  // Rounds exhausted — summarise from the latest data rather than dead-ending.
  const fb = await summariseViaFallback({
    vendor,
    messages: convo,
    result: rows,
  });
  return fb
    ? { replyText: fb, usage: usageAcc, queryKey: res.queryKey }
    : degradeToData({});
}

module.exports = { tools, isQueryTool, execute, run, PREFIX };
