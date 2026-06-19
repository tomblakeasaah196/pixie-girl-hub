/**
 * Smartcomm ↔ Praxis bridge — "Draft with Praxis" action.
 *
 * Permission: requires both smartcomm.edit (sending the resulting
 * draft) AND praxis_ai.use (consuming AI credits). The CEO bypasses
 * both. Governance's canUseFeature is the runtime cost guard — it
 * returns reason='budget_exceeded' when the AI Control monthly hard
 * cap is hit, in which case we return 403 with a clean message so
 * the composer can hide the button until the next period.
 *
 * Behaviour:
 *   - Read the last N messages on the channel (default 15).
 *   - Read the brand_voice_config row (tone, signature, do/donts,
 *     FAQ, sample transcripts).
 *   - Read the contact (preferred channel, recent activity hints).
 *   - Call praxis.orchestrator.generateReply (or fall back to a
 *     deterministic stub if the orchestrator isn't enabled / no
 *     LLM vendor is configured — graceful no-op for dev environments).
 *   - Save the result into shared.message_drafts with
 *     generated_by='praxis', generated_at=now().
 *   - Return the draft so the composer can render it immediately.
 *   - Record usage on the AI ledger (input_tokens / output_tokens /
 *     cost_ngn). Usage rows feed the AI Control spend meter.
 *
 * The draft is NEVER auto-sent. The composer always shows it under a
 * "✨ Praxis-drafted" chip and the user clicks Send to commit.
 */

"use strict";

const repo = require("./smartcomm.repo");
const governance = require("../ai_governance/governance.service");
const brandVoiceRepo = require("../ai_governance/brand-voice.repo");
const praxisOrchestrator = require("../praxis_ai/praxis.orchestrator");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const { audit } = require("../../middleware/audit");
const { NotFoundError, AppError } = require("../../utils/errors");

const FEATURE = "praxis_chat";

function isCeo(user) {
  return !!(user && (user.is_ceo || user.role === "ceo"));
}

/**
 * Generate a single reply draft. The orchestrator handles model
 * selection + RAG retrieval; we feed it a curated prompt context so
 * the reply lines up with the brand voice.
 */
async function draftReply({ brand, user, request_id, channel_id }) {
  // ── 1. Governance gate ─────────────────────────────────
  const guard = await governance.canUseFeature({
    user_id: user.user_id,
    feature_key: FEATURE,
    is_ceo: isCeo(user),
  });
  if (!guard.ok) {
    throw new AppError(
      "AI_UNAVAILABLE",
      `Praxis is unavailable: ${guard.reason}`,
      403,
    );
  }

  // ── 2. Gather the context ──────────────────────────────
  const channel = await repo.getChannel({ id: channel_id });
  if (!channel) throw new NotFoundError("Channel");
  const [messages, voice, members] = await Promise.all([
    repo.listMessages({ channel_id, limit: 15 }),
    brandVoiceRepo.getByBrand({ brand }),
    repo.listMembers({ channel_id }),
  ]);
  const customer = members.find((m) => m.contact_id);
  const platform = channel.external_platform || "internal";

  // Convert message history into a compact role-tagged transcript the
  // model can ground on. We omit attachments since the LLM can't see
  // images yet and a "[image]" stub adds nothing.
  const transcript = messages
    .filter((m) => m.message_type !== "system" || m.content)
    .map((m) => {
      const speaker =
        m.sender_kind === "customer"
          ? "Customer"
          : m.sender_kind === "system"
            ? "System"
            : m.sender_name || "Staff";
      return `${speaker}: ${m.content || `[${m.message_type}]`}`;
    })
    .join("\n");

  const customerName =
    customer?.contact_display_name ||
    customer?.primary_phone ||
    customer?.email ||
    "the customer";

  // ── 3. Build the prompt ────────────────────────────────
  const promptContext = {
    brand,
    platform,
    voice_summary: voice?.voice_summary || null,
    tone: voice?.tone || null,
    signature_html: voice?.signature_html || null,
    do_donts: voice?.do_donts || { do: [], dont: [] },
    sample_transcripts: voice?.sample_transcripts || [],
    primary_emojis: voice?.primary_emojis || [],
    customer_name: customerName,
    transcript,
    preferred_channel: customer?.preferred_channel || null,
  };

  // ── 4. Call the orchestrator (or stub) ─────────────────
  let draftText = null;
  let usage = {
    provider: "stub",
    model: "stub",
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    cost_native: 0,
    cost_ngn: 0,
    was_successful: true,
  };
  if (config.PRAXIS_ORCHESTRATOR_ENABLED) {
    try {
      const result = await praxisOrchestrator.generateSmartcommDraft?.({
        user,
        brand,
        context: promptContext,
      });
      if (result) {
        draftText = result.text;
        if (result.usage) usage = { ...usage, ...result.usage };
      }
    } catch (err) {
      logger.error(
        { err: err.message, channel_id },
        "praxis-draft: orchestrator failed — falling back to stub",
      );
      usage.was_successful = false;
    }
  }
  if (!draftText) {
    draftText = composeStubDraft(promptContext);
  }

  // ── 5. Persist as draft + record usage ─────────────────
  const draft = await repo.upsertDraft({
    channel_id,
    user_id: user.user_id,
    content: draftText,
    attachments: [],
    reply_to_id: null,
    generated_by: "praxis",
  });
  try {
    await governance.recordUsage({
      usage: {
        user_id: user.user_id,
        feature_key: FEATURE,
        business: brand,
        ...usage,
        call_type: "smartcomm_draft",
      },
    });
  } catch (err) {
    logger.warn({ err: err.message }, "praxis-draft: usage recording failed");
  }
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "smartcomm.praxis.draft",
    target_type: "message_draft",
    target_id: channel_id,
    after: { generated_by: "praxis", chars: draftText.length },
    request_id,
  });
  return draft;
}

/**
 * Stub draft used when the live orchestrator isn't available. Hand-
 * crafted so the dev environment still produces something useful and
 * a CS rep doesn't blink at an empty reply.
 *
 * The stub explicitly tells the rep "no live AI" so it's never
 * mistaken for real production output.
 */
function composeStubDraft(ctx) {
  const greetingEmoji = ctx.primary_emojis?.[0] || "🌹";
  const signature = ctx.signature_html
    ? `\n\n— ${stripHtml(ctx.signature_html).slice(0, 200)}`
    : "";
  const lastCustomerLine = lastFromTranscript(ctx.transcript, "Customer");
  const body = lastCustomerLine
    ? `Thanks for reaching out, ${firstName(ctx.customer_name)} ${greetingEmoji}\n\n` +
      `I hear you on "${truncate(lastCustomerLine, 120)}". Let me confirm a couple of details and come back to you with the next step.`
    : `Hi ${firstName(ctx.customer_name)} ${greetingEmoji} — thanks for getting in touch! How can we help today?`;
  return (
    body +
    `\n\n(Praxis draft — live AI is not configured in this environment; this is a placeholder.)` +
    signature
  );
}

function firstName(displayName) {
  if (!displayName) return "there";
  const p = displayName.trim().split(/\s+/);
  return p[0] || displayName;
}
function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function lastFromTranscript(transcript, speaker) {
  const lines = (transcript || "").split("\n").reverse();
  for (const l of lines) {
    if (l.startsWith(`${speaker}:`)) return l.slice(speaker.length + 1).trim();
  }
  return null;
}
function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, "")
    .trim();
}

module.exports = { draftReply };
