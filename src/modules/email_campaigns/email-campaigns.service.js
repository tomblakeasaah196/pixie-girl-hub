/**
 * Email Campaigns (V2.2 §6.16) — business logic.
 *
 * System-connected: recipients are built from shared.contacts; sends go
 * through the real email provider (services/email.service); opens/clicks/
 * bounces flow back as events that update recipient + campaign counters;
 * newsletter signups become CRM contacts (source='website'). No isolated list.
 */

"use strict";

const repo = require("./email-campaigns.repo");
const events = require("./email-campaigns.events");
const email = require("../../services/email.service");
const render = require("./email-render");
const { audit } = require("../../middleware/audit");
const { transaction, query } = require("../../config/database");
const { logger } = require("../../config/logger");
const { NotFoundError, AppError } = require("../../utils/errors");

const SEND_CAP = 1000; // synchronous send cap per call

// ── Templates ──────────────────────────────────────────────
function listTemplates({ brand }) {
  return repo.listTemplates({ brand });
}
async function createTemplate({ brand, user, request_id, input }) {
  const tpl = await repo.createTemplate({ brand, tpl: input });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.template.create",
    target_type: "email_template",
    target_id: tpl.template_id,
    request_id,
  });
  return tpl;
}
async function updateTemplate({ brand, user, request_id, id, patch }) {
  const tpl = await repo.updateTemplate({ brand, id, patch });
  if (!tpl) throw new NotFoundError("Template");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.template.update",
    target_type: "email_template",
    target_id: id,
    request_id,
  });
  return tpl;
}

// ── Campaigns ──────────────────────────────────────────────
function listCampaigns(args) {
  return repo.listCampaigns(args);
}
async function getCampaign({ brand, id }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  return c;
}
async function createCampaign({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const campaign_number = await repo.nextNumber({ client, brand });
    const c = await repo.createCampaign({
      client,
      brand,
      c: { ...input, campaign_number },
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "email_campaigns.create",
      target_type: "email_campaign",
      target_id: c.campaign_id,
      after: { campaign_number },
      request_id,
    });
    events.emit("created", { brand, id: c.campaign_id });
    return c;
  });
}

/** Edit a draft/scheduled campaign — incl. merge_data (sale discount, link,
 *  end date) that the render pipeline turns into the countdown + CTA. */
async function updateCampaign({ brand, user, request_id, id, patch }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  if (!["draft", "scheduled"].includes(c.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot edit a '${c.status}' campaign`,
      409,
    );
  const updated = await repo.updateCampaign({ brand, id, patch });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.update",
    target_type: "email_campaign",
    target_id: id,
    request_id,
  });
  events.emit("updated", { brand, id });
  return updated;
}

/** Populate recipients from contacts (optionally a specific id list). */
async function buildRecipients({ brand, user, request_id, id, contact_ids }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  if (!["draft", "scheduled"].includes(c.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot edit a '${c.status}' campaign`,
      409,
    );
  const added = await repo.addRecipientsFromContacts({
    brand,
    campaign_id: id,
    filter: { contact_ids },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.recipients.build",
    target_type: "email_campaign",
    target_id: id,
    after: { added },
    request_id,
  });
  return { added };
}

/** Send the campaign now: render the template per recipient + dispatch. */
async function sendCampaign({ brand, user, request_id, id }) {
  const campaign = await repo.getCampaign({ brand, id });
  if (!campaign) throw new NotFoundError("Campaign");
  if (!["draft", "scheduled", "sending"].includes(campaign.status))
    throw new AppError(
      "INVALID_STATE",
      `Cannot send a '${campaign.status}' campaign`,
      409,
    );
  if (!campaign.default_template_id)
    throw new AppError("NO_TEMPLATE", "Campaign has no default template", 422);
  const template = await repo.getTemplate({
    brand,
    id: campaign.default_template_id,
  });
  if (!template) throw new NotFoundError("Template");

  await repo.setCampaignStatus({ brand, id, status: "sending" });
  const recipients = await repo.queuedRecipients({
    brand,
    campaign_id: id,
    limit: SEND_CAP,
  });

  // Resolve the per-brand identity (logo, accent, name, links from Settings)
  // and the campaign-level merge data (sale discount/link/deadline) once, then
  // personalise + send per recipient.
  const brandTokens = await render.resolveBrandTokens(brand);
  const campaignTokens = render.resolveCampaignTokens(campaign);

  let sent = 0;
  for (const r of recipients) {
    try {
      const { subject, html, text, headers } = render.buildEmail({
        template,
        brandTokens,
        campaignTokens,
        recipient: r,
        brand,
      });
      await email.send({
        to: r.email,
        subject,
        html,
        text,
        headers,
        from_name: campaign.from_name || template.from_name,
        from_email: campaign.from_email || template.from_email,
        // EMAIL_TWO_WAY_SETUP: pass the brand so the sender resolves the right
        // FROM identity, and a conversational Reply-To (sales@<brand>) so a
        // customer's reply threads back into the conversation.
        reply_to: campaign.reply_to_email || template.reply_to_email,
        brand,
      });
      await repo.setRecipientStatus({
        brand,
        recipient_id: r.recipient_id,
        status: "sent",
        fields: { sent_at: new Date().toISOString() },
      });
      await repo.insertEvent({
        brand,
        ev: {
          recipient_id: r.recipient_id,
          campaign_id: id,
          event_type: "sent",
        },
      });
      await repo.incCampaignCounter({ brand, id, column: "total_sent" });
      sent += 1;
    } catch (err) {
      await repo.setRecipientStatus({
        brand,
        recipient_id: r.recipient_id,
        status: "failed",
      });
      logger.error(
        { err: err.message, brand, recipient_id: r.recipient_id },
        "email campaign send failed for recipient",
      );
    }
  }

  const remaining = await repo.queuedRecipients({
    brand,
    campaign_id: id,
    limit: 1,
  });
  const status = remaining.length > 0 ? "sending" : "sent";
  const updated = await repo.setCampaignStatus({
    brand,
    id,
    status,
    // email_campaigns tracks send_completed_at (not sent_at — that's on the
    // recipient). Only stamp it once the whole batch is done.
    fields: status === "sent" ? { send_completed_at: new Date().toISOString() } : {},
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.send",
    target_type: "email_campaign",
    target_id: id,
    after: { sent },
    request_id,
  });
  events.emit("sent", { brand, id, sent });
  return { ...updated, sent_this_batch: sent };
}

async function setStatus({ brand, user, request_id, id, status }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const updated = await repo.setCampaignStatus({ brand, id, status });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: `email_campaigns.${status}`,
    target_type: "email_campaign",
    target_id: id,
    request_id,
  });
  return updated;
}

/** Provider webhook: record an engagement event + roll up counters. */
async function recordEvent({ brand, campaign_id, email: addr, event_type }) {
  const r = await repo.findRecipientByEmail({
    brand,
    campaign_id,
    email: addr,
  });
  if (!r) return null;
  await repo.insertEvent({
    brand,
    ev: { recipient_id: r.recipient_id, campaign_id, event_type },
  });
  const map = {
    delivered: { status: "delivered", col: "total_delivered" },
    opened: {
      col: "total_opened",
      field: { first_opened_at: new Date().toISOString() },
    },
    clicked: {
      col: "total_clicked",
      field: { first_clicked_at: new Date().toISOString() },
    },
    bounced: {
      status: "bounced",
      col: "total_bounced",
      field: { bounced_at: new Date().toISOString() },
    },
    unsubscribed: {
      status: "unsubscribed",
      col: "total_unsubscribed",
      field: { unsubscribed_at: new Date().toISOString() },
    },
  };
  const m = map[event_type];
  if (m) {
    await repo.setRecipientStatus({
      brand,
      recipient_id: r.recipient_id,
      status: m.status || r.status,
      fields: m.field || {},
    });
    if (m.col)
      await repo.incCampaignCounter({ brand, id: campaign_id, column: m.col });
  }
  return { recorded: event_type };
}

// ── Newsletter (public) — connects into CRM contacts ───────
async function subscribeNewsletter({ brand, input }) {
  if (!input.email || !input.phone)
    throw new AppError(
      "EMAIL_PHONE_REQUIRED",
      "Email and phone are required to subscribe",
      422,
    );
  // Merge by email or phone; else create a contact tagged source='website'.
  const { rows: existing } = await query(
    `SELECT contact_id FROM shared.contacts
      WHERE is_deleted = false AND (email = $1 OR primary_phone = $2) LIMIT 1`,
    [input.email, input.phone],
  );
  if (existing[0])
    return { contact_id: existing[0].contact_id, created: false };
  const display_name =
    [input.first_name, input.last_name].filter(Boolean).join(" ") ||
    input.email;
  const { rows } = await query(
    `INSERT INTO shared.contacts
       (contact_type, display_name, first_name, last_name, primary_phone, email,
        source, visible_to)
     VALUES (ARRAY['lead'], $1, $2, $3, $4, $5, 'website', ARRAY[$6])
     RETURNING contact_id`,
    [
      display_name,
      input.first_name || null,
      input.last_name || null,
      input.phone,
      input.email,
      brand,
    ],
  );
  events.emit("newsletter.subscribed", {
    brand,
    contact_id: rows[0].contact_id,
  });
  return { contact_id: rows[0].contact_id, created: true };
}

// ── A/B variants ───────────────────────────────────────────
async function createVariant({ brand, user, request_id, id, input }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const variant = await repo.createVariant({
    brand,
    v: { ...input, campaign_id: id },
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.variant.create",
    target_type: "email_campaign",
    target_id: id,
    request_id,
  });
  return variant;
}
/** A/B results: per-variant open/click rates + the leading variant. */
async function getAbTestResults({ brand, id }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const variants = await repo.listVariants({ brand, campaign_id: id });
  const metric = c.ab_winner_metric || "open_rate";
  const scored = variants.map((v) => {
    const sent = v.total_sent || 0;
    const open_rate = sent ? (v.total_opened / sent) * 100 : 0;
    const click_rate = sent ? (v.total_clicked / sent) * 100 : 0;
    const conv_rate = sent ? (v.conversion_count / sent) * 100 : 0;
    const score =
      metric === "click_rate"
        ? click_rate
        : metric === "conversion_rate"
          ? conv_rate
          : open_rate;
    return {
      ...v,
      open_rate_pct: Number(open_rate.toFixed(2)),
      click_rate_pct: Number(click_rate.toFixed(2)),
      conversion_rate_pct: Number(conv_rate.toFixed(2)),
      _score: score,
    };
  });
  const leader = scored.reduce(
    (best, v) => (!best || v._score > best._score ? v : best),
    null,
  );
  return {
    metric,
    variants: scored.map(({ _score, ...v }) => v),
    leading_variant_id: leader ? leader.variant_id : null,
  };
}
async function declareWinner({ brand, user, request_id, id, variant_id }) {
  return transaction(async (client) => {
    const c = await repo.getCampaign({ client, brand, id });
    if (!c) throw new NotFoundError("Campaign");
    await repo.setVariantWinner({ client, brand, campaign_id: id, variant_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "email_campaigns.variant.winner",
      target_type: "email_campaign",
      target_id: id,
      after: { variant_id },
      request_id,
    });
    return { campaign_id: id, ab_winner_variant_id: variant_id };
  });
}

// ── Scheduling ─────────────────────────────────────────────
async function schedule({ brand, user, request_id, id, scheduled_for }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  if (c.status !== "draft" && c.status !== "scheduled")
    throw new AppError("BAD_STATE", `Campaign is ${c.status}`, 422);
  const updated = await repo.setSchedule({ brand, id, scheduled_for });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.schedule",
    target_type: "email_campaign",
    target_id: id,
    after: { scheduled_for },
    request_id,
  });
  return updated;
}
/** Cron hook: send any scheduled campaigns whose time has arrived. */
async function runDueScheduled({ brand, user }) {
  const due = await repo.dueScheduledCampaigns({
    brand,
    now: new Date().toISOString(),
  });
  const results = [];
  for (const d of due) {
    try {
      const r = await sendCampaign({
        brand,
        user,
        request_id: null,
        id: d.campaign_id,
      });
      results.push({ campaign_id: d.campaign_id, sent: r.sent_this_batch });
    } catch (err) {
      logger.error(
        { err: err.message, campaign_id: d.campaign_id },
        "email_campaigns: scheduled send failed",
      );
    }
  }
  return { ran: results.length, results };
}

// ── Stats ──────────────────────────────────────────────────
async function getStats({ brand, id }) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const breakdown = await repo.eventBreakdown({ brand, campaign_id: id });
  const sent = c.total_sent || 0;
  const pct = (n) => (sent ? Number(((n / sent) * 100).toFixed(2)) : 0);
  return {
    campaign_id: id,
    status: c.status,
    totals: {
      sent: c.total_sent,
      delivered: c.total_delivered,
      opened: c.total_opened,
      clicked: c.total_clicked,
      bounced: c.total_bounced,
      unsubscribed: c.total_unsubscribed,
    },
    rates: {
      open_rate_pct: pct(c.total_opened),
      click_rate_pct: pct(c.total_clicked),
      bounce_rate_pct: pct(c.total_bounced),
    },
    conversions: {
      count: c.conversion_count,
      revenue_ngn: c.conversion_revenue_ngn,
    },
    event_breakdown: breakdown,
  };
}

// ── Saved segments (shared.contact_segments) ───────────────
function listSegments({ brand }) {
  return repo.listSegments({ brand });
}
async function getSegment({ brand, id }) {
  const s = await repo.getSegment({ brand, id });
  if (!s) throw new NotFoundError("Segment");
  return s;
}
async function saveSegment({ brand, user, request_id, input }) {
  const s = await repo.createSegment({
    brand,
    s: input,
    user_id: user.user_id,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.segment.save",
    target_type: "contact_segment",
    target_id: s.segment_id,
    request_id,
  });
  return s;
}
async function deleteSegment({ brand, user, request_id, id }) {
  const ok = await repo.deleteSegment({ brand, id });
  if (!ok) throw new NotFoundError("Segment");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.segment.delete",
    target_type: "contact_segment",
    target_id: id,
    request_id,
  });
}
/** Preview the audience a segment resolves to (emailable contacts). */
async function previewSegment({ brand, id }) {
  const seg = await repo.getSegment({ brand, id });
  if (!seg) throw new NotFoundError("Segment");
  const filter = seg.filter || {};
  const contacts = await repo.emailableContacts({ brand, filter });
  await repo.updateSegmentCount({ brand, id, count: contacts.length });
  return {
    segment_id: id,
    count: contacts.length,
    sample: contacts.slice(0, 20),
  };
}
/** Build a campaign's recipient list from a saved segment. */
async function buildAudienceFromSegment({
  brand,
  user,
  request_id,
  id,
  segment_id,
}) {
  const c = await repo.getCampaign({ brand, id });
  if (!c) throw new NotFoundError("Campaign");
  const seg = await repo.getSegment({ brand, id: segment_id });
  if (!seg) throw new NotFoundError("Segment");
  const filter = seg.filter || {};
  const added = await repo.addRecipientsFromContacts({
    brand,
    campaign_id: id,
    filter,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "email_campaigns.audience.from_segment",
    target_type: "email_campaign",
    target_id: id,
    after: { segment_id, added },
    request_id,
  });
  return { campaign_id: id, segment_id, recipients_added: added };
}

// ── Public tracking (pixel open / click / unsubscribe) ─────
async function handlePixelOpen({ brand, recipient_id, ip, user_agent }) {
  return transaction(async (client) => {
    const r = await repo.findRecipient({ client, brand, recipient_id });
    if (!r) return { ok: true }; // never leak existence on a public pixel
    await repo.insertEvent({
      client,
      brand,
      ev: {
        recipient_id,
        campaign_id: r.campaign_id,
        event_type: "opened",
        ip_address: ip,
        user_agent,
      },
    });
    const bump = await repo.bumpRecipientEngagement({
      client,
      brand,
      recipient_id,
      kind: "open",
    });
    if (bump && bump.was_first)
      await repo.incCampaignCounter({
        client,
        brand,
        id: r.campaign_id,
        column: "total_opened",
      });
    return { ok: true };
  });
}
async function handleClick({ brand, recipient_id, url, ip, user_agent }) {
  return transaction(async (client) => {
    const r = await repo.findRecipient({ client, brand, recipient_id });
    if (!r) return { redirect: url };
    await repo.insertEvent({
      client,
      brand,
      ev: {
        recipient_id,
        campaign_id: r.campaign_id,
        event_type: "clicked",
        click_url: url,
        ip_address: ip,
        user_agent,
      },
    });
    const bump = await repo.bumpRecipientEngagement({
      client,
      brand,
      recipient_id,
      kind: "click",
    });
    if (bump && bump.was_first)
      await repo.incCampaignCounter({
        client,
        brand,
        id: r.campaign_id,
        column: "total_clicked",
      });
    return { redirect: url };
  });
}
async function handleUnsubscribe({ brand, recipient_id }) {
  return transaction(async (client) => {
    const r = await repo.findRecipient({ client, brand, recipient_id });
    if (!r) return { ok: true };
    if (r.status !== "unsubscribed") {
      await repo.insertEvent({
        client,
        brand,
        ev: {
          recipient_id,
          campaign_id: r.campaign_id,
          event_type: "unsubscribed",
        },
      });
      await repo.setRecipientStatus({
        client,
        brand,
        recipient_id,
        status: "unsubscribed",
        fields: { unsubscribed_at: new Date().toISOString() },
      });
      await repo.incCampaignCounter({
        client,
        brand,
        id: r.campaign_id,
        column: "total_unsubscribed",
      });
    }
    return { ok: true, unsubscribed: true };
  });
}

module.exports = {
  listTemplates,
  createTemplate,
  updateTemplate,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  buildRecipients,
  sendCampaign,
  setStatus,
  recordEvent,
  subscribeNewsletter,
  createVariant,
  getAbTestResults,
  declareWinner,
  schedule,
  runDueScheduled,
  getStats,
  listSegments,
  getSegment,
  saveSegment,
  deleteSegment,
  previewSegment,
  buildAudienceFromSegment,
  handlePixelOpen,
  handleClick,
  handleUnsubscribe,
};
