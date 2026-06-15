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
const { logger } = require("../../config/logger");

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
 * Run a query tool the model selected, then summarise the live result.
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
}) {
  const entry = entryForTool(toolCall.function.name);
  if (!entry) return { replyText: null, usage: {} };

  if (!(await hasView(user, entry.module))) {
    return {
      replyText: `You don't have permission to view ${entry.module} data, so I can't answer that.`,
      usage: {},
      denied: true,
      queryKey: entry.key,
    };
  }

  let rows;
  try {
    rows = await entry.run({ brand, args: args || {}, user });
  } catch (err) {
    logger.error({ err: err.message, query: entry.key }, "praxis query failed");
    return {
      replyText: "I couldn't run that lookup just now — please try again.",
      usage: {},
      error: true,
      queryKey: entry.key,
    };
  }

  // Feed the result back so the model answers in natural language.
  const followMessages = [
    ...messages,
    {
      role: "assistant",
      content: completion.content || null,
      tool_calls: completion.tool_calls,
    },
    {
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify(rows).slice(0, 6000),
    },
  ];

  try {
    const follow = await llm.chat({ vendor, messages: followMessages });
    return {
      replyText: follow.content || "Here's what I found.",
      usage: follow.usage || {},
      queryKey: entry.key,
    };
  } catch (err) {
    logger.error({ err: err.message }, "praxis query summarise failed");
    // Degrade to a compact data answer rather than failing the turn.
    return {
      replyText: "Here's what I found:\n" + JSON.stringify(rows).slice(0, 1000),
      usage: {},
      queryKey: entry.key,
    };
  }
}

module.exports = { tools, isQueryTool, run, PREFIX };
