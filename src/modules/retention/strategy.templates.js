/**
 * Retention strategy template library (Module 6.23).
 *
 * Ready-made, plain-language playbooks the owner can start from in one click —
 * the backbone of the template-first builder UX. Each template expands into a
 * `retention_strategies` row + `retention_strategy_steps` rows. These mirror
 * the inactive seeds shipped in template/000066 so "create from template" and
 * the seeded drafts stay consistent.
 *
 * Tokens in email copy ({{first_name}}, {{brand_name}}) are resolved at send
 * time from the customer facts (strategy.facts).
 */

"use strict";

const DAY = 1440; // minutes

/** @type {Array<object>} */
const TEMPLATES = [
  {
    template_key: "welcome_series",
    name: "Welcome new customers",
    description:
      "Greets a customer after their first purchase and nudges a second order.",
    trigger_type: "first_purchase",
    trigger_conditions: {},
    defaults: { max_enrollments_per_customer: 1 },
    steps: [
      {
        wait_minutes: 0,
        action_type: "send_email",
        description: "Welcome email, immediately",
        action_config: {
          subject: "Welcome to {{brand_name}}, {{first_name}}!",
          html: "<p>Hi {{first_name}}, thank you for your first order. We are so glad you are here.</p>",
        },
      },
      {
        wait_minutes: 3 * DAY,
        action_type: "send_email",
        description: "Thank-you email, 3 days later",
        action_config: {
          subject: "A little something for your next visit",
          html: "<p>Hi {{first_name}}, here is a treat for your next order with {{brand_name}}.</p>",
        },
      },
    ],
  },
  {
    template_key: "win_back_60d",
    name: "Win back quiet customers",
    description: "Re-engages customers who have not ordered in 60 days.",
    trigger_type: "win_back",
    trigger_conditions: {
      all: [{ field: "days_since_last_order", op: "gte", value: 60 }],
    },
    defaults: { reenroll_cooldown_days: 90 },
    steps: [
      {
        wait_minutes: 0,
        action_type: "send_email",
        description: "We-miss-you email, immediately",
        action_config: {
          subject: "We miss you, {{first_name}}",
          html: "<p>It has been a while! Come see what is new at {{brand_name}}.</p>",
        },
      },
      {
        wait_minutes: 4 * DAY,
        action_type: "send_email",
        description: "Comeback coupon email, 4 days later",
        action_config: {
          subject: "A gift to welcome you back",
          html: "<p>Hi {{first_name}}, here is a little something to welcome you back to {{brand_name}}.</p>",
        },
      },
    ],
  },
  {
    template_key: "birthday",
    name: "Birthday treat",
    description: "Sends a birthday wish with a treat on the customer's birthday.",
    trigger_type: "birthday",
    trigger_conditions: {},
    defaults: { reenroll_cooldown_days: 300 },
    steps: [
      {
        wait_minutes: 0,
        action_type: "send_email",
        description: "Birthday email, on the day",
        action_config: {
          subject: "Happy birthday, {{first_name}}! 🎉",
          html: "<p>Happy birthday from all of us at {{brand_name}} — enjoy a birthday treat on us.</p>",
        },
      },
    ],
  },
  {
    template_key: "vip_upgrade",
    name: "Celebrate a tier upgrade",
    description: "Congratulates a customer when they reach a new loyalty tier.",
    trigger_type: "tier_upgrade",
    trigger_conditions: {},
    defaults: {},
    steps: [
      {
        wait_minutes: 0,
        action_type: "send_email",
        description: "Congratulations email, immediately",
        action_config: {
          subject: "You have levelled up, {{first_name}}!",
          html: "<p>Congratulations — you have unlocked a new tier at {{brand_name}} with even better rewards.</p>",
        },
      },
    ],
  },
  {
    template_key: "abandoned_cart",
    name: "Recover abandoned carts",
    description: "Reminds a customer who left items in their cart.",
    trigger_type: "cart_abandoned",
    trigger_conditions: {},
    defaults: { reenroll_cooldown_days: 7 },
    steps: [
      {
        wait_minutes: 60,
        action_type: "send_email",
        description: "Cart reminder email, 1 hour later",
        action_config: {
          subject: "You left something behind",
          html: "<p>Hi {{first_name}}, your cart is waiting for you at {{brand_name}}.</p>",
        },
      },
    ],
  },
  {
    template_key: "reorder_reminder",
    name: "Reorder reminder",
    description: "Reminds a customer it may be time to reorder.",
    trigger_type: "reorder_reminder",
    trigger_conditions: {},
    defaults: { reenroll_cooldown_days: 30 },
    steps: [
      {
        wait_minutes: 0,
        action_type: "send_email",
        description: "Reorder reminder email, immediately",
        action_config: {
          subject: "Time for a top-up, {{first_name}}?",
          html: "<p>It might be time to reorder your favourites from {{brand_name}}.</p>",
        },
      },
    ],
  },
];

const byKey = new Map(TEMPLATES.map((tpl) => [tpl.template_key, tpl]));

function list() {
  return TEMPLATES.map(({ template_key, name, description, trigger_type, steps }) => ({
    template_key,
    name,
    description,
    trigger_type,
    step_count: steps.length,
  }));
}

function get(templateKey) {
  return byKey.get(templateKey) || null;
}

module.exports = { TEMPLATES, list, get };
