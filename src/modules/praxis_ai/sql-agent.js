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
const MAX_ITERS = 7; // schema→query round-trips within one user turn
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
          "[READ] Discover the live database schema for THIS business. Call with no args to list ALL tables (brand + shared schemas); call with `table` to get its columns AND its foreign-key links, shown as `column → other_table.column` (e.g. `styled_products.base_product_id → products.product_id`). ALWAYS inspect the tables you intend to join BEFORE writing a query, and join on the columns those arrows show. If a table isn't found the result lists SIMILAR table names — silently try those, never report table names to the user. To find where something lives (order items, returns, refunds, etc.), call with no args and scan the full list before ever concluding the data 'doesn't exist'. Keep going until you can answer.",
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
          "[READ] Run a single read-only SQL SELECT against THIS business's data and get the rows back. Reads only — no INSERT/UPDATE/DELETE/DDL. Use unqualified table names (they resolve to this brand's schema first, then shared). Before you aggregate, sql_schema the tables involved to confirm exact column names and how they join (use the `→` foreign-key links). Answer the whole question in ONE query: JOIN on the FK columns, filter the date range, GROUP BY the entity asked about, and SUM/COUNT — when asked for a breakdown or ranking (top customers, by product, by month…) NEVER return a bare grand total. If a query errors, read the error message and correct the query. Results are capped.",
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

/**
 * Tables named close to a wrong guess (e.g. 'catalogue_products' when the
 * real table is 'products') — surfaced so the model can self-correct on its
 * NEXT call instead of guessing blind or falling back to a full table list.
 * Every wasted schema round trip eats into MAX_ITERS and raises the odds of
 * landing on the two-consecutive-vendor-failure path that degrades the turn.
 */
async function suggestSimilarTables({ brand, table }) {
  const words = table.split(/[^a-z0-9]+/i).filter((w) => w.length >= 3);
  if (!words.length) return [];
  const { rows } = await query(
    `SELECT DISTINCT table_schema, table_name
       FROM information_schema.tables
      WHERE table_schema = ANY($1) AND table_type = 'BASE TABLE'
        AND table_name ILIKE ANY($2)
      ORDER BY table_name LIMIT 15`,
    [[brand, "shared"], words.map((w) => `%${w}%`)],
  );
  return rows.map((r) => `${r.table_schema}.${r.table_name}`);
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
    if (!rows.length) {
      const similar = await suggestSimilarTables({ brand, table });
      return {
        table,
        note: similar.length
          ? "no such table in scope — did you mean one of similar_tables?"
          : "no such table in scope",
        columns: [],
        ...(similar.length ? { similar_tables: similar } : {}),
      };
    }
    // Foreign keys, so the model can SEE how this table links to others (e.g.
    // styled_products.base_product_id → products.product_id) instead of guessing
    // relationships from column names.
    const { rows: fks } = await query(
      `SELECT att.attname AS column,
              fn.nspname AS ref_schema, fc.relname AS ref_table,
              fatt.attname AS ref_column
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_class fc ON fc.oid = con.confrelid
         JOIN pg_namespace fn ON fn.oid = fc.relnamespace
         JOIN generate_subscripts(con.conkey, 1) AS s(i) ON true
         JOIN pg_attribute att
           ON att.attrelid = c.oid AND att.attnum = con.conkey[s.i]
         JOIN pg_attribute fatt
           ON fatt.attrelid = fc.oid AND fatt.attnum = con.confkey[s.i]
        WHERE con.contype = 'f' AND n.nspname = ANY($1) AND c.relname = $2`,
      [[brand, "shared"], table],
    );
    const fkBy = new Map(
      fks.map((f) => [
        f.column,
        `${f.ref_schema === brand ? "" : f.ref_schema + "."}${f.ref_table}.${f.ref_column}`,
      ]),
    );
    return {
      table,
      columns: rows.map((r) => {
        const fk = fkBy.get(r.column_name);
        return `${r.table_schema}.${r.column_name} ${r.data_type}${fk ? ` → ${fk}` : ""}`;
      }),
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

/**
 * Detect database-mechanics leaking into a user-facing answer. Deep in a schema
 * exploration the model anchors on table/column text and produces replies like
 * "the credit_notes table does not exist" or "the provided data only describes
 * …" — which is broken UX. When this fires we rewrite the answer cleanly.
 */
function looksLikeDbSpeak(text) {
  const t = String(text || "");
  return (
    /\b(provided|given) data\b/i.test(t) ||
    /\bno such table\b|\bdoes not exist\b/i.test(t) ||
    /\bschemas?\b|\bcolumns?\b/i.test(t) ||
    /\bis not a (clear|specific|valid)?\s*(question|request)\b/i.test(t) ||
    /\bthe [a-z]+_[a-z_]+ table\b/i.test(t) ||
    /\b(sales_order_lines|credit_notes|cancellation_requests|order_lines)\b/i.test(
      t,
    )
  );
}

/**
 * Run ONE sql tool call and return its raw result payload — the per-hop
 * primitive the query-agent read loop uses to chain a curated-query turn into a
 * generic SQL lookup (e.g. "top styled product" -> "trace it to its base
 * product"). Enforces the same CEO-only + brand-scope guardrails `run` does;
 * never throws (a DB/permission problem comes back as `{ error }` for the model
 * to read and adapt to).
 *
 * @returns {Promise<object>} schema/rows payload, or `{ error }`.
 */
async function dispatchTool({ user, brand, name, args }) {
  if (!user || user.is_ceo !== true) {
    return { error: "Direct database queries are limited to the CEO." };
  }
  if (!KNOWN_BRANDS.has(brand)) {
    return { error: "I can't determine which business to query." };
  }
  try {
    return await dispatch(brand, name, args || {});
  } catch (e) {
    logger.error({ err: e.message }, "praxis sql-agent dispatchTool failed");
    return { error: `database error: ${e.message}` };
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
    // Replay ONLY the tool call we answer below — carrying every tool_call while
    // sending one tool response makes the vendor 400 ("tool responses must match
    // tool calls"), which is what forced the raw-result fallback dumps.
    // DeepSeek thinking models also require reasoning_content to be replayed.
    {
      role: "assistant",
      content: completion.content || null,
      ...(completion.reasoning_content
        ? { reasoning_content: completion.reasoning_content }
        : {}),
      tool_calls: [toolCall],
    },
  ];
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const sqlTools = tools();
  let cur = toolCall;
  let curArgs = args;
  let lastResult = null; // most recent tool result, for the exhaustion fallback

  for (let iter = 0; iter < MAX_ITERS; iter++) {
    let result;
    try {
      result = await dispatch(brand, cur.function.name, curArgs);
    } catch (e) {
      logger.error({ err: e.message }, "praxis sql-agent dispatch failed");
      result = { error: e.message };
    }
    lastResult = result;
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
        const fallbackText = await summariseViaFallback({
          vendor,
          messages,
          result,
        });
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
        ...(follow.reasoning_content
          ? { reasoning_content: follow.reasoning_content }
          : {}),
        tool_calls: [next], // replay only the call we answer next (see above)
      });
      cur = next;
      curArgs = parseArgs(next.function.arguments);
      continue;
    }
    // Never return a raw JSON/rows dump as the answer — if the model did that
    // (or returned nothing), do one plain-English synthesis pass with no tools.
    // A NON-sql tool call we won't chase is the same trap: its `content` is
    // usually just a "Let me check…" preamble to an action we're dropping, so
    // shipping it verbatim is exactly the half-sentence cut-off we're fixing —
    // force the synthesis pass so the user gets a complete answer instead.
    const hasUnhandledToolCall = Boolean(next);
    let text = (follow.content || "").trim();
    const dump =
      text.replace(/^```(?:json)?/i, "").trim().startsWith("{") ||
      text.replace(/^```(?:json)?/i, "").trim().startsWith("[");
    if (!text || dump || hasUnhandledToolCall) {
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
    // Final guard: if the answer leaked database mechanics, rewrite it into a
    // plain business reply with a FRESH, un-anchored call (schema context can't
    // drag this one back into db-speak). Real figures are preserved.
    if (looksLikeDbSpeak(text)) {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      try {
        const r = await llm.chat({
          vendor,
          messages: [
            {
              role: "system",
              content:
                "You are Praxis, a business operations assistant. Rewrite the DRAFT as a natural reply to the user's question in plain BUSINESS language. NEVER mention tables, columns, schemas, SQL, or 'the provided/given data'. If the draft says data is missing or a table doesn't exist, restate it as a business fact (e.g. 'we don't track product returns in the system yet'). Keep any real figures and names. If the user's message was just chit-chat or a vague 'hmmm', reply naturally and briefly — don't lecture about questions.",
            },
            {
              role: "user",
              content: `User said: ${(lastUser && lastUser.content) || "(see draft)"}\n\nDRAFT:\n${text}`,
            },
          ],
        });
        accUsage(usage, r.usage);
        if (r.content && r.content.trim()) text = r.content.trim();
      } catch (e) {
        logger.warn(
          { err: e.message },
          "praxis sql-agent db-speak rewrite failed",
        );
      }
    }
    return { replyText: text || "Here's what I found.", usage, sql: true };
  }
  // Tool budget exhausted. The convo now ends with an assistant tool_call we
  // never answered, so we can't just append to it (that recreates the
  // "insufficient tool messages" 400). Instead summarise the LAST result with a
  // fresh, clean call (minimal primary → gemini) — turning a dead-end into a
  // best-effort answer.
  const fb = await summariseViaFallback({ vendor, messages, result: lastResult });
  return {
    replyText:
      fb ||
      "I couldn't fully pin that down in a few steps. Could you narrow it a little — e.g. a date range or the specific metric you want?",
    usage,
    sql: true,
  };
}

module.exports = { tools, isSqlTool, run, dispatchTool };
