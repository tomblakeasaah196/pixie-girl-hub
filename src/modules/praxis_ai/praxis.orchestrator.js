/**
 * Praxis live orchestrator (X-2 / V2.2 §6.29).
 *
 * One conversational turn:
 *   1. RAG retrieve — embed the user's text and pull the nearest active,
 *      in-scope knowledge chunks (ai_embeddings).
 *   2. LLM call — system prompt + retrieved context + recent history + the
 *      ai_enabled action catalogue exposed as tools.
 *   3. Decide —
 *        • a tool call  → materialise an ai_pending_actions row (the §6.29
 *          human-in-the-loop gate); nothing executes until a human confirms.
 *        • plain text   → a read answer.
 *   4. Trace every step (ai_run_steps) and record real token usage + cost
 *      (governance ledger; vendor per-1k rates).
 *
 * All vendor creds come from AI Control (governance.getVendorConfig). When no
 * vendor is configured `resolveVendor` returns null and the caller falls back
 * to the graceful stub — so this is safe to leave wired in every environment.
 */

"use strict";

const repo = require("./praxis.repo");
const governance = require("../ai_governance/governance.service");
const modelCatalogue = require("../ai_governance/model-catalogue.repo");
const embeddings = require("../../services/embeddings.service");
const llm = require("../../services/llm.service");
const gemini = require("../../services/gemini.service");
const queryAgent = require("./query-agent");
const queryCatalogue = require("./query-catalogue");
const sqlAgent = require("./sql-agent");
const executor = require("./praxis.executor");
const { summariseViaFallback } = require("./fallback-summarise");
const { extendIfTruncated } = require("./continuation");
const { money, toCurrencyString } = require("../../utils/money");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");

const FEATURE = "praxis_chat";
const HISTORY_TURNS = 10;
// Corrective rounds when a catalogue action's route params are missing:
// tool-error feedback → model retries (may look the reference up via a
// query tool first). Bounded so a confused model can't loop the turn.
const MAX_ACTION_ROUNDS = 4;

const safeName = (key) =>
  String(key)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 64);

/**
 * OpenAI-compatible tool `parameters` MUST be a JSON Schema object rooted at
 * `type: "object"` with a `properties` map. A stored payload_schema that isn't
 * shaped that way makes the vendor 400 the whole request, so normalise it.
 */
function normalizeParams(schema) {
  if (
    schema &&
    typeof schema === "object" &&
    !Array.isArray(schema) &&
    schema.type === "object"
  ) {
    return { properties: {}, ...schema };
  }
  return { type: "object", properties: {} };
}

function buildTools(actions) {
  const byName = new Map();
  const tools = [];
  for (const a of actions.slice(0, config.PRAXIS_MAX_TOOLS)) {
    const name = safeName(a.action_key);
    // safeName can collapse two action_keys to the same name; a duplicate tool
    // name is a hard 400 on OpenAI-compatible APIs, so keep the first only.
    if (byName.has(name)) continue;
    byName.set(name, a);
    tools.push({
      type: "function",
      function: {
        name,
        description: a.description || a.title || a.action_key,
        parameters: normalizeParams(a.payload_schema),
      },
    });
  }
  return { tools, byName };
}

/**
 * Route params (`:id` etc.) the payload leaves unfilled. Pure. Used to
 * validate at PROPOSAL time — previously an unresolvable route was only
 * discovered by the executor AFTER the human confirmed the card, so every
 * such proposal was doomed to "missing a required reference".
 */
function missingRouteParams(route, payload) {
  const p = payload || {};
  return (String(route).match(/:([A-Za-z_][A-Za-z0-9_]*)/g) || [])
    .map((s) => s.slice(1))
    .filter((k) => p[k] === undefined || p[k] === null || p[k] === "");
}

function parseToolArgs(raw) {
  try {
    return typeof raw === "string" ? JSON.parse(raw || "{}") : raw || {};
  } catch {
    return {};
  }
}

function addUsage(acc, u) {
  if (!u) return;
  acc.prompt_tokens = (acc.prompt_tokens || 0) + (u.prompt_tokens || 0);
  acc.completion_tokens =
    (acc.completion_tokens || 0) + (u.completion_tokens || 0);
  acc.total_tokens = (acc.total_tokens || 0) + (u.total_tokens || 0);
}

// When we answer a SINGLE tool call, the assistant message we replay must carry
// only that one tool_call. If the model emitted several in one turn and we
// replay all of them but send just one tool response, the vendor rejects the
// request ("number of tool responses must match tool calls") — which made every
// summarise/compose follow-up 400 and fall back to a raw-data dump. Pass the
// specific `only` tool call to keep the exchange balanced.
const asstMsg = (c, only) => ({
  role: "assistant",
  content: c.content || null,
  // DeepSeek thinking models require the reasoning_content that produced a tool
  // call to be replayed with it, or the follow-up 400s.
  ...(c.reasoning_content ? { reasoning_content: c.reasoning_content } : {}),
  tool_calls: only ? [only] : c.tool_calls,
});
const toolMsg = (id, payload) => ({
  role: "tool",
  tool_call_id: id,
  content: JSON.stringify(payload).slice(0, 6000),
});

/** A reply that is (or starts with) a JSON blob is a raw-data dump, never a
 *  real answer — used to catch the model regurgitating tool output. */
function looksLikeDump(text) {
  const t = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .trim();
  return t.startsWith("{") || t.startsWith("[");
}

/**
 * Final synthesis pass: ask the model (no tools) to turn everything gathered so
 * far into a plain-English answer. Used both as the normal closer and to rescue
 * a turn where the model handed back raw JSON. Never throws.
 */
async function synthesizeAnswer({ vendor, convo, usage }) {
  const conv = [
    ...convo,
    {
      role: "user",
      content:
        "Using the data above, answer my original question in clear plain " +
        "English — specific figures and a direct conclusion. Do NOT output " +
        "JSON or raw rows.",
    },
  ];
  try {
    const r = await llm.chat({ vendor, messages: conv });
    if (usage) addUsage(usage, r.usage);
    return (r.content || "").trim();
  } catch (err) {
    logger.warn({ err: err.message }, "praxis: synthesis pass failed");
    return "";
  }
}

/**
 * Resolve a catalogue-action tool call to a finished turn. Bounded loop:
 *
 *   • Route params missing → feed a tool-error back and let the model retry
 *     (it may call a query tool first to look the reference up — those run
 *     mid-chain with their raw rows fed back).
 *   • Read-safe actions (is_write = false AND requires_confirmation = false)
 *     execute INLINE over loopback with the caller's own credentials, and the
 *     result is summarised for the user — no confirm card for plain reads.
 *   • Writes (and confirmation-flagged reads) still go through the §6.29
 *     pending-action human gate — now only with a route known to resolve.
 *
 * @returns {Promise<{replyText:string, pending:object|null, usage:object}>}
 *          `usage` covers only the EXTRA model calls made here.
 */
async function resolveCatalogueAction({
  client,
  vendor,
  user,
  brand,
  messages,
  completion,
  toolCall,
  args,
  byName,
  allTools,
  authHeader,
  requestId,
  userMsg,
  trace,
}) {
  const usage = {};
  const convo = [...messages];

  for (let round = 0; round < MAX_ACTION_ROUNDS; round++) {
    const name = toolCall.function.name;

    // Mid-chain curated query (e.g. campaigns_recent to find a campaign id):
    // run it raw and hand the rows back so the model can fill the action in.
    if (queryAgent.isQueryTool(name)) {
      const q = await queryAgent.execute({ user, brand, name, args });
      const payload = !q ? { error: "unknown query" } : q.ok ? q.rows : { error: q.message };
      await trace({
        step_type: "call_action",
        output: {
          query: (q && q.queryKey) || name,
          mid_chain: true,
          denied: (q && q.denied) || false,
        },
      });
      convo.push(asstMsg(completion, toolCall), toolMsg(toolCall.id, payload));
      let follow;
      try {
        follow = await llm.chat({ vendor, messages: convo, tools: allTools });
      } catch (err) {
        logger.error({ err: err.message }, "praxis: action chain call failed");
        const fb = await summariseViaFallback({
          vendor,
          messages: convo,
          result: payload,
        });
        return {
          replyText:
            fb ||
            "I pulled the data but the summariser is briefly unavailable — please ask me again in a moment.",
          pending: null,
          usage,
          degraded: !fb,
        };
      }
      addUsage(usage, follow.usage);
      const next = follow.tool_calls && follow.tool_calls[0];
      if (next) {
        completion = follow;
        toolCall = next;
        args = parseToolArgs(next.function.arguments);
        continue;
      }
      // Never hand back a raw-data dump — if the model regurgitated JSON (or
      // returned nothing), force one plain-English synthesis pass.
      let replyText = (follow.content || "").trim();
      if (!replyText || looksLikeDump(replyText)) {
        replyText =
          (await synthesizeAnswer({
            vendor,
            convo: [...convo, asstMsg(follow)],
            usage,
          })) || replyText;
      }
      return {
        replyText: replyText || "Here's what I found.",
        pending: null,
        usage,
      };
    }

    // SQL tools mid-chain: the sql-agent runs its own bounded loop and
    // finishes the turn with a text answer.
    if (sqlAgent.isSqlTool(name)) {
      const qr = await sqlAgent.run({
        vendor,
        user,
        brand,
        messages: convo,
        completion,
        toolCall,
        args,
      });
      addUsage(usage, qr.usage);
      await trace({
        step_type: "call_action",
        output: { query: "sql-agent", denied: qr.denied || false },
      });
      return { replyText: qr.replyText || "", pending: null, usage };
    }

    const action = byName.get(name);
    if (!action) {
      return { replyText: completion.content || "", pending: null, usage };
    }

    // Proposal-time route validation — the fix for the FAILED-pending loop.
    const missing = missingRouteParams(action.route, args);
    if (missing.length) {
      await trace({
        step_type: "match_action",
        matched_action_id: action.action_id,
        output: { action_key: action.action_key, missing_params: missing },
        status: "failed",
        error_message: `missing route parameter(s): ${missing.join(", ")}`,
      });
      convo.push(
        asstMsg(completion, toolCall),
        toolMsg(toolCall.id, {
          error:
            `Cannot run ${action.action_key}: required route parameter(s) missing: ${missing.join(", ")}. ` +
            "Look the reference up first (for a campaign, query_campaigns_recent returns campaign_id) " +
            "and call the tool again with it filled in. If the user hasn't said which record they mean, " +
            "ask them instead of guessing.",
        }),
      );
      let follow;
      try {
        follow = await llm.chat({ vendor, messages: convo, tools: allTools });
      } catch (err) {
        logger.error({ err: err.message }, "praxis: param retry call failed");
        return {
          replyText: `I need the ${missing.join(", ")} for “${action.title || action.action_key}” — which record should I use?`,
          pending: null,
          usage,
        };
      }
      addUsage(usage, follow.usage);
      const next = follow.tool_calls && follow.tool_calls[0];
      if (next) {
        completion = follow;
        toolCall = next;
        args = parseToolArgs(next.function.arguments);
        continue;
      }
      return {
        replyText:
          follow.content ||
          `I need the ${missing.join(", ")} for “${action.title || action.action_key}” — which record should I use?`,
        pending: null,
        usage,
      };
    }

    // Read-safe → execute inline. The loopback call re-enters the full
    // middleware pipeline (auth, brand, RBAC, Zod) with the caller's own
    // Authorization header, so this can never do more than the user could.
    const readSafe =
      action.is_write === false && action.requires_confirmation === false;
    if (readSafe && authHeader) {
      let exec;
      try {
        exec = await executor.executeAction({
          pending: {
            method: action.method,
            route: action.route,
            payload: args,
            business: brand,
          },
          authHeader,
          requestId,
        });
      } catch (err) {
        logger.error(
          { err: err.message, action_key: action.action_key },
          "praxis: inline read action failed",
        );
        await trace({
          step_type: "call_action",
          matched_action_id: action.action_id,
          output: { action_key: action.action_key, inline: true },
          status: "failed",
          error_message: err.message,
        });
        return {
          replyText: `I couldn't run “${action.title || action.action_key}” just now — please try again.`,
          pending: null,
          usage,
        };
      }
      await trace({
        step_type: "call_action",
        matched_action_id: action.action_id,
        output: {
          action_key: action.action_key,
          inline: true,
          http_status: exec.http_status,
        },
      });
      convo.push(asstMsg(completion, toolCall), toolMsg(toolCall.id, exec.result));
      try {
        const follow = await llm.chat({ vendor, messages: convo });
        addUsage(usage, follow.usage);
        let replyText = (follow.content || "").trim();
        if (!replyText || looksLikeDump(replyText)) {
          replyText =
            (await synthesizeAnswer({
              vendor,
              convo: [...convo, asstMsg(follow)],
              usage,
            })) || replyText;
        }
        return {
          replyText: replyText || "Here's what I found.",
          pending: null,
          usage,
        };
      } catch (err) {
        logger.error(
          { err: err.message },
          "praxis: inline action summarise failed — trying fallback vendor",
        );
        const fallbackText = await summariseViaFallback({
          vendor,
          messages: convo,
          result: exec.result,
        });
        return {
          replyText:
            fallbackText ||
            (exec.ok
              ? "Here's the raw result — the summariser is briefly unavailable:\n"
              : "The action returned an error:\n") +
              "```json\n" +
              JSON.stringify(exec.result, null, 2).slice(0, 1200) +
              "\n```",
          pending: null,
          usage,
          degraded: !fallbackText,
        };
      }
    }

    // Writes (and confirmation-flagged reads): the human gate, as before.
    const human_summary =
      completion.content || `Proposed: ${action.title || action.action_key}`;
    const pending = await repo.createPendingAction({
      client,
      p: {
        conversation_id: userMsg.conversation_id,
        message_id: userMsg.message_id,
        proposed_by_user_id: user.user_id,
        action_id: action.action_id,
        action_key: action.action_key,
        business: brand,
        method: action.method,
        route: action.route,
        payload: args,
        human_summary,
        confidence:
          action.min_confidence !== null && action.min_confidence !== undefined
            ? action.min_confidence
            : 0.8,
      },
    });
    await trace({
      step_type: "match_action",
      matched_action_id: action.action_id,
      output: { action_key: action.action_key },
    });
    return {
      replyText:
        human_summary +
        "\n\nThis is a proposed action — confirm it to run, or reject it.",
      pending,
      usage,
    };
  }

  return {
    replyText:
      "I couldn't pin down the exact record that action needs. Tell me which record (e.g. which campaign) you mean and I'll try again.",
    pending: null,
    usage,
  };
}

// A compact, static map of the platform so the model always knows the shape of
// the system even before RAG has any corpus. Keep it terse — it's prepended to
// every turn. (Deeper, retrievable detail comes from the embeddings corpus.)
const SYSTEM_MAP = [
  "Pixie Girl Hub is a multi-entity ERP/CRM/e-commerce platform serving two Nigerian beauty businesses — Pixie Girl Global (pixiegirl) and Faitlynhair (faitlynhair) — from one system. Data is isolated per business. Core modules:",
  "• Sales — orders, quotations, POS/quick-sale, revenue.",
  "• Catalogue — products, variants, styled products, pricing.",
  "• Stock — inventory levels, movements, transfers, adjustments.",
  "• CRM — contacts (clients/suppliers/staff), deals/pipeline, activities, 360 timeline.",
  "• Invoicing — invoices, receipts, credit notes, AR ageing.",
  "• Retention — loyalty tiers/points, rewards, earn rules, referrals, coupons, bundles, strategies.",
  "• Purchasing — suppliers, purchase orders (China imports), GRNs, supplier invoices.",
  "• Logistics — deliveries (dispatch vs pickup), couriers, proof of delivery.",
  "• Production / Stylist Studio — in-house service jobs, QC, wig accountability, chemical reconciliation.",
  "• HR & Payroll — staff, attendance, leave, queries, performance, payroll runs, commissions.",
  "• Cash Requests — staff cash/advance requests with finance→CEO approval and disbursement.",
  "• Accounting, Expenses, Pricing, Intercompany, Retail Partners, Storefront Studio, Campaigns, Praxis AI.",
].join("\n");

// Human-readable provenance label for a retrieved chunk, so the model can
// cite honestly ("from the Help centre article X") instead of guessing where
// its context came from.
function chunkLabel(c) {
  if (c.chunk_title) {
    const type = c.chunk_source_type
      ? c.chunk_source_type.replace(/_/g, " ")
      : "knowledge base";
    return `${type}: "${c.chunk_title}"`;
  }
  if (c.source_table === "ai_action_catalogue") return "action catalogue entry";
  return c.source_table || "knowledge base";
}

/** Compact brand-voice block for the system prompt (empty string if unset). */
function renderBrandVoice(bv) {
  if (!bv) return "";
  const lines = [
    "BRAND VOICE — write ALL customer-facing copy (broadcasts, captions, replies, descriptions) in this voice:",
  ];
  if (bv.tone) lines.push(`• Tone: ${bv.tone}`);
  if (bv.voice_summary) lines.push(`• Voice: ${bv.voice_summary}`);
  const dd = bv.do_donts || {};
  if (Array.isArray(dd.do) && dd.do.length)
    lines.push(`• Do: ${dd.do.slice(0, 6).join("; ")}`);
  if (Array.isArray(dd.dont) && dd.dont.length)
    lines.push(`• Don't: ${dd.dont.slice(0, 6).join("; ")}`);
  if (bv.primary_emojis) lines.push(`• Emojis to favour: ${bv.primary_emojis}`);
  if (bv.signature_html) {
    const sig = String(bv.signature_html)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (sig) lines.push(`• Sign off with: ${sig.slice(0, 160)}`);
  }
  const samples = Array.isArray(bv.sample_transcripts) ? bv.sample_transcripts : [];
  if (samples.length) {
    const ex = samples
      .slice(0, 2)
      .map((s) =>
        typeof s === "string"
          ? s
          : s.text || s.body || s.content || JSON.stringify(s),
      )
      .map((t) => `“${String(t).slice(0, 220)}”`);
    lines.push(`• Example phrasings: ${ex.join(" / ")}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

function systemPrompt({
  brand,
  contextChunks,
  user,
  queries = [],
  brandVoice = null,
}) {
  const today = new Date().toISOString().slice(0, 10);
  const role = user?.is_ceo
    ? "the CEO / owner (full access)"
    : "a staff member (scoped to their own permissions)";
  const ctx = contextChunks.length
    ? "RETRIEVED KNOWLEDGE — excerpts from the internal knowledge base " +
      "(help articles, docs, schema notes) that scored closest to this " +
      "question. They may be incomplete or off-topic: use only what is " +
      "genuinely relevant, and if none of it answers the question say you " +
      "don't have that information rather than forcing an answer from these " +
      "excerpts. If asked where an answer came from, these excerpts and " +
      "your tool results are your ONLY sources — name them accurately.\n" +
      contextChunks
        .map(
          (c, i) =>
            `[${i + 1}] (${chunkLabel(c)}, relevance ${Math.round((c.score || 0) * 100)}%) ${c.source_text}`,
        )
        .join("\n\n")
    : "RETRIEVED KNOWLEDGE: nothing in the knowledge base matched this " +
      "question closely enough to include — do not claim knowledge-base " +
      "backing for this answer.";
  const queryList = queries.length
    ? queries.map((q) => `• ${q.title} — ${q.description}`).join("\n")
    : "(no live-data queries are configured yet)";
  const voiceBlock = renderBrandVoice(brandVoice);
  return [
    `You are Praxis, the AI operations assistant inside Pixie Girl Hub. You are acting for the "${brand}" business on behalf of ${role}. Today is ${today}.`,
    "",
    SYSTEM_MAP,
    "",
    "HOW TO ANSWER — READ THIS CAREFULLY:",
    "1. For any CURRENT business figure (sales, revenue, stock, HR, cash, KPIs, counts, statuses…), you MUST call the matching query_* tool to fetch LIVE data. NEVER guess, estimate, average, or invent numbers, names, IDs, dates or statuses.",
    "2. If NO tool and NO retrieved knowledge covers the question, say plainly that you don't have that data available yet — optionally that the relevant query or knowledge hasn't been configured. Do NOT fabricate an answer or describe features you're unsure exist.",
    "3. For anything that CHANGES data (create/update/delete/approve/send), do NOT claim it's done — call the matching action tool with precise arguments; a human confirms before it runs.",
    "4. Be concise and specific; prefer real figures returned by tools over prose. Cite the retrieved knowledge when you use it.",
    "5. You know the LIVE business data and the system's CURRENT shape — you do NOT track the software project's build status. If asked how 'complete', 'finished', 'far along', or what percentage of the app/project is done, or for a roadmap, say plainly that you don't track development progress and can't give a completion figure. Never invent a percentage or progress claim.",
    "6. NEVER paste raw JSON, arrays, or database rows into your reply — the user cannot read those. When a tool returns data, translate it into clear plain-English sentences, a short markdown table, or bullet metrics. A reply that is (or starts with) a JSON blob is always wrong.",
    "7. Actually ANSWER the question asked, in full. If it is evaluative ('was it a success?', 'how did X do?'), give a clear verdict AND the figures that justify it (e.g. revenue, orders, units, conversion, vs. target or the prior period) — call more than one tool if you need to, up to what's allowed. If some data is genuinely unavailable, state what you found and what's missing; never stop half-way or hand back a data dump in place of an answer.",
    "8. DRAFTING/WRITING requests — a WhatsApp/SMS/email broadcast, caption, announcement, product description, or reply — are CONTENT GENERATION, not data lookups. Write the requested text directly, following the BRAND VOICE below (or a warm on-brand tone if none is given). Only call a tool if you need a specific live value to put IN the copy (e.g. the actual names of new-arrival products). If such a lookup returns nothing or errors, still deliver a complete, ready-to-send draft using clear placeholders like [product name] / [price] — NEVER show the user an empty result, a campaigns list, or any query output in place of the draft they asked for.",
    "9. Pick the tool that matches the user's actual intent. Do not run a loosely-related query just to have called something — if no tool genuinely fits (e.g. a pure writing task), don't call one; just do the task.",
    "",
    "LIVE-DATA QUERIES YOU CAN CALL RIGHT NOW:",
    queryList,
    user?.is_ceo
      ? "\nGENERIC DATABASE ACCESS: for anything the queries above don't cover, you also have `sql_schema` (list/describe tables) and `sql_query` (run a single read-only SELECT). Prefer a curated query when one fits; otherwise call `sql_schema` to find the right tables/columns, then `sql_query`. Reads only, scoped to this business."
      : "",
    voiceBlock ? `\n${voiceBlock}` : "",
    "",
    ctx,
  ].join("\n");
}

function computeCost(vendor, usage) {
  const inRate = money(vendor.cost_per_1k_input_tokens || 0);
  const outRate = money(vendor.cost_per_1k_output_tokens || 0);
  const cost = money(usage.prompt_tokens || 0)
    .div(1000)
    .times(inRate)
    .plus(
      money(usage.completion_tokens || 0)
        .div(1000)
        .times(outRate),
    );
  return toCurrencyString(cost);
}

/**
 * Run a live turn. Returns { assistant_message, pending_action } on success, or
 * null when no LLM vendor is configured (caller should use the stub).
 * Inserts DB rows via the passed transaction `client`.
 */
async function orchestrate({
  client,
  user,
  brand,
  conversation,
  userMsg,
  authHeader,
  requestId,
}) {
  const vendor = await llm.resolveVendor(conversation.provider);
  if (!vendor) return null;

  const convId = conversation.conversation_id;
  const userText = userMsg.content || userMsg.transcribed_text || "";
  let step = 0;
  const t0 = Date.now();
  // Trace helper for the action-resolution loop (status defaults to
  // 'completed' in the repo when not supplied).
  const trace = (s) =>
    repo.insertRunStep({
      client,
      s: {
        conversation_id: convId,
        message_id: userMsg.message_id,
        agent: "orchestrator",
        step_number: ++step,
        ...s,
      },
    });

  // 1) RAG retrieve (best-effort; skipped if embeddings not configured).
  // We keep the query vector to also rank the action catalogue below.
  let contextChunks = [];
  let queryVector = null;
  try {
    const vecs = await embeddings.embed(userText);
    if (vecs && vecs[0]) queryVector = `[${vecs[0].join(",")}]`;
    if (queryVector && config.PRAXIS_RAG_TOP_K > 0) {
      contextChunks = await repo.retrieveContext({
        queryVector,
        business: brand,
        limit: config.PRAXIS_RAG_TOP_K,
        minScore: config.PRAXIS_RAG_MIN_SCORE,
      });
    }
  } catch (err) {
    logger.warn({ err: err.message }, "praxis: retrieval failed (continuing)");
  }
  await repo.insertRunStep({
    client,
    s: {
      conversation_id: convId,
      message_id: userMsg.message_id,
      agent: "orchestrator",
      step_number: ++step,
      step_type: "retrieve",
      output: { chunks: contextChunks.length },
      status: "completed",
      duration_ms: Date.now() - t0,
    },
  });

  // 2) Build prompt + tools, call the model
  const priorMessages = await repo.listMessages({ conversation_id: convId });
  const history = priorMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content || "" }));
  let actions = await governance.listActions({ ai_enabled: true });
  // Select the actions most RELEVANT to this turn, so Praxis reaches the right
  // action out of hundreds across every module — not just the first N the tool
  // cap would keep. Requires action embeddings (npm run ai:reindex); if they're
  // not ready or retrieval fails, we fall back to the full list (buildTools
  // still caps it). This is what makes "act across all modules" actually scale.
  if (queryVector && actions.length > config.PRAXIS_MAX_TOOLS) {
    try {
      const ids = await repo.retrieveActionIds({
        queryVector,
        limit: config.PRAXIS_MAX_TOOLS,
      });
      if (ids.length) {
        const order = new Map(ids.map((id, i) => [id, i]));
        const ranked = actions
          .filter((a) => order.has(a.action_id))
          .sort((a, b) => order.get(a.action_id) - order.get(b.action_id));
        if (ranked.length) actions = ranked;
      }
    } catch (err) {
      logger.warn(
        { err: err.message },
        "praxis: action retrieval failed (using default set)",
      );
    }
  }
  const { tools, byName } = buildTools(actions);
  // §8.2 Query Agent: expose the read-only query catalogue as tools too, so the
  // model can answer questions about LIVE data (not just embedded docs).
  // Dedup by function name across both sets — a repeated tool name 400s the API.
  // Generic read-only SQL agent — only for the CEO (see sql-agent safety note).
  // This is what lets Praxis answer ANY live-data question without a curated
  // catalogue entry, so it scales as new tables/features are added.
  const sqlTools = user && user.is_ceo === true ? sqlAgent.tools() : [];
  const seenTool = new Set();
  const allTools = [...tools, ...queryAgent.tools(), ...sqlTools]
    .filter((t) => {
      const n = t?.function?.name;
      if (!n || seenTool.has(n)) return false;
      seenTool.add(n);
      return true;
    })
    // Normalise EVERY tool's parameters (query catalogue included) so one
    // malformed schema can't 400 the whole request.
    .map((t) => ({
      ...t,
      function: {
        ...t.function,
        parameters: normalizeParams(t.function.parameters),
      },
    }));
  // Brand voice — so any drafting the model does this turn is on-voice
  // (tone, signature, do/don'ts). Best-effort; drafting still works without it.
  let brandVoice = null;
  try {
    brandVoice = await governance.getBrandVoice({ brand });
  } catch (err) {
    logger.warn(
      { err: err.message },
      "praxis: brand voice load failed (continuing)",
    );
  }

  const messages = [
    {
      role: "system",
      content: systemPrompt({
        brand,
        contextChunks,
        user,
        queries: queryCatalogue.list(),
        brandVoice,
      }),
    },
    ...history,
    { role: "user", content: userText },
  ];

  let completion;
  const tLlm = Date.now();
  try {
    completion = await llm.chat({ vendor, messages, tools: allTools });
  } catch (err) {
    logger.error({ err: err.message }, "praxis: LLM call failed");
    await repo.insertRunStep({
      client,
      s: {
        conversation_id: convId,
        message_id: userMsg.message_id,
        agent: "orchestrator",
        step_number: ++step,
        step_type: "call_model",
        status: "failed",
        error_message: err.message,
        duration_ms: Date.now() - tLlm,
      },
    });
    const assistant = await repo.insertMessage({
      client,
      m: {
        conversation_id: convId,
        role: "assistant",
        content:
          "I couldn't reach the AI service just now. Please try again in a moment.",
        provider: vendor.vendor,
        model: vendor.default_model,
      },
    });
    await repo.touchConversation({ client, id: convId });
    await recordUsageSafe({
      user,
      brand,
      convId,
      vendor,
      model: vendor.default_model,
      usage: {},
      cost_ngn: "0",
      ok: false,
    });
    return { assistant_message: assistant, pending_action: null };
  }

  const usage = completion.usage || {};
  let costNgn = computeCost(vendor, usage);
  await repo.insertRunStep({
    client,
    s: {
      conversation_id: convId,
      message_id: userMsg.message_id,
      agent: "orchestrator",
      step_number: ++step,
      step_type: "call_model",
      output: { has_tool_call: completion.tool_calls.length > 0 },
      tokens_used: usage.total_tokens || null,
      cost_ngn: costNgn,
      status: "completed",
      duration_ms: Date.now() - tLlm,
    },
  });

  // 3) Decide: tool call (write → pending action) or plain answer (read)
  let pending = null;
  let replyText = completion.content || "";
  // Flips false when a read path exhausts its summariser and falls back to a
  // raw-JSON dump — the usage ledger and trace previously showed these as
  // ordinary successes, so there was no way to see how often this degraded
  // in production without grepping logs by hand.
  let ok = true;

  const toolCall = completion.tool_calls[0];
  if (toolCall && toolCall.function) {
    let args = {};
    try {
      args =
        typeof toolCall.function.arguments === "string"
          ? JSON.parse(toolCall.function.arguments || "{}")
          : toolCall.function.arguments || {};
    } catch {
      args = {};
    }
    const isRead =
      queryAgent.isQueryTool(toolCall.function.name) ||
      sqlAgent.isSqlTool(toolCall.function.name);
    if (isRead) {
      // Read path — curated Query Catalogue OR the generic SQL agent (CEO).
      // Both return { replyText, usage } and never write. The query agent
      // additionally gets allTools/byName/authHeader so a lookup (e.g. "find
      // our last campaign") can chase ONE further hop into a read-safe
      // catalogue action (e.g. "was it a success?") instead of dead-ending
      // with no tools to continue the chain — see query-agent.run's docstring.
      const isSql = sqlAgent.isSqlTool(toolCall.function.name);
      const qr = isSql
        ? await sqlAgent.run({ vendor, user, brand, messages, completion, toolCall, args })
        : await queryAgent.run({
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
          });
      if (qr.replyText) replyText = qr.replyText;
      const fu = qr.usage || {};
      if (fu.total_tokens) {
        usage.prompt_tokens =
          (usage.prompt_tokens || 0) + (fu.prompt_tokens || 0);
        usage.completion_tokens =
          (usage.completion_tokens || 0) + (fu.completion_tokens || 0);
        usage.total_tokens = (usage.total_tokens || 0) + (fu.total_tokens || 0);
        costNgn = computeCost(vendor, usage);
      }
      if (qr.degraded) ok = false;
      await repo.insertRunStep({
        client,
        s: {
          conversation_id: convId,
          message_id: userMsg.message_id,
          agent: "orchestrator",
          step_number: ++step,
          step_type: "call_action",
          output: {
            query: qr.queryKey || (qr.sql ? "sql-agent" : null),
            chained_action: qr.chainedAction || null,
            denied: qr.denied || false,
          },
          status: qr.degraded ? "failed" : "completed",
          error_message: qr.degraded
            ? "summariser exhausted (primary + fallback vendor) — degraded to raw data"
            : null,
        },
      });
    } else {
      const r = await resolveCatalogueAction({
        client,
        vendor,
        user,
        brand,
        messages,
        completion,
        toolCall,
        args,
        byName,
        allTools,
        authHeader,
        requestId,
        userMsg,
        trace,
      });
      pending = r.pending;
      if (r.replyText) replyText = r.replyText;
      if (r.degraded) ok = false;
      addUsage(usage, r.usage);
      if (r.usage && r.usage.total_tokens) costNgn = computeCost(vendor, usage);
    }
  } else if (completion.finish_reason === "length") {
    // A direct (no-tool) answer the vendor cut off at the token cap — continue
    // it so a long single-shot reply is never shipped half-written.
    replyText = await extendIfTruncated({
      vendor,
      baseMessages: messages,
      text: replyText,
      finishReason: completion.finish_reason,
      usage,
    });
    costNgn = computeCost(vendor, usage);
  }

  if (!replyText) replyText = "Done.";

  const assistant = await repo.insertMessage({
    client,
    m: {
      conversation_id: convId,
      role: "assistant",
      content: replyText,
      pending_action_id: pending ? pending.pending_id : null,
      input_tokens: usage.prompt_tokens || null,
      output_tokens: usage.completion_tokens || null,
      provider: vendor.vendor,
      model: completion.model,
    },
  });
  await repo.touchConversation({
    client,
    id: convId,
    tokens: usage.total_tokens || 0,
    cost_ngn: costNgn,
  });

  await recordUsageSafe({
    user,
    brand,
    convId,
    vendor,
    model: completion.model,
    usage,
    cost_ngn: costNgn,
    ok,
  });

  return { assistant_message: assistant, pending_action: pending };
}

async function recordUsageSafe({
  user,
  brand,
  convId,
  vendor,
  model,
  usage,
  cost_ngn,
  ok,
}) {
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        conversation_id: convId,
        provider: vendor.vendor,
        model,
        call_type: "chat_completion",
        input_tokens: usage.prompt_tokens || 0,
        output_tokens: usage.completion_tokens || 0,
        total_tokens: usage.total_tokens || 0,
        cost_native: cost_ngn,
        cost_ngn,
        was_successful: ok,
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, "praxis: usage record failed");
  }
}

// ──────────────────────────────────────────────────────────────────
// Smartcomm draft — single-turn brand-voice reply for the composer
// "Draft with Praxis" button (PR 3 / PR 5).
//
// Different shape from `orchestrate`:
//   - No RAG, no tools, no pending actions. Single chat completion.
//   - Tries the primary vendor (PRAXIS_LLM_VENDOR, default deepseek),
//     falls back to the configured fallback (PRAXIS_LLM_FALLBACK_VENDOR,
//     default gemini) on retryable failure.
//   - Costs read from ai_model_catalogue, not the legacy vendor.cost_*.
//   - Returns { text, usage } in the shape smartcomm.praxis-draft.js
//     expects (provider/model/input_tokens/output_tokens/cost_ngn).
// ──────────────────────────────────────────────────────────────────

const PRIMARY_VENDOR = () => config.PRAXIS_LLM_VENDOR || "deepseek";
const FALLBACK_VENDOR = () => config.PRAXIS_LLM_FALLBACK_VENDOR || "gemini";

function buildSmartcommPrompt(ctx) {
  const lines = [];
  lines.push(
    `You are drafting a customer-service reply on behalf of the ${ctx.brand} business.`,
    "Write ONE concise message ready to send — no preamble, no quotation marks, no 'Sure, here is...'. Just the reply text.",
  );
  // Name the recipient explicitly. Without this the model can only guess from
  // the transcript and may greet a staff member by name instead of the
  // customer. "Staff" turns in the transcript are the business, not the person
  // being written to.
  if (ctx.customer_name && ctx.customer_name !== "the customer") {
    lines.push(
      `You are writing to the customer, ${ctx.customer_name}. If you address them by name, use theirs — never a staff member's name.`,
    );
  }
  if (ctx.tone) lines.push(`Tone: ${ctx.tone}.`);
  if (ctx.voice_summary) lines.push(`Voice: ${ctx.voice_summary}`);
  if (ctx.platform && ctx.platform !== "internal") {
    lines.push(
      `Channel: ${ctx.platform}. Keep it short, mobile-friendly, conversational.`,
    );
  }
  if (ctx.preferred_channel) {
    lines.push(`Customer prefers replies on: ${ctx.preferred_channel}.`);
  }
  if (ctx.primary_emojis && ctx.primary_emojis.length) {
    lines.push(
      `Brand emoji palette (use sparingly): ${ctx.primary_emojis.join(" ")}`,
    );
  }
  const dos = (ctx.do_donts && ctx.do_donts.do) || [];
  const donts = (ctx.do_donts && ctx.do_donts.dont) || [];
  if (dos.length) lines.push(`Always: ${dos.join("; ")}.`);
  if (donts.length) lines.push(`Never: ${donts.join("; ")}.`);
  if (ctx.sample_transcripts && ctx.sample_transcripts.length) {
    lines.push("Tone-match examples:");
    for (const s of ctx.sample_transcripts.slice(0, 3)) {
      if (s.customer && s.staff) {
        lines.push(`- Customer: "${s.customer}"\n  Brand: "${s.staff}"`);
      }
    }
  }
  if (ctx.signature_html) {
    // Strip HTML for the system prompt — model treats signatures literally.
    const sig = String(ctx.signature_html)
      .replace(/<[^>]+>/g, "")
      .trim();
    if (sig) lines.push(`End with this signature: ${sig}`);
  }
  return lines.join("\n");
}

function transcriptToMessages(transcript, customerName) {
  if (!transcript) {
    return [
      {
        role: "user",
        content: `(${customerName} just opened the conversation — write a warm opener.)`,
      },
    ];
  }
  // Convert "Customer: ..." / "Staff: ..." lines to message objects so
  // the model sees genuine roles, not one block of text.
  const out = [];
  for (const line of transcript.split("\n")) {
    const m = /^(Customer|Staff|System|[A-Z][a-zA-Z]+):\s*(.*)$/.exec(line);
    if (!m) {
      if (out.length) out[out.length - 1].content += "\n" + line;
      else out.push({ role: "user", content: line });
      continue;
    }
    const isCustomer = m[1] === "Customer";
    out.push({
      role: isCustomer ? "user" : "assistant",
      content: m[2],
    });
  }
  // Ensure the last message is from the customer so the model knows to
  // reply, not echo us.
  if (out.length && out[out.length - 1].role !== "user") {
    out.push({
      role: "user",
      content: `(Now write the next reply from ${customerName}'s brand.)`,
    });
  }
  return out;
}

async function callVendor(vendorName, { system, messages }) {
  if (vendorName === "gemini") {
    if (!gemini.isConfigured()) {
      const e = new Error("GEMINI_NOT_CONFIGURED");
      e.code = "VENDOR_NOT_CONFIGURED";
      e.retryable = false;
      throw e;
    }
    const model = await modelCatalogue.resolveActiveModel({
      vendor: "gemini",
      capability: "chat",
    });
    const result = await gemini.chatCompletion({
      system,
      messages,
      model: model ? model.model_id : undefined,
      temperature: 0.6,
      maxOutputTokens: 600,
    });
    return { ...result, modelRow: model };
  }
  // Default: OpenAI-compatible vendors via llm.service.
  const vendor = await llm.resolveVendor(vendorName);
  if (!vendor) {
    const e = new Error(`${vendorName.toUpperCase()}_NOT_CONFIGURED`);
    e.code = "VENDOR_NOT_CONFIGURED";
    e.retryable = false;
    throw e;
  }
  const model = await modelCatalogue.resolveActiveModel({
    vendor: vendorName,
    capability: "chat",
  });
  const completion = await llm.chat({
    vendor,
    model: model ? model.model_id : vendor.default_model,
    messages: [{ role: "system", content: system }, ...messages],
    temperature: 0.6,
  });
  return {
    text: completion.content || "",
    input_tokens: (completion.usage && completion.usage.prompt_tokens) || 0,
    output_tokens:
      (completion.usage && completion.usage.completion_tokens) || 0,
    model: completion.model,
    vendor: vendorName,
    modelRow: model,
  };
}

/**
 * Generate a single Smartcomm reply draft. Vendor fallback is built in:
 * primary fails → fallback tried automatically. The cost calculation
 * uses the model catalogue (so switching `gemini-2.5-flash` →
 * `gemini-2.5-flash-lite` in the UI immediately reduces the per-call
 * spend).
 *
 * Throws `AI_UNAVAILABLE` only when BOTH vendors fail to produce a
 * draft. Caller (smartcomm.praxis-draft) catches and surfaces the
 * deterministic stub.
 *
 * @param {object} args
 * @param {object} args.user
 * @param {string} args.brand
 * @param {object} args.context  — see smartcomm.praxis-draft.js promptContext
 */
async function generateSmartcommDraft({ user, brand, context }) {
  const system = buildSmartcommPrompt(context);
  const messages = transcriptToMessages(
    context.transcript,
    context.customer_name || "the customer",
  );

  const primary = PRIMARY_VENDOR();
  const fallback = FALLBACK_VENDOR();

  // Primary attempt
  let result = null;
  let lastError = null;
  try {
    result = await callVendor(primary, { system, messages });
  } catch (err) {
    lastError = err;
    if (!err.retryable && err.code === "VENDOR_NOT_CONFIGURED") {
      logger.warn(
        { vendor: primary, err: err.message },
        "smartcomm draft: primary vendor not configured; trying fallback",
      );
    } else {
      logger.warn(
        { vendor: primary, err: err.message },
        "smartcomm draft: primary vendor failed; trying fallback",
      );
    }
  }

  // Fallback
  if (!result && primary !== fallback) {
    try {
      result = await callVendor(fallback, { system, messages });
    } catch (err) {
      lastError = err;
      logger.error(
        { vendor: fallback, err: err.message },
        "smartcomm draft: fallback vendor also failed",
      );
    }
  }

  if (!result) {
    const e = new Error(
      `Both ${primary} and ${fallback} failed: ${lastError ? lastError.message : "no result"}`,
    );
    e.code = "AI_UNAVAILABLE";
    throw e;
  }

  const costNgn = result.modelRow
    ? modelCatalogue.computeCost({
        model: result.modelRow,
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
      })
    : "0";

  // Persist usage row on the AI ledger so the spend meter sees it.
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        provider: result.vendor,
        model: result.model,
        call_type: "smartcomm_draft",
        input_tokens: result.input_tokens,
        output_tokens: result.output_tokens,
        total_tokens: (result.input_tokens || 0) + (result.output_tokens || 0),
        cost_native: costNgn,
        cost_ngn: costNgn,
        was_successful: true,
      },
    });
  } catch (err) {
    logger.warn(
      { err: err.message },
      "smartcomm draft: usage record failed (continuing)",
    );
  }

  return {
    text: result.text,
    usage: {
      provider: result.vendor,
      model: result.model,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      total_tokens: (result.input_tokens || 0) + (result.output_tokens || 0),
      cost_native: costNgn,
      cost_ngn: costNgn,
      was_successful: true,
    },
  };
}

module.exports = { orchestrate, generateSmartcommDraft, missingRouteParams };
