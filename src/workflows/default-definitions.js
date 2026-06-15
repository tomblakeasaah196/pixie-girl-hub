/**
 * Canonical workflow definitions (V2.2 §6.27 + §3 approval thresholds).
 *
 * These are the approval routes the business runs on, authored as DATA. They
 * are the single source of truth shared by:
 *   - the engine (engine.js) — lazily materialises a brand's definition the
 *     first time a trigger fires and none exists, so approvals work before
 *     the §6.27 Builder UI is in place;
 *   - the seed script (scripts/seed-workflows.js) — pre-materialises all of
 *     them for every configured brand so they appear in the Builder list.
 *
 * Keyed by `${trigger_module}:${trigger_action}` — the same key the engine
 * derives when a service calls openInstance(). Define new approval routes
 * here and they are picked up by both consumers automatically.
 *
 * THRESHOLD SEMANTICS (per WORKFLOWS.md): tiers are MUTUALLY EXCLUSIVE.
 * A ₦250k expense routes straight to the CEO tier (gt 200000); the manager
 * tier (lte 200000) is skipped, not run first. For a cumulative
 * "manager THEN CEO on large amounts" route, drop the threshold on stage 1
 * (so it always applies) and keep `threshold_ngn_gt` on stage 2.
 *
 * Money fields in `context` are plain numbers (NGN). The triggering service
 * is responsible for putting the relevant amount on the context under the
 * field named by each stage's `threshold_field`.
 */

"use strict";

const DEFINITIONS = {
  // ── Expenses (§6.7) — manager up to ₦200k, CEO above ────────────────────
  "expenses:submit": {
    name: "Expense Approval",
    description:
      "Manager approves expenses up to ₦200,000; the CEO approves anything above. Tiers are exclusive.",
    trigger_module: "expenses",
    trigger_action: "submit",
    definition: {
      trigger: { module: "expenses", action: "submit" },
      stages: [
        {
          order: 1,
          name: "Manager approval (≤ ₦200k)",
          approvers: [{ type: "role", value: "manager" }],
          threshold_field: "total_ngn",
          threshold_ngn_lte: 200000,
          timeout_hours: 48,
          on_timeout: "escalate",
          fallback_to_deputy: true,
        },
        {
          order: 2,
          name: "CEO approval (> ₦200k)",
          approvers: [{ type: "role", value: "ceo" }],
          threshold_field: "total_ngn",
          threshold_ngn_gt: 200000,
          timeout_hours: 48,
          on_timeout: "escalate",
          fallback_to_deputy: false,
        },
      ],
    },
  },

  // ── Purchasing (§6.8) — manager up to ₦500k, CEO above ──────────────────
  "purchasing:submit": {
    name: "Purchase Order Approval",
    description:
      "Manager approves purchase orders up to ₦500,000; the CEO approves anything above.",
    trigger_module: "purchasing",
    trigger_action: "submit",
    definition: {
      trigger: { module: "purchasing", action: "submit" },
      stages: [
        {
          order: 1,
          name: "Manager approval (≤ ₦500k)",
          approvers: [{ type: "role", value: "manager" }],
          threshold_field: "total_ngn",
          threshold_ngn_lte: 500000,
          timeout_hours: 48,
          on_timeout: "escalate",
          fallback_to_deputy: true,
        },
        {
          order: 2,
          name: "CEO approval (> ₦500k)",
          approvers: [{ type: "role", value: "ceo" }],
          threshold_field: "total_ngn",
          threshold_ngn_gt: 500000,
          timeout_hours: 48,
          on_timeout: "escalate",
          fallback_to_deputy: false,
        },
      ],
    },
  },

  // ── Sales discounts (§6.2/§6.25) — manager up to ₦50k, CEO above ────────
  "sales:discount": {
    name: "Discount Approval",
    description:
      "Manager approves discounts up to ₦50,000 in value; the CEO approves larger concessions.",
    trigger_module: "sales",
    trigger_action: "discount",
    definition: {
      trigger: { module: "sales", action: "discount" },
      stages: [
        {
          order: 1,
          name: "Manager approval (≤ ₦50k discount)",
          approvers: [{ type: "role", value: "manager" }],
          threshold_field: "discount_ngn",
          threshold_ngn_lte: 50000,
          timeout_hours: 24,
          on_timeout: "escalate",
          fallback_to_deputy: true,
        },
        {
          order: 2,
          name: "CEO approval (> ₦50k discount)",
          approvers: [{ type: "role", value: "ceo" }],
          threshold_field: "discount_ngn",
          threshold_ngn_gt: 50000,
          timeout_hours: 24,
          on_timeout: "escalate",
          fallback_to_deputy: false,
        },
      ],
    },
  },

  // ── Sales order cancellation (§6.2) — manager sign-off ──────────────────
  "sales:cancel": {
    name: "Sales Order Cancellation",
    description:
      "A manager must approve cancellation of a confirmed sales order.",
    trigger_module: "sales",
    trigger_action: "cancel",
    definition: {
      trigger: { module: "sales", action: "cancel" },
      stages: [
        {
          order: 1,
          name: "Manager approval",
          approvers: [{ type: "role", value: "manager" }],
          timeout_hours: 24,
          on_timeout: "escalate",
          fallback_to_deputy: true,
        },
      ],
    },
  },

  // ── Price changes (§6.25) — CEO only ────────────────────────────────────
  "pricing:change": {
    name: "Price Change Approval",
    description: "All price changes require CEO approval (V2.2 §3).",
    trigger_module: "pricing",
    trigger_action: "change",
    definition: {
      trigger: { module: "pricing", action: "change" },
      stages: [
        {
          order: 1,
          name: "CEO approval",
          approvers: [{ type: "role", value: "ceo" }],
          timeout_hours: 72,
          on_timeout: "escalate",
          fallback_to_deputy: false,
        },
      ],
    },
  },

  // ── Inter-company trade (§5.1) — CEO only, sensitive cross-entity ───────
  "intercompany:create": {
    name: "Inter-Company Transaction Approval",
    description:
      "Cross-entity trade between Pixie Girl Global and Faitlynhair requires CEO approval before the invoice pair is raised.",
    trigger_module: "intercompany",
    trigger_action: "create",
    definition: {
      trigger: { module: "intercompany", action: "create" },
      stages: [
        {
          order: 1,
          name: "CEO approval",
          approvers: [{ type: "role", value: "ceo" }],
          timeout_hours: 72,
          on_timeout: "escalate",
          fallback_to_deputy: false,
        },
      ],
    },
  },

  // ── Sales campaigns (§6.22) — CEO sign-off before a campaign goes live ──
  "sales_campaigns:submit": {
    name: "Campaign Approval",
    description: "Single-stage CEO approval for sales campaigns.",
    trigger_module: "sales_campaigns",
    trigger_action: "submit",
    definition: {
      trigger: { module: "sales_campaigns", action: "submit" },
      stages: [
        {
          order: 1,
          name: "CEO approval",
          approvers: [{ type: "role", value: "ceo" }],
          timeout_hours: 48,
          on_timeout: "escalate",
          fallback_to_deputy: true,
        },
      ],
    },
  },

  // ── Cash Request (§6.32) — Finance validates, CEO approves above threshold ─
  "cash_request:submit": {
    name: "Cash Request Approval",
    description:
      "Finance validates all cash requests. Requests at or above the CEO threshold (default ₦100k from business_config) additionally require CEO approval. When no Finance role is assigned, the CEO handles all stages.",
    trigger_module: "cash_request",
    trigger_action: "submit",
    definition: {
      trigger: { module: "cash_request", action: "submit" },
      stages: [
        {
          order: 1,
          name: "Finance validation",
          approvers: [
            { type: "role", value: "finance" },
            { type: "role", value: "ceo" },
          ],
          timeout_hours: 24,
          on_timeout: "escalate",
          fallback_to_deputy: true,
        },
        {
          order: 2,
          name: "CEO approval (≥ threshold)",
          approvers: [{ type: "role", value: "ceo" }],
          threshold_field: "amount_requested_ngn",
          threshold_ngn_gte: 100000,
          timeout_hours: 48,
          on_timeout: "escalate",
          fallback_to_deputy: false,
        },
      ],
    },
  },
};

function specKey(triggerModule, triggerAction) {
  return `${triggerModule}:${triggerAction}`;
}

function getSpec(triggerModule, triggerAction) {
  return DEFINITIONS[specKey(triggerModule, triggerAction)] || null;
}

function allSpecs() {
  return Object.values(DEFINITIONS);
}

module.exports = { DEFINITIONS, specKey, getSpec, allSpecs };
