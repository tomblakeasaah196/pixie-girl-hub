/**
 * Praxis SQL Agent (§8.2 — generic read layer).
 *
 * The curated Query Catalogue is fast and safe but doesn't scale: someone has to
 * hand-add an entry for every question. This agent gives Praxis the ability to
 * answer ANY live-data question by discovering the schema and running a
 * read-only SELECT — so new tables/features are automatically queryable with no
 * catalogue work.
 *
 * SAFETY CONTRACT (this touches financial + PII data, so guardrails are hard):
 *   • CEO-only. Exposed to the model only when the caller is the CEO/owner.
 *     (Field-level RBAC over arbitrary SQL isn't feasible; broadening to staff
 *     later needs read-only VIEWS that pre-mask cost/salary/origin.)
 *   • Reads only. Query must start with SELECT/WITH; a hard keyword blocklist +
 *     `SET TRANSACTION READ ONLY` reject any write/DDL even if validation slips.
 *   • Single statement. No stacked queries, no comments.
 *   • Business isolation. search_path is pinned to the caller's brand schema +
 *     shared, and references to the OTHER brand's schema are rejected.
 *   • Bounded. LIMIT + statement_timeout cap rows and runtime.
 *
 * Two tools are exposed:
 *   sql_schema — list tables, or describe one table's columns (live).
 *   sql_query  — run a single read-only SELECT.
 * The model typically calls sql_schema to learn the shape, then sql_query.
 */

"use strict";

const llm = require("../../services/llm.service");
const { query, transaction } = require("../../config/database");
const { logger } = require("../../config/logger");
const { summariseViaFallback } = require("./fallback-summarise");

const ROW_CAP = 200;
const TIMEOUT_MS = 6000;
const MAX_ITERS = 5; // schema→query round-trips within one user turn
const KNOWN_BRANDS = new Set(["pixiegirl", "faitlynhair"]);

const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Anything that isn't a pure read. Word-boundary matched so column names like
// created_at / updated_at / call_type don't trip it.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|reindex|cluster|call|do|merge|lock|listen|notify|prepare|execute|discard|dblink|pg_read_file|pg_ls_dir|pg_sleep|lo_import|lo_export|set_config|pg_terminate_backend)\b/i;

function tools() {
  return [
    {
      type: "function",
      function: {
        name: "sql_schema",
        description:
          "[READ] Discover the live database schema for THIS business. Call with no args to list all tables (brand + shared schemas); call with `table` to get a table's columns. Use this to find the right tables/columns before writing a query.",
        parameters: {
          type: "object",
          properties: {
            table: {
              type: "string",
              description:
                "Optional table name (unqualified, e.g. 'sales_orders') to describe its columns.",
            },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "sql_query",
        description:
          "[READ] Run a single read-only SQL SELECT against THIS business's data and get the rows back. Reads only — no INSERT/UPDATE/DELETE/DDL. Use unqualified table names (they resolve to this brand's schema first, then shared). Always constrain and aggregate as needed; results are capped.",
        parameters: {
          type: "object",
          properties: {
            sql: {
              type: "string",
              description: "A single SELECT / WITH…SELECT statement.",
            },
            purpose: {
              type: "string",
              description: "One line: what this query answers (optional).",
            },
          },
          required: ["sql"],
        },
      },
    },
  ];
}

function isSqlTool(name) {
  return name === "sql_schema" || name === "sql_query";
}

/** @returns {string|null} error message, or null if the SELECT is allowed. */
function validateSelect(rawSql, brand) {
  if (typeof rawSql !== "string" || !rawSql.trim())
    return "empty query";
  const sql = rawSql.trim().replace(/;+\s*$/, "");
  if (sql.includes(";")) return "only a single statement is allowed";
  if (/--|\/\*/.test(sql)) return "SQL comments are not allowed";
  if (!/^(select|with)\b/i.test(sql))
    return "only read-only SELECT / WITH queries are allowed";
  if (FORBIDDEN.test(sql))
    return "the query contains a disallowed (non-read) keyword";
  const other = brand === "pixiegirl" ? "faitlynhair" : "pixiegirl";
  if (new RegExp(`\\b${other}\\.`, "i").test(sql))
    return `cross-business queries aren't allowed — you're scoped to ${brand}`;
  return null;
}

async function execSchema({ brand, table }) {
  if (table) {
    const { rows } = await query(
      `SELECT table_schema, table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = ANY($1) AND table_name = $2
        ORDER BY table_schema, ordinal_position`,
      [[brand, "shared"], table],
    );
    if (!rows.length) return { table, note: "no such table in scope", columns: [] };
    return {
      table,
      columns: rows.map((r) => `${r.table_schema}.${r.column_name} ${r.data_type}`),
    };
  }
  const { rows } = await query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name`,
    [[brand, "shared"]],
  );
  return { tables: rows.map((r) => `${r.table_schema}.${r.table_name}`) };
}

async function execQuery({ brand, sql }) {
  const err = validateSelect(sql, brand);
  if (err) return { error: err };
  const clean = sql.trim().replace(/;+\s*$/, "");
  const wrapped = `SELECT * FROM (${clean}) _praxis_q LIMIT ${ROW_CAP}`;
  return transaction(async (client) => {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${TIMEOUT_MS}`);
    await client.query(`SET LOCAL search_path = "${brand}", shared`);
    const r = await client.query(wrapped);
    return {
      row_count: r.rowCount,
      truncated: r.rowCount >= ROW_CAP,
      columns: r.fields ? r.fields.map((f) => f.name) : [],
      rows: r.rows,
    };
  });
}

async function dispatch(brand, name, args) {
  if (name === "sql_schema") return execSchema({ brand, table: str(args.table) });
  if (name === "sql_query") {
    try {
      return await execQuery({ brand, sql: str(args.sql) || "" });
    } catch (e) {
      // A DB error (bad column, timeout, etc.) is fed back so the model can fix
      // its own query on the next iteration.
      return { error: `database error: ${e.message}` };
    }
  }
  return { error: "unknown tool" };
}

function parseArgs(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return {};
  }
}

function accUsage(acc, u) {
  if (!u) return;
  acc.prompt_tokens += u.prompt_tokens || 0;
  acc.completion_tokens += u.completion_tokens || 0;
  acc.total_tokens += u.total_tokens || 0;
}

/** Fence raw JSON so the chat's Markdown renderer can't shred it (bare
 *  snake_case becomes italics: order_number → order*number*). */
function fencedResult(result, intro) {
  return (
    intro +
    "\n```json\n" +
    JSON.stringify(result, null, 2).slice(0, 1200) +
    "\n```"
  );
}

/**
 * Agentic read loop: run the model's sql tool call, feed the result back, and
 * let it call again (discover schema → query → answer) until it produces a
 * natural-language answer. Mirrors query-agent.run's contract.
 */
async function run({ vendor, user, brand, messages, completion, toolCall, args }) {
  if (!user || user.is_ceo !== true) {
    return { replyText: "Direct database queries are limited to the CEO.", usage: {}, denied: true };
  }
  if (!KNOWN_BRANDS.has(brand)) {
    return { replyText: "I can't determine which business to query.", usage: {} };
  }

  const convo = [
    ...messages,
    { role: "assistant", content: completion.content || null, tool_calls: completion.tool_calls },
  ];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const sqlTools = tools();
  let cur = toolCall;
  let curArgs = args;

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let result;
    try {
      result = await dispatch(brand, cur.function.name, curArgs);
    } catch (e) {
      logger.error({ err: e.message }, "praxis sql-agent dispatch failed");
      result = { error: e.message };
    }
    convo.push({
      role: "tool",
      tool_call_id: cur.id,
      content: JSON.stringify(result).slice(0, 8000),
    });

    let follow;
    try {
      follow = await llm.chat({ vendor, messages: convo, tools: sqlTools });
    } catch (e) {
      logger.error(
        { err: e.message },
        "praxis sql-agent summarise failed — retrying once",
      );
      // Retry the primary once, then the fallback vendor, then a fenced raw
      // dump as the true last resort (never bare JSON into Markdown).
      try {
        follow = await llm.chat({ vendor, messages: convo, tools: sqlTools });
      } catch (e2) {
        logger.error(
          { err: e2.message },
          "praxis sql-agent summarise retry failed — trying fallback vendor",
        );
        const fallbackText = await summariseViaFallback({ messages, result });
        return {
          replyText:
            fallbackText ||
            fencedResult(
              result,
              "I ran the query but couldn't compose a summary just now. Raw result:",
            ),
          usage,
          sql: true,
          // No natural-language answer was produced — the trace/usage ledger
          // should show this as a failed turn, not a silent success, or ops
          // has no way to see how often this degrades in production.
          degraded: !fallbackText,
        };
      }
    }
    accUsage(usage, follow.usage);

    const next = follow.tool_calls && follow.tool_calls[0];
    if (next && isSqlTool(next.function.name)) {
      convo.push({
        role: "assistant",
        content: follow.content || null,
        tool_calls: follow.tool_calls,
      });
      cur = next;
      curArgs = parseArgs(next.function.arguments);
      continue;
    }
    // Never return a raw JSON/rows dump as the answer — if the model did that
    // (or returned nothing), do one plain-English synthesis pass with no tools.
    let text = (follow.content || "").trim();
    const dump =
      text.replace(/^```(?:json)?/i, "").trim().startsWith("{") ||
      text.replace(/^```(?:json)?/i, "").trim().startsWith("[");
    if (!text || dump) {
      try {
        const s = await llm.chat({
          vendor,
          messages: [
            ...convo,
            { role: "assistant", content: follow.content || null },
            {
              role: "user",
              content:
                "Answer my question in plain English using the data above — " +
                "specific figures and a clear conclusion. Do NOT output JSON or rows.",
            },
          ],
        });
        accUsage(usage, s.usage);
        if (s.content && s.content.trim()) text = s.content.trim();
      } catch (e) {
        logger.warn({ err: e.message }, "praxis sql-agent synthesis pass failed");
      }
    }
    return { replyText: text || "Here's what I found.", usage, sql: true };
  }
  return {
    replyText:
      "That took too many query steps — please narrow the question and I'll try again.",
    usage,
    sql: true,
  };
}

module.exports = { tools, isSqlTool, run };
