/**
 * Daily briefing (J-5 / PD §6.30). Runs 07:00 Africa/Lagos.
 *
 * TWO-TIER (§6.30):
 *   Tier 1 (always on, zero AI cost) — compose a plain-language briefing for
 *     each brand from the live AI-insight open-counts.
 *   Tier 2 (scheduled, low cost) — when the CEO has turned narration on for a
 *     module (ai_insight_modules.narration_enabled) AND the `insights_briefing`
 *     feature is usable AND a vendor is configured, Praxis reads the SUMMARISED
 *     counts (never raw records — §8.4 cost rule) and writes the CEO a short
 *     plain-language narrative, metered on the governance ledger.
 *
 * Tier 2 degrades to Tier 1 on any miss (no vendor, budget hard-cap, error), so
 * the briefing is never blank and enabling insights never risks surprise spend.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { config } = require("../../config/env");
const insights = require("../../modules/ai_insights/insights.service");
const insightsRepo = require("../../modules/ai_insights/insights.repo");
const governance = require("../../modules/ai_governance/governance.service");
const llm = require("../../services/llm.service");
const { money, toCurrencyString } = require("../../utils/money");

const { BRANDS } = require("../../config/brands");

const NARRATION_FEATURE = "insights_briefing";

// Keyed by unified-store module (shared.ai_insight_modules). Any module the
// summary reports that isn't listed here still counts toward the totals via
// the fallback in buildBriefing.
const LABELS = {
  invoicing: "overdue invoice(s)",
  stock: "low-stock alert(s)",
  pricing: "margin breach(es)",
  intercompany: "stale inter-company item(s)",
  hr_attendance: "attendance anomaly(ies)",
  approvals: "pending approval(s)",
  service_jobs: "service-match flag(s)",
  sales: "sales alert(s)",
  crm: "CRM alert(s)",
  purchasing: "purchasing alert(s)",
  logistics: "logistics alert(s)",
  expenses: "expense/cash alert(s)",
  production: "production alert(s)",
  retention: "retention alert(s)",
  accounting: "accounting alert(s)",
};

function labelFor(mod) {
  return LABELS[mod] || `${mod.replace(/_/g, " ")} alert(s)`;
}

function buildBriefing(brand, counts) {
  const lines = [];
  let total = 0;
  let urgent = 0;
  // Iterate whatever modules the summary reported (not a fixed list), so a
  // newly-enabled module shows up without editing this job.
  for (const [mod, c] of Object.entries(counts || {})) {
    total += c.open;
    urgent += c.urgent;
    if (c.open > 0) {
      lines.push(
        `• ${c.open} ${labelFor(mod)}${c.urgent ? ` (${c.urgent} urgent)` : ""}`,
      );
    }
  }
  const head =
    total === 0
      ? `Good morning. No open items for ${brand} today — all clear.`
      : `Good morning. ${brand} has ${total} open item(s)${urgent ? `, ${urgent} urgent` : ""}:`;
  return { text: [head, ...lines].join("\n"), total };
}

async function findCeoUserId() {
  try {
    const { rows } = await query(
      `SELECT user_id FROM shared.users WHERE is_ceo = true ORDER BY created_at LIMIT 1`,
    );
    return rows[0] ? rows[0].user_id : null;
  } catch {
    return null;
  }
}

/**
 * Tier-2: narrate the summarised counts with the LLM. Returns
 * { text, provider, model, tokens, cost_ngn } or null (caller keeps the
 * deterministic text). Never throws.
 */
async function narrate({ brand, counts, total, ceoId }) {
  try {
    if (!ceoId || !total) return null; // nothing to narrate / no recipient
    const narrationOn = await insightsRepo.narrationModules();
    if (!narrationOn.length) return null; // no module opted in
    const guard = await governance.canUseFeature({
      user_id: ceoId,
      feature_key: NARRATION_FEATURE,
      is_ceo: true,
    });
    if (!guard.ok) return null; // feature off or budget hard-capped
    const vendor = await llm.resolveVendor(config.PRAXIS_LLM_VENDOR || "deepseek");
    if (!vendor) return null; // no credentials → deterministic

    const facts = Object.entries(counts)
      .filter(([, c]) => c.open > 0)
      .map(
        ([mod, c]) =>
          `- ${labelFor(mod)}: ${c.open}${c.urgent ? ` (${c.urgent} urgent)` : ""}`,
      )
      .join("\n");
    const system = [
      `You are Praxis, writing the CEO's short morning briefing for the ${brand} business.`,
      "You are given SUMMARISED counts of open operational alerts — never raw records.",
      "Write 2–4 short sentences: what stands out, what it means, and what to look at first. Lead with anything urgent. Plain, calm, specific. No greeting, no bullet points, no markdown.",
    ].join("\n");
    const completion = await llm.chat({
      vendor,
      messages: [
        { role: "system", content: system },
        { role: "user", content: `Open alerts for ${brand} today:\n${facts}\n\nTotal ${total} open.` },
      ],
      temperature: 0.4,
    });
    const text = (completion.content || "").trim();
    if (!text) return null;

    const usage = completion.usage || {};
    const cost = money(usage.prompt_tokens || 0)
      .div(1000)
      .times(money(vendor.cost_per_1k_input_tokens || 0))
      .plus(
        money(usage.completion_tokens || 0)
          .div(1000)
          .times(money(vendor.cost_per_1k_output_tokens || 0)),
      );
    const cost_ngn = toCurrencyString(cost);

    try {
      await governance.recordUsage({
        usage: {
          user_id: ceoId,
          feature_key: NARRATION_FEATURE,
          business: brand,
          provider: vendor.vendor,
          model: completion.model,
          call_type: "insight_narration",
          input_tokens: usage.prompt_tokens || 0,
          output_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0,
          cost_native: cost_ngn,
          cost_ngn,
          was_successful: true,
        },
      });
    } catch (err) {
      logger.warn({ err: err.message }, "briefing narration usage record failed");
    }

    return {
      text,
      provider: vendor.vendor,
      model: completion.model,
      tokens: usage.total_tokens || 0,
      cost_ngn,
    };
  } catch (err) {
    logger.warn({ err: err.message, brand }, "briefing narration failed; using deterministic");
    return null;
  }
}

async function runDailyAiBriefing() {
  const recipient = await findCeoUserId();
  let made = 0;
  let narrated = 0;
  for (const brand of BRANDS) {
    try {
      const counts = await insights.summary({ brand });
      const { text, total } = buildBriefing(brand, counts);

      // Tier-2 narration (falls back to the deterministic text on any miss).
      const ai = await narrate({ brand, counts, total, ceoId: recipient });
      if (ai) narrated += 1;

      const { rows: inserted } = await query(
        `INSERT INTO shared.ai_briefings
           (business, schedule_type, scheduled_for, window_start, window_end,
            recipient_user_id, source_summary, briefing_text, insight_count,
            provider, model, tokens_used, cost_ngn, status, generated_at)
         VALUES ($1,'daily', now(), now() - interval '24 hours', now(),
                 $2, $3::jsonb, $4, $5, $6, $7, $8, $9, 'generated', now())
         RETURNING briefing_id`,
        [
          brand,
          recipient,
          JSON.stringify(counts),
          ai ? ai.text : text,
          total,
          ai ? ai.provider : "deterministic",
          ai ? ai.model : "rules",
          ai ? ai.tokens : 0,
          ai ? ai.cost_ngn : 0,
        ],
      );
      made += 1;

      // Link the briefing to the findings behind it (paragraph → alert refs,
      // top open items by severity at generation time). Best-effort.
      if (total > 0 && inserted[0]) {
        try {
          const top = await insightsRepo.topOpenInsights({
            business: brand,
            limit: 10,
          });
          if (top.length) {
            await insightsRepo.insertBriefingRefs({
              briefing_id: inserted[0].briefing_id,
              refs: top,
            });
          }
        } catch (err) {
          logger.warn({ err: err.message, brand }, "briefing refs failed");
        }
      }
    } catch (err) {
      logger.error({ err: err.message, brand }, "daily briefing failed");
    }
  }
  logger.info({ made, narrated }, "daily AI briefings generated");
  return { made, narrated };
}

module.exports = { runDailyAiBriefing };
