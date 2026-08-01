/**
 * Comms Studio — business logic.
 *
 * Wraps the repo with audit + validation + preview + send-test. All state
 * changes flow through here so the audit log carries "who edited which
 * automation, when, and what the block editor looked like before/after".
 */

"use strict";

const repo = require("./comms-studio.repo");
const renderer = require("./renderer");
const dispatcher = require("./dispatcher");
const emailRender = require("../email_campaigns/email-render");
const whatsapp = require("../../services/whatsapp.service");
const email = require("../../services/email.service");
const { audit } = require("../../middleware/audit");
const { AppError } = require("../../utils/errors");

async function listAutomations({ brand }) {
  const rows = await repo.listAutomations({ brand });
  // Attach the referenced-but-not-declared token check up front so the
  // Studio's badge on each card can show "3 unresolved tokens" without a
  // second round trip.
  return rows.map((r) => ({
    ...r,
    diagnostics: diagnoseAutomation(r),
  }));
}

async function getAutomation({ brand, event_key }) {
  const row = await repo.getAutomation({ brand, event_key });
  if (!row) return null;
  return { ...row, diagnostics: diagnoseAutomation(row) };
}

/**
 * On/off state for a set of automations, keyed by event_key — a lean read for
 * callers that only need "is this switched on, and on which channel?". An
 * event_key with no configured policy row is reported `configured:false`
 * (nothing will send) rather than omitted, so the caller can render a definite
 * state for every message it asked about. Mirrors the dispatcher's gate: a row
 * with `is_active === false` is Off.
 */
async function getAutomationStates({ brand, event_keys = [] }) {
  const rows = await repo.getAutomationStates({ brand, event_keys });
  const byKey = new Map(rows.map((r) => [r.event_key, r]));
  return event_keys.map((event_key) => {
    const row = byKey.get(event_key);
    return {
      event_key,
      configured: !!row,
      // Absent row → off; an explicit is_active:false → off; anything else on.
      is_active: !!row && row.is_active !== false,
      channel: row ? row.channel_preference || null : null,
    };
  });
}

async function updateAutomation({ brand, user, request_id, input }) {
  const before = await repo.getAutomation({ brand, event_key: input.event_key });
  if (!before) {
    throw new AppError("NOT_FOUND", "Automation not found", 404);
  }
  const after = await repo.updateAutomation({
    brand,
    user_id: user.user_id,
    input,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "comms_studio.automation.update",
    target_type: "outbound_channel_policy",
    target_id: after.policy_id,
    before: pickAuditable(before),
    after: pickAuditable(after),
    request_id,
  });
  return { ...after, diagnostics: diagnoseAutomation(after) };
}

/**
 * Server-render the preview so what the operator sees in the iframe is
 * exactly what will ship. Accepts unsaved draft overrides so the preview
 * updates as they type.
 */
async function previewAutomation({ brand, input }) {
  const stored = await repo.getAutomation({ brand, event_key: input.event_key });
  if (!stored) throw new AppError("NOT_FOUND", "Automation not found", 404);

  const draft = {
    ...stored,
    subject_template: input.subject_template ?? stored.subject_template,
    preheader_template: input.preheader_template ?? stored.preheader_template,
    email_blocks_json: input.email_blocks_json ?? stored.email_blocks_json,
    whatsapp_body_template:
      input.whatsapp_body_template ?? stored.whatsapp_body_template,
    instagram_body_template:
      input.instagram_body_template ?? stored.instagram_body_template,
  };

  // Seed the variables map from the automation's declared examples so the
  // preview has something concrete to render even before the operator
  // types anything.
  const seeded = variablesFromExamples(stored.variables_schema);
  const merged = { ...seeded, ...(input.variables || {}) };

  const brandTokens = await emailRender.resolveBrandTokens(brand);

  if (input.channel === "email") {
    const { subject, html, text, preheader } = renderer.buildEmail({
      automation: draft,
      brandTokens,
      variables: merged,
    });
    return { channel: "email", subject, preheader, html, text };
  }
  if (input.channel === "whatsapp") {
    return {
      channel: "whatsapp",
      body: renderer.buildWhatsApp({
        automation: draft,
        variables: { ...brandTokens, ...merged },
      }),
    };
  }
  if (input.channel === "instagram") {
    return {
      channel: "instagram",
      body: renderer.buildInstagram({
        automation: draft,
        variables: { ...brandTokens, ...merged },
      }),
    };
  }
  throw new AppError("BAD_CHANNEL", `Unsupported channel: ${input.channel}`, 400);
}

/**
 * Send a one-off test message to a destination the operator supplies. This
 * bypasses contact resolution and the automation_send_log — it exists so
 * the CEO can end-to-end-verify what a customer will see, from her own
 * WhatsApp / inbox.
 */
async function sendTest({ brand, user, request_id, input }) {
  const stored = await repo.getAutomation({ brand, event_key: input.event_key });
  if (!stored) throw new AppError("NOT_FOUND", "Automation not found", 404);

  const seeded = variablesFromExamples(stored.variables_schema);
  const merged = { ...seeded, ...(input.variables || {}) };
  const brandTokens = await emailRender.resolveBrandTokens(brand);

  if (input.channel === "email") {
    const built = renderer.buildEmail({
      automation: stored,
      brandTokens,
      variables: merged,
    });
    await email.send({
      brand,
      to: input.to,
      subject: `[TEST] ${built.subject}`,
      html: built.html,
      text: built.text,
    });
  } else if (input.channel === "whatsapp") {
    const body =
      "[TEST] " +
      renderer.buildWhatsApp({
        automation: stored,
        variables: { ...brandTokens, ...merged },
      });
    await whatsapp.sendText({ brand, to: input.to, body });
  } else {
    throw new AppError("BAD_CHANNEL", `Unsupported channel: ${input.channel}`, 400);
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "comms_studio.automation.send_test",
    target_type: "outbound_channel_policy",
    target_id: stored.policy_id,
    after: { channel: input.channel, to: input.to, event_key: input.event_key },
    request_id,
  });
  return { sent: true };
}

async function listSendLog({ brand, event_key, limit }) {
  return repo.listSendLog({ brand, event_key, limit });
}

// ── Diagnostics ────────────────────────────────────────────

/**
 * Inspect an automation and return "problems the Studio can nudge about" —
 * template tokens the operator references but hasn't declared, empty block
 * arrays on an active email row, missing WhatsApp body when the channel is
 * WhatsApp, etc. Non-fatal — just surfacing.
 */
function diagnoseAutomation(row) {
  const declared = new Set(
    (row.variables_schema || []).map((v) => v && v.name).filter(Boolean),
  );
  const referenced = new Set();
  const collect = (s) =>
    renderer.extractTokens(s).forEach((t) => referenced.add(t));
  collect(row.subject_template);
  collect(row.preheader_template);
  collect(row.whatsapp_body_template);
  collect(row.instagram_body_template);
  for (const b of row.email_blocks_json || []) {
    if (!b) continue;
    for (const v of Object.values(b)) {
      if (typeof v === "string") collect(v);
    }
  }
  // Brand tokens are always injected — never a "missing declaration".
  const brandProvided = new Set([
    "brand_name",
    "brand_legal_name",
    "logo_url",
    "brand_color",
    "brand_color_deep",
    "brand_secondary",
    "website_url",
    "support_email",
    "brand_address",
    "brand_phone",
    "year",
  ]);
  const undeclared = [...referenced].filter(
    (t) => !declared.has(t) && !brandProvided.has(t),
  );
  const warnings = [];
  if (row.is_active && (!row.email_blocks_json || row.email_blocks_json.length === 0)) {
    warnings.push("Active automation has an empty email body.");
  }
  if (
    row.is_active &&
    row.channel_preference === "whatsapp" &&
    !row.whatsapp_body_template
  ) {
    warnings.push("Channel is WhatsApp but no WhatsApp body is configured.");
  }
  return {
    undeclared_tokens: undeclared,
    warnings,
  };
}

function pickAuditable(row) {
  return {
    event_key: row.event_key,
    channel_preference: row.channel_preference,
    fallback_channel: row.fallback_channel,
    block_whatsapp: row.block_whatsapp,
    is_active: row.is_active,
    subject_template: row.subject_template,
    email_blocks_json: row.email_blocks_json,
    whatsapp_body_template: row.whatsapp_body_template,
    cadence_config: row.cadence_config,
  };
}

function variablesFromExamples(schema) {
  const out = {};
  for (const v of schema || []) {
    if (v && v.name && v.example !== undefined) out[v.name] = v.example;
  }
  return out;
}

module.exports = {
  listAutomations,
  getAutomationStates,
  getAutomation,
  updateAutomation,
  previewAutomation,
  sendTest,
  listSendLog,
  // Also re-export for direct backend callers so a service can just do
  // `const commsStudio = require('.../comms_studio/comms-studio.service')`
  // and call dispatch() without a second import.
  dispatch: dispatcher.dispatch,
};
