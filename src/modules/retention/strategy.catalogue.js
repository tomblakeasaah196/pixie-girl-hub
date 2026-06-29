/**
 * Self-describing catalogue for the retention strategy engine (Module 6.23).
 *
 * One endpoint (GET /api/v1/retention/strategies/catalogue) returns everything
 * a UI needs to render the no-code, template-first builder generically:
 * the available triggers, the customer fields + operators conditions can use,
 * the action types and their config schemas, and the template library. The
 * builder never hard-codes engine knowledge — it reads it from here.
 */

"use strict";

const conditions = require("./strategy.conditions");
const templates = require("./strategy.templates");

// Triggers. `kind: event` = fired by a live domain event; `scheduled` = found
// by the daily scanner. `condition_fields` lists facts most relevant to each.
const TRIGGERS = [
  { key: "first_purchase", label: "First purchase", kind: "event", description: "A customer places their very first order." },
  { key: "order_placed", label: "Any order placed", kind: "event", description: "A customer places (and pays for) an order." },
  { key: "high_value_purchase", label: "High-value purchase", kind: "event", description: "A customer places an order above a value you set." },
  { key: "order_delivered", label: "Order delivered", kind: "event", description: "An order is marked delivered." },
  { key: "review_left", label: "Review left", kind: "event", description: "A customer leaves a product review." },
  { key: "tier_upgrade", label: "Loyalty tier upgrade", kind: "event", description: "A customer moves up a loyalty tier." },
  { key: "tier_downgrade", label: "Loyalty tier downgrade", kind: "event", description: "A customer drops a loyalty tier." },
  { key: "referral_completed", label: "Referral completed", kind: "event", description: "A friend a customer referred makes a qualifying purchase." },
  { key: "points_milestone", label: "Points milestone", kind: "event", description: "A customer crosses a points balance milestone." },
  { key: "cart_abandoned", label: "Cart abandoned", kind: "event", description: "A customer leaves items in their cart." },
  { key: "birthday", label: "Birthday", kind: "scheduled", description: "It is the customer's birthday." },
  { key: "anniversary", label: "Signup anniversary", kind: "scheduled", description: "The anniversary of the customer joining." },
  { key: "inactivity", label: "Gone quiet", kind: "scheduled", description: "A customer has not ordered for a while." },
  { key: "win_back", label: "Win back", kind: "scheduled", description: "A lapsed customer you want to re-engage." },
  { key: "reorder_reminder", label: "Reorder reminder", kind: "scheduled", description: "It may be time for the customer to reorder." },
  { key: "subscription_renewal_reminder", label: "Renewal reminder", kind: "scheduled", description: "A subscription or maintenance plan is due to renew soon." },
  { key: "points_expiring", label: "Points expiring", kind: "scheduled", description: "A customer has points about to expire." },
  { key: "custom_event", label: "Custom event", kind: "event", description: "A custom event you fire from elsewhere in the Hub." },
];

// Customer facts available to conditions (see strategy.facts.build).
const CONDITION_FIELDS = [
  { key: "days_since_last_order", label: "Days since last order", type: "number", sample: 60 },
  { key: "order_count", label: "Number of orders", type: "number", sample: 3 },
  { key: "lifetime_spend", label: "Lifetime spend (₦)", type: "number", sample: 150000 },
  { key: "points_balance", label: "Points balance", type: "number", sample: 1200 },
  { key: "lifetime_points", label: "Lifetime points earned", type: "number", sample: 5000 },
  { key: "tier_key", label: "Loyalty tier", type: "string", sample: "gold" },
  { key: "has_ordered", label: "Has ordered before", type: "boolean", sample: true },
  { key: "days_since_signup", label: "Days since signup", type: "number", sample: 365 },
  { key: "tags", label: "Contact tags", type: "array", sample: ["vip"] },
  { key: "order_total", label: "This order's total (₦)", type: "number", sample: 80000 },
];

const OPERATORS = [
  { key: "eq", label: "is" },
  { key: "neq", label: "is not" },
  { key: "gt", label: "is more than" },
  { key: "gte", label: "is at least" },
  { key: "lt", label: "is less than" },
  { key: "lte", label: "is at most" },
  { key: "in", label: "is one of" },
  { key: "nin", label: "is not one of" },
  { key: "contains", label: "contains" },
  { key: "exists", label: "is set" },
  { key: "not_exists", label: "is not set" },
].filter((op) => conditions.OPERATOR_KEYS.includes(op.key));

// Action types + their config schemas. `email` is the canonical channel.
const ACTIONS = [
  {
    key: "send_email",
    label: "Send an email",
    description: "Email the customer (respects consent, quiet hours and frequency caps).",
    config_schema: [
      { key: "subject", label: "Subject", type: "string", required: true },
      { key: "html", label: "Email body (HTML)", type: "richtext", required: true },
      { key: "email_template_id", label: "Use a saved template instead", type: "uuid", required: false },
    ],
  },
  {
    key: "issue_coupon",
    label: "Give a coupon",
    description: "Create a single-use coupon for this customer.",
    config_schema: [
      { key: "discount_type", label: "Discount type", type: "enum", options: ["percentage", "fixed_amount", "free_shipping"], required: true },
      { key: "discount_value", label: "Amount", type: "number", required: true },
      { key: "code_prefix", label: "Code prefix", type: "string", required: false },
    ],
  },
  {
    key: "award_points",
    label: "Award loyalty points",
    description: "Add bonus points to the customer's balance.",
    config_schema: [
      { key: "points", label: "Points", type: "number", required: true },
      { key: "notes", label: "Reason", type: "string", required: false },
    ],
  },
  {
    key: "add_to_segment",
    label: "Tag the customer",
    description: "Apply a tag so the customer can be targeted later.",
    config_schema: [{ key: "tag", label: "Tag", type: "string", required: true }],
  },
  {
    key: "assign_to_user",
    label: "Assign to a team member",
    description: "Create a follow-up owned by a staff member.",
    config_schema: [
      { key: "user_id", label: "Team member", type: "uuid", required: true },
      { key: "title", label: "Title", type: "string", required: false },
    ],
  },
  {
    key: "create_task",
    label: "Create a task",
    description: "Add a task to the team's list.",
    config_schema: [
      { key: "title", label: "Title", type: "string", required: true },
      { key: "description", label: "Details", type: "string", required: false },
      { key: "user_id", label: "Assign to", type: "uuid", required: false },
    ],
  },
  {
    key: "notify_team",
    label: "Notify the team",
    description: "Send an in-app notification to a team member.",
    config_schema: [
      { key: "user_id", label: "Team member", type: "uuid", required: true },
      { key: "title", label: "Title", type: "string", required: false },
      { key: "body", label: "Message", type: "string", required: false },
    ],
  },
];

function build() {
  return {
    triggers: TRIGGERS,
    condition_fields: CONDITION_FIELDS,
    operators: OPERATORS,
    actions: ACTIONS,
    templates: templates.list(),
  };
}

module.exports = { build, TRIGGERS, CONDITION_FIELDS, OPERATORS, ACTIONS };
