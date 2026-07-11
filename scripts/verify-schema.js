#!/usr/bin/env node
/**
 * Schema verification — runs after migrate/bootstrap to confirm expected state.
 * Output is a quick health report; non-zero exit on any failure.
 *
 * Brand schemas are discovered from shared.business_config (the same source
 * the app boots from), so this works for any brand keys, not hardcoded ones.
 */

"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

// Baseline counts after shared 000251 + brand template 000075. Brands are
// discovered from shared.business_config (the same source the app boots from),
// so this works for any brand keys — not hardcoded pixiegirl/faitlynhair.
//   - Accounting foundation (main): brand template 000075 adds variant_costing
//     per brand (policy Q9) → per-brand 203.
//   - Stylist Programme v2 (000251): +8 shared tables (stylist_tiers,
//     stylist_programme_config, stylist_questionnaire_questions,
//     stylist_application_responses, stylist_vetting_reviews,
//     stylist_referral_links, stylist_referral_attributions,
//     stylist_notifications) → shared 170 + 8 = 178. Its brand template adds a
//     column only (sales_orders.stylist_referral_code), no new table.
//   - Unified AI Insights store (000256): +2 shared tables (ai_insights,
//     ai_insight_modules) → shared 178 + 2 = 180.
//   - HR rewards engine (000258_shared_hr_rewards): +2 shared tables
//     (reward_rules, reward_grants) → shared 180 + 2 = 182.
//   - Insights legacy cleanup (000257_shared_ai_insights_cleanup): −7 shared
//     tables (the per-category ai_insight_* tables from 000012, superseded by
//     the unified store) → shared 182 − 7 = 175.
//   - HR onboarding (000259_shared_hr_onboarding): +1 (staff_onboarding_progress).
//   - Signer page (000260_shared_esign_signer_pin): +1 (signer_signatures).
//     175 + 1 + 1 = 177.
//   - AI vendor health (000309): +2 (ai_vendor_health_pings, ai_incidents) → 179.
//   - Smartcomm order links (000317): +2 (smartcomm_order_links,
//     service_booking_requests) → 181.
//   - Recruitment (000318): +5 (recruitment_context, role_templates,
//     job_openings, candidates, recruitment_offers) → 186.
//   - WhatsApp calling (000319): +2 (whatsapp_calls, whatsapp_call_events) → 188.
//   - Chief of Staff goals (000320-000321): +4 (goals, goal_milestones,
//     goal_stakeholders, workspace_notes) → 192.
//   - Chief of Staff agent (000324): +1 (ai_pending_plans) → 193.
//     (ai_conversations.kind, ai_action_catalogue.surface, ai_pending_actions
//      plan_id/plan_step are ALTERs, not new tables.)
const EXPECTED_SHARED = 193;
const EXPECTED_PER_BRAND = 203;

async function countTables(schema) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema = $1`,
    [schema],
  );
  return rows[0].n;
}

async function main() {
  const { rows: brands } = await pool.query(
    `SELECT business_key FROM shared.business_config WHERE is_active = true ORDER BY business_key`,
  );
  const checks = [["shared", EXPECTED_SHARED]];
  for (const b of brands) checks.push([b.business_key, EXPECTED_PER_BRAND]);

  process.stdout.write("Schema table counts:\n");
  let ok = true;
  for (const [schema, expected] of checks) {
    const actual = await countTables(schema);
    const status = actual === expected ? "✓" : "✗";
    process.stdout.write(
      `  ${status} ${schema}: ${actual} (expected ${expected})\n`,
    );
    if (actual !== expected) ok = false;
  }
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
