#!/usr/bin/env node
/**
 * Generate the premium email-template migration from the ONE skin defined in
 * src/services/email-theme.js, so every seeded template (welcome, order
 * confirmation, shipped, birthday, abandoned cart) plus the Sale Announcement
 * share an identical luxury, deliverability-hardened look — with all brand
 * identity left as {{tokens}} the send pipeline fills from Settings.
 *
 *   node scripts/gen-premium-email-templates.js
 *     → writes migrations/000231_shared_premium_email_templates.sql
 *
 * The migration creates shared.fn_install_premium_email_templates(schema) and
 * calls it for every existing brand schema; the per-brand bootstrap template
 * (migrations/template/000045_*) calls the same function so NEW brands inherit
 * the exact same premium set. Re-run this generator whenever the skin changes.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const T = require("../src/services/email-theme");

const rows = (...parts) => parts.filter(Boolean).join("\n");

// ── The six templates (content only; wrapEmail adds header/footer/shell) ──
const TEMPLATES = [
  {
    key: "welcome",
    display_name: "Welcome",
    category: "onboarding",
    variables: ["customer_name", "first_name"],
    subject: "Welcome to {{brand_name}}, {{first_name}} ✨",
    preheader: "You're now part of the {{brand_name}} community — here's what to expect.",
    content: rows(
      T.eyebrow("Welcome to the house"),
      T.heading("A warm welcome, {{first_name}}"),
      T.paragraph(
        "We're so glad you're here. {{brand_name}} is built on a simple belief — that the pieces you choose should feel considered, cared for, and made to last. Consider this your front-row seat.",
      ),
      T.spacer(8),
      T.perk("✦", "<b>Curated quality</b> — every piece chosen with intention, never filler."),
      T.perk("✦", "<b>Concierge care</b> — real people, ready when you need us."),
      T.perk("✦", "<b>Member-first offers</b> — you'll hear about the good things first."),
      T.button("Explore the collection", "{{website_url}}"),
      T.spacer(12),
    ),
    text: rows(
      "Welcome to {{brand_name}}, {{first_name}}.",
      "",
      "We're so glad you're here. {{brand_name}} is built on a simple belief — that the pieces you choose should feel considered, cared for, and made to last.",
      "",
      "Explore the collection: {{website_url}}",
      "",
      "Questions? Just reply, or email {{support_email}}.",
      "— {{brand_name}}",
    ),
  },
  {
    key: "order_confirmation",
    display_name: "Order Confirmation",
    category: "transactional",
    variables: ["customer_name", "first_name", "order_number", "order_total", "tracking_url"],
    subject: "Your {{brand_name}} order {{order_number}} is confirmed",
    preheader: "Thank you, {{first_name}} — we've received your order and we're on it.",
    content: rows(
      T.eyebrow("Order confirmed"),
      T.heading("Thank you, {{first_name}}"),
      T.paragraph(
        "Your order is confirmed and being prepared with care. We'll let you know the moment it's on its way.",
      ),
      T.priceCompare("Order {{order_number}}", "{{order_total}}", "Order total"),
      T.button("Track your order", "{{tracking_url}}"),
      T.spacer(12),
    ),
    text: rows(
      "Thank you, {{first_name}} — your {{brand_name}} order {{order_number}} is confirmed.",
      "",
      "Order total: {{order_total}}",
      "Track your order: {{tracking_url}}",
      "",
      "Need anything? Email {{support_email}}.",
      "— {{brand_name}}",
    ),
  },
  {
    key: "shipped",
    display_name: "Order Shipped",
    category: "transactional",
    variables: ["customer_name", "first_name", "order_number", "tracking_url", "courier_name"],
    subject: "Your {{brand_name}} order {{order_number}} is on its way",
    preheader: "Good news, {{first_name}} — your order has shipped.",
    content: rows(
      T.eyebrow("On its way"),
      T.heading("It's shipping, {{first_name}}"),
      T.paragraph(
        "Your order {{order_number}} has left us and is on its way to you via {{courier_name}}. You can follow its journey any time.",
      ),
      T.button("Track shipment", "{{tracking_url}}"),
      T.spacer(12),
    ),
    text: rows(
      "Good news, {{first_name}} — your {{brand_name}} order {{order_number}} is on its way via {{courier_name}}.",
      "",
      "Track shipment: {{tracking_url}}",
      "",
      "— {{brand_name}}",
    ),
  },
  {
    key: "birthday",
    display_name: "Birthday Gift",
    category: "retention",
    variables: ["customer_name", "first_name", "coupon_code", "discount"],
    subject: "Happy birthday, {{first_name}} — a little gift inside 🎁",
    preheader: "A {{discount}}% birthday treat, just for you.",
    content: rows(
      T.eyebrow("A gift for you"),
      T.heading("Happy birthday, {{first_name}}"),
      T.paragraph(
        "Every celebration deserves something beautiful. Here's <b>{{discount}}% off</b> anything you've had your eye on — our way of marking your day.",
      ),
      T.deadlineBanner("Use code {{coupon_code}}", "{{discount}}% off — for a limited time"),
      T.button("Treat yourself", "{{website_url}}"),
      T.spacer(12),
    ),
    text: rows(
      "Happy birthday, {{first_name}}!",
      "",
      "Here's {{discount}}% off anything you've had your eye on — use code {{coupon_code}}.",
      "",
      "Treat yourself: {{website_url}}",
      "— {{brand_name}}",
    ),
  },
  {
    key: "abandoned_cart",
    display_name: "Abandoned Cart",
    category: "retention",
    variables: ["customer_name", "first_name", "cart_url", "items_count"],
    subject: "Still thinking it over, {{first_name}}?",
    preheader: "Your selection is saved — pick up right where you left off.",
    content: rows(
      T.eyebrow("You left something"),
      T.heading("Your selection is waiting"),
      T.paragraph(
        "Good taste, {{first_name}}. The pieces in your bag are still here — but they're popular, and we can't hold them forever.",
      ),
      T.button("Return to your bag", "{{cart_url}}"),
      T.spacer(12),
    ),
    text: rows(
      "Still thinking it over, {{first_name}}?",
      "",
      "The pieces in your bag are still saved — return any time: {{cart_url}}",
      "",
      "— {{brand_name}}",
    ),
  },
  {
    key: "sale_announcement",
    display_name: "Sale Announcement",
    category: "marketing",
    variables: [
      "customer_name",
      "first_name",
      "discount",
      "sale_url",
      "sale_end_display",
      "deadline_phrase",
      "days_left",
    ],
    subject: "Up to {{discount}}% off — the {{brand_name}} sale is here",
    preheader: "{{deadline_phrase}} · our biggest savings of the season end {{sale_end_display}}.",
    content: rows(
      T.eyebrow("Private sale · members first"),
      T.heading("Up to {{discount}}% off, {{first_name}}"),
      T.paragraph(
        "The {{brand_name}} sale is officially open. For a limited time, take <b>up to {{discount}}% off</b> across the collection — the same craftsmanship, at a price that rarely comes around.",
      ),
      T.deadlineBanner(),
      T.spacer(6),
      T.perk("✦", "<b>Up to {{discount}}% off</b> — across the pieces you've been waiting for."),
      T.perk("✦", "<b>Members first</b> — you're seeing this before anyone else."),
      T.perk("✦", "<b>While they last</b> — best sellers move fast at these prices."),
      T.button("Shop the sale", "{{sale_url}}"),
      T.paragraph(
        "Don't wait — {{deadline_phrase}}. When it's gone, it's gone.",
        { muted: true, top: 18 },
      ),
      T.spacer(12),
    ),
    text: rows(
      "{{first_name}}, the {{brand_name}} sale is here — up to {{discount}}% off.",
      "",
      "{{deadline_phrase}} · sale ends {{sale_end_display}}.",
      "",
      "Shop now: {{sale_url}}",
      "",
      "Members first. While they last.",
      "— {{brand_name}}",
    ),
  },
];

// ── SQL emission (dollar-quoted so HTML's quotes/%/braces need no escaping) ──
const DQ = "$pgh$"; // dollar-quote tag; none of our HTML contains it
const lit = (s) => `${DQ}${s}${DQ}`;
const arr = (a) => `ARRAY[${a.map((x) => `'${x}'`).join(",")}]::text[]`;

function templateBlock(tpl) {
  const html = T.wrapEmail({ preheader: tpl.preheader, content: tpl.content });
  return `  -- ${tpl.key}
  v_subject := ${lit(tpl.subject)};
  v_pre     := ${lit(tpl.preheader)};
  v_html    := ${lit(html)};
  v_text    := ${lit(tpl.text)};
  EXECUTE format(
    'INSERT INTO %I.email_templates '
    || '(template_key, display_name, subject_line, preheader_text, html_body, '
    || ' plain_text_body, available_variables, category, status, is_system_template) '
    || 'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true) '
    || 'ON CONFLICT (template_key) DO UPDATE SET '
    || '  display_name=EXCLUDED.display_name, subject_line=EXCLUDED.subject_line, '
    || '  preheader_text=EXCLUDED.preheader_text, html_body=EXCLUDED.html_body, '
    || '  plain_text_body=EXCLUDED.plain_text_body, '
    || '  available_variables=EXCLUDED.available_variables, '
    || '  category=EXCLUDED.category, updated_at=now()',
    p_schema
  ) USING '${tpl.key}', ${lit(tpl.display_name)}, v_subject, v_pre, v_html,
          v_text, ${arr(tpl.variables)}, '${tpl.category}', 'approved';`;
}

const sql = `-- ============================================================
-- MIGRATION 000231 — Premium, brand-aware email templates
-- Pixie Girl Hub · JBS Praxis · V2.2
--
-- GENERATED by scripts/gen-premium-email-templates.js from the single skin in
-- src/services/email-theme.js. Do not hand-edit — re-run the generator.
--
-- Replaces the bare seeded templates (\`<h1>Welcome!</h1>\`) with one luxury,
-- table-based, inline-CSS, Outlook/Gmail/Apple-safe skin. All brand identity
-- (logo, accent colour, name, links, address) is left as {{tokens}} that the
-- send pipeline (email-render.js) fills per brand from Settings, so the same
-- template reskins itself for Pixie Girl Global vs Faitlynhair.
--
-- Adds email_campaigns.merge_data (campaign-level tokens: sale discount, link,
-- end date → the static countdown) and seeds a new \`sale_announcement\` template.
--
-- Idempotent: the installer upserts on template_key; safe to re-run.
-- ============================================================

CREATE OR REPLACE FUNCTION shared.fn_install_premium_email_templates(p_schema text)
RETURNS void
LANGUAGE plpgsql
AS $func$
DECLARE
  v_subject text;
  v_pre     text;
  v_html    text;
  v_text    text;
BEGIN
${TEMPLATES.map(templateBlock).join("\n\n")}
END;
$func$;

-- Apply to every existing brand schema; add the campaign-level merge_data
-- column the sale countdown/CTA rides on.
DO $do$
DECLARE
  sch text;
BEGIN
  FOR sch IN
    SELECT n.nspname
      FROM pg_namespace n
      JOIN information_schema.tables t
        ON t.table_schema = n.nspname AND t.table_name = 'email_templates'
     WHERE n.nspname NOT IN ('template')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.email_campaigns '
      || 'ADD COLUMN IF NOT EXISTS merge_data jsonb NOT NULL DEFAULT ''{}''::jsonb',
      sch
    );
    PERFORM shared.fn_install_premium_email_templates(sch);
    RAISE NOTICE 'premium email templates installed on %', sch;
  END LOOP;
END
$do$;

-- ============================================================
-- Verify
--   SELECT template_key, length(html_body) FROM pixiegirl.email_templates
--    WHERE is_system_template ORDER BY template_key;
-- ============================================================
`;

const out = path.join(
  __dirname,
  "..",
  "migrations",
  "000231_shared_premium_email_templates.sql",
);
fs.writeFileSync(out, sql, "utf-8");
process.stdout.write(
  `Wrote ${path.relative(path.join(__dirname, ".."), out)} (${TEMPLATES.length} templates, ${sql.length} bytes)\n`,
);
