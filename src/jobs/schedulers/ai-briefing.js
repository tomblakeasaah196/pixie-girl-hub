/**
 * Daily briefing (J-5 / PD §6.30), Tier-1 deterministic.
 * Runs 07:00 Africa/Lagos.
 *
 * Composes a plain-language briefing for each brand from the live AI-insight
 * open-counts (no LLM, no AI cost) and stores it in shared.ai_briefings for the
 * CEO. When the LLM narration layer (src/ai) is credentialed it can replace the
 * deterministic text; the data + delivery path are identical, so this is the
 * Tier-1 always-on baseline the PD describes.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const insights = require("../../modules/ai_insights/insights.service");

const { BRANDS } = require("../../config/brands");

const LABELS = {
  invoice: "overdue invoice(s)",
  stock: "low-stock alert(s)",
  margin: "margin breach(es)",
  intercompany: "stale inter-company item(s)",
  attendance: "attendance anomaly(ies)",
  approval: "pending approval(s)",
  service_match: "service-match flag(s)",
};

function buildBriefing(brand, counts) {
  const lines = [];
  let total = 0;
  let urgent = 0;
  for (const [cat, label] of Object.entries(LABELS)) {
    const c = counts[cat] || { open: 0, urgent: 0 };
    total += c.open;
    urgent += c.urgent;
    if (c.open > 0) {
      lines.push(
        `• ${c.open} ${label}${c.urgent ? ` (${c.urgent} urgent)` : ""}`,
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

async function runDailyAiBriefing() {
  const recipient = await findCeoUserId();
  let made = 0;
  for (const brand of BRANDS) {
    try {
      const counts = await insights.summary({ brand });
      const { text, total } = buildBriefing(brand, counts);
      await query(
        `INSERT INTO shared.ai_briefings
           (business, schedule_type, scheduled_for, window_start, window_end,
            recipient_user_id, source_summary, briefing_text, insight_count,
            provider, model, tokens_used, cost_ngn, status, generated_at)
         VALUES ($1,'daily', now(), now() - interval '24 hours', now(),
                 $2, $3::jsonb, $4, $5, 'deterministic', 'rules', 0, 0,
                 'generated', now())`,
        [brand, recipient, JSON.stringify(counts), text, total],
      );
      made += 1;
    } catch (err) {
      logger.error({ err: err.message, brand }, "daily briefing failed");
    }
  }
  logger.info({ made }, "daily AI briefings generated");
  return { made };
}

module.exports = { runDailyAiBriefing };
