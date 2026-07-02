/**
 * Email Campaigns (V2.2 §6.16) — repository.
 *
 * Per-brand: email_templates, email_campaigns, email_campaign_recipients,
 * email_campaign_events. Recipients are sourced from shared.contacts (system
 * data, not an isolated list). Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { t } = require("../../config/brands");

/**
 * Compile a saved-segment audience filter into SQL AND-clauses against
 * shared.contacts (alias `a`). Pushes bound params onto `params` and returns
 * the clause strings. Honoured keys:
 *   contact_ids, contact_type[], priority_level[], source[], tag_names[],
 *   min_lifetime_spend, purchased_within_days, birthday_within_days.
 * Spend/recency read the brand's sales_orders. Unknown keys are ignored.
 */
function audienceClauses({ filter = {}, brand, alias = "a", params }) {
  const out = [];
  const add = (v) => {
    params.push(v);
    return params.length; // 1-based $ index
  };
  const arr = (v) => Array.isArray(v) && v.length > 0;

  if (arr(filter.contact_ids))
    out.push(`${alias}.contact_id = ANY($${add(filter.contact_ids)}::uuid[])`);
  if (arr(filter.contact_type))
    out.push(`${alias}.contact_type && $${add(filter.contact_type)}::text[]`);
  if (arr(filter.priority_level))
    out.push(
      `${alias}.priority_level = ANY($${add(filter.priority_level)}::text[])`,
    );
  if (arr(filter.source))
    out.push(`${alias}.source = ANY($${add(filter.source)}::text[])`);
  if (arr(filter.tag_names)) {
    const bi = add(brand);
    const ti = add(filter.tag_names);
    out.push(
      `EXISTS (SELECT 1 FROM shared.contact_tags ct
                WHERE ct.contact_id = ${alias}.contact_id
                  AND ct.business = $${bi}
                  AND ct.tag_name = ANY($${ti}::text[]))`,
    );
  }
  if (
    filter.min_lifetime_spend !== null &&
    filter.min_lifetime_spend !== undefined &&
    Number(filter.min_lifetime_spend) > 0
  ) {
    const i = add(Number(filter.min_lifetime_spend));
    out.push(
      `(SELECT COALESCE(SUM(o.amount_paid_ngn),0)
          FROM ${t(brand, "sales_orders")} o
         WHERE o.contact_id = ${alias}.contact_id) >= $${i}`,
    );
  }
  if (
    filter.purchased_within_days !== null &&
    filter.purchased_within_days !== undefined &&
    Number(filter.purchased_within_days) > 0
  ) {
    const i = add(String(Number(filter.purchased_within_days)));
    out.push(
      `EXISTS (SELECT 1 FROM ${t(brand, "sales_orders")} o
                WHERE o.contact_id = ${alias}.contact_id
                  AND o.status NOT IN ('draft','cancelled')
                  AND o.created_at >= now() - ($${i} || ' days')::interval)`,
    );
  }
  if (
    filter.birthday_within_days !== null &&
    filter.birthday_within_days !== undefined &&
    Number(filter.birthday_within_days) > 0
  ) {
    const i = add(String(Number(filter.birthday_within_days)));
    // Compare MMDD strings; handle the year-end wrap of the window.
    out.push(
      `(${alias}.date_of_birth IS NOT NULL AND (
         to_char(${alias}.date_of_birth,'MMDD')
           BETWEEN to_char(current_date,'MMDD')
               AND to_char(current_date + ($${i} || ' days')::interval,'MMDD')
         OR (
           to_char(current_date,'MMDD') > to_char(current_date + ($${i} || ' days')::interval,'MMDD')
           AND (to_char(${alias}.date_of_birth,'MMDD') >= to_char(current_date,'MMDD')
                OR to_char(${alias}.date_of_birth,'MMDD') <= to_char(current_date + ($${i} || ' days')::interval,'MMDD'))
         )
       ))`,
    );
  }
  return out;
}

async function nextNumber({ client, brand }) {
  const { rows } = await ex(client)(
    `SELECT ${t(brand, "fn_next_document_number")}('email_campaign') AS n`,
  );
  return rows[0].n;
}

// ── Templates ──────────────────────────────────────────────
async function listTemplates({ brand }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "email_templates")}
      WHERE is_active = true ORDER BY display_name`,
  );
  return rows;
}
async function getTemplate({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "email_templates")} WHERE template_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function createTemplate({ brand, tpl }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "email_templates")}
       (template_key, display_name, subject_line, html_body, available_variables,
        from_name, from_email, reply_to_email, status)
     VALUES ($1,$2,$3,$4,COALESCE($5::text[],'{}'),$6,$7,$8,COALESCE($9,'draft'))
     RETURNING *`,
    [
      tpl.template_key,
      tpl.display_name,
      tpl.subject_line,
      tpl.html_body,
      Array.isArray(tpl.available_variables) ? tpl.available_variables : null,
      tpl.from_name || null,
      tpl.from_email || null,
      tpl.reply_to_email || null,
      tpl.status,
    ],
  );
  return rows[0];
}
async function updateTemplate({ brand, id, patch }) {
  const cols = [
    "display_name",
    "subject_line",
    "html_body",
    "from_name",
    "from_email",
    "reply_to_email",
    "status",
    "is_active",
  ];
  const set = [];
  const params = [id];
  let i = 2;
  for (const c of cols) {
    if (patch[c] === undefined) continue;
    set.push(`${c} = $${i++}`);
    params.push(patch[c]);
  }
  if (!set.length) return getTemplate({ brand, id });
  const { rows } = await query(
    `UPDATE ${t(brand, "email_templates")} SET ${set.join(", ")}, updated_at = now()
      WHERE template_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}

// ── Campaigns ──────────────────────────────────────────────
async function createCampaign({ client, brand, c }) {
  const { rows } = await ex(client)(
    `INSERT INTO ${t(brand, "email_campaigns")}
       (campaign_number, campaign_name, campaign_type, segment_id,
        default_template_id, from_name, from_email, reply_to_email, status,
        scheduled_for, merge_data)
     VALUES ($1,$2,COALESCE($3,'one_off'),$4,$5,$6,$7,$8,'draft',$9,
             COALESCE($10::jsonb,'{}'::jsonb))
     RETURNING *`,
    [
      c.campaign_number,
      c.campaign_name,
      c.campaign_type,
      c.segment_id || null,
      c.default_template_id || null,
      c.from_name || null,
      c.from_email || null,
      c.reply_to_email || null,
      c.scheduled_for || null,
      c.merge_data ? JSON.stringify(c.merge_data) : null,
    ],
  );
  return rows[0];
}
async function updateCampaign({ client, brand, id, patch }) {
  const cols = [
    "campaign_name",
    "campaign_type",
    "segment_id",
    "default_template_id",
    "from_name",
    "from_email",
    "reply_to_email",
    "scheduled_for",
  ];
  const set = [];
  const params = [id];
  let i = 2;
  for (const c of cols) {
    if (patch[c] === undefined) continue;
    set.push(`${c} = $${i++}`);
    params.push(patch[c]);
  }
  if (patch.merge_data !== undefined) {
    set.push(`merge_data = $${i++}::jsonb`);
    params.push(JSON.stringify(patch.merge_data || {}));
  }
  if (!set.length) return getCampaign({ client, brand, id });
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "email_campaigns")} SET ${set.join(", ")}, updated_at = now()
      WHERE campaign_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function getCampaign({ client, brand, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "email_campaigns")} WHERE campaign_id = $1`,
    [id],
  );
  return rows[0] || null;
}
async function listCampaigns({ brand, status, page = 1, page_size = 25 }) {
  const where = [];
  const params = [];
  let i = 1;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const { rows: cnt } = await query(
    `SELECT count(*)::int AS total FROM ${t(brand, "email_campaigns")} ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "email_campaigns")} ${w}
      ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: cnt[0].total };
}
async function setCampaignStatus({ client, brand, id, status, fields = {} }) {
  const set = ["status = $2"];
  const params = [id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "email_campaigns")} SET ${set.join(", ")}, updated_at = now()
      WHERE campaign_id = $1 RETURNING *`,
    params,
  );
  return rows[0] || null;
}
async function incCampaignCounter({ client, brand, id, column, by = 1 }) {
  const allowed = new Set([
    "total_sent",
    "total_delivered",
    "total_opened",
    "total_clicked",
    "total_bounced",
    "total_unsubscribed",
  ]);
  if (!allowed.has(column)) return;
  await ex(client)(
    `UPDATE ${t(brand, "email_campaigns")}
        SET ${column} = ${column} + $2, updated_at = now() WHERE campaign_id = $1`,
    [id, by],
  );
}

// ── Recipients (sourced from contacts) ─────────────────────
async function addRecipientsFromContacts({ brand, campaign_id, filter = {} }) {
  // Brand-visible emailable contacts, narrowed by the segment filter.
  const params = [campaign_id, brand];
  const clauses = audienceClauses({ filter, brand, alias: "c", params });
  const extra = clauses.length ? `AND ${clauses.join("\n        AND ")}` : "";
  const { rowCount } = await query(
    `INSERT INTO ${t(brand, "email_campaign_recipients")}
       (campaign_id, contact_id, email, contact_name_snapshot, status)
     SELECT $1, c.contact_id, c.email, c.display_name, 'queued'
       FROM shared.contacts c
      WHERE c.is_deleted = false AND c.email IS NOT NULL
        AND ($2 = ANY(c.visible_to) OR c.visible_to = '{}')
        ${extra}
     ON CONFLICT (campaign_id, email) DO NOTHING`,
    params,
  );
  return rowCount;
}
async function listRecipients({
  brand,
  campaign_id,
  status,
  page = 1,
  page_size = 50,
}) {
  const where = ["campaign_id = $1"];
  const params = [campaign_id];
  let i = 2;
  if (status) {
    where.push(`status = $${i++}`);
    params.push(status);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "email_campaign_recipients")} ${w}
      ORDER BY queued_at LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return rows;
}
async function queuedRecipients({ client, brand, campaign_id, limit = 500 }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "email_campaign_recipients")}
      WHERE campaign_id = $1 AND status = 'queued' LIMIT $2`,
    [campaign_id, limit],
  );
  return rows;
}
async function setRecipientStatus({
  client,
  brand,
  recipient_id,
  status,
  fields = {},
}) {
  const set = ["status = $2"];
  const params = [recipient_id, status];
  let i = 3;
  for (const [col, val] of Object.entries(fields)) {
    set.push(`${col} = $${i++}`);
    params.push(val);
  }
  await ex(client)(
    `UPDATE ${t(brand, "email_campaign_recipients")} SET ${set.join(", ")}
      WHERE recipient_id = $1`,
    params,
  );
}
async function findRecipientByEmail({ brand, campaign_id, email }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "email_campaign_recipients")}
      WHERE campaign_id = $1 AND email = $2`,
    [campaign_id, email],
  );
  return rows[0] || null;
}

async function insertEvent({ client, brand, ev }) {
  await ex(client)(
    `INSERT INTO ${t(brand, "email_campaign_events")}
       (recipient_id, campaign_id, event_type, click_url, bounce_type,
        bounce_reason, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      ev.recipient_id,
      ev.campaign_id,
      ev.event_type,
      ev.click_url || null,
      ev.bounce_type || null,
      ev.bounce_reason || null,
      ev.ip_address || null,
      ev.user_agent || null,
    ],
  );
}
async function findRecipient({ client, brand, recipient_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM ${t(brand, "email_campaign_recipients")} WHERE recipient_id = $1`,
    [recipient_id],
  );
  return rows[0] || null;
}
/** Bump per-recipient engagement (first-touch timestamps + counters). */
async function bumpRecipientEngagement({ client, brand, recipient_id, kind }) {
  const col = kind === "open" ? "open_count" : "click_count";
  const firstCol = kind === "open" ? "first_opened_at" : "first_clicked_at";
  const { rows } = await ex(client)(
    `UPDATE ${t(brand, "email_campaign_recipients")}
        SET ${col} = ${col} + 1,
            ${firstCol} = COALESCE(${firstCol}, now())
      WHERE recipient_id = $1
      RETURNING (${firstCol} = now() AT TIME ZONE 'utc') AS unused, ${col} AS new_count,
                (${col} = 1) AS was_first`,
    [recipient_id],
  );
  return rows[0] || null;
}

// ── A/B variants ───────────────────────────────────────────
async function createVariant({ brand, v }) {
  const { rows } = await query(
    `INSERT INTO ${t(brand, "email_campaign_variants")}
       (campaign_id, variant_label, template_id, subject_line, from_name,
        preheader_text, allocation_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      v.campaign_id,
      v.variant_label,
      v.template_id || null,
      v.subject_line || null,
      v.from_name || null,
      v.preheader_text || null,
      v.allocation_pct,
    ],
  );
  return rows[0];
}
async function listVariants({ brand, campaign_id }) {
  const { rows } = await query(
    `SELECT * FROM ${t(brand, "email_campaign_variants")}
      WHERE campaign_id = $1 ORDER BY variant_label`,
    [campaign_id],
  );
  return rows;
}
async function setVariantWinner({ client, brand, campaign_id, variant_id }) {
  await ex(client)(
    `UPDATE ${t(brand, "email_campaign_variants")} SET is_winner = (variant_id = $2)
      WHERE campaign_id = $1`,
    [campaign_id, variant_id],
  );
  await ex(client)(
    `UPDATE ${t(brand, "email_campaigns")} SET ab_winner_variant_id = $2, updated_at = now()
      WHERE campaign_id = $1`,
    [campaign_id, variant_id],
  );
}

// ── Scheduling ─────────────────────────────────────────────
async function setSchedule({ brand, id, scheduled_for }) {
  const { rows } = await query(
    `UPDATE ${t(brand, "email_campaigns")}
        SET status = 'scheduled', scheduled_for = $2, updated_at = now()
      WHERE campaign_id = $1 RETURNING *`,
    [id, scheduled_for],
  );
  return rows[0] || null;
}
async function dueScheduledCampaigns({ brand, now }) {
  const { rows } = await query(
    `SELECT campaign_id FROM ${t(brand, "email_campaigns")}
      WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= $1`,
    [now],
  );
  return rows;
}

// ── Stats ──────────────────────────────────────────────────
async function eventBreakdown({ brand, campaign_id }) {
  const { rows } = await query(
    `SELECT event_type, count(*)::int AS count
       FROM ${t(brand, "email_campaign_events")}
      WHERE campaign_id = $1 GROUP BY event_type`,
    [campaign_id],
  );
  return rows;
}

// ── Saved segments (shared.contact_segments) ───────────────
async function listSegments({ brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.contact_segments WHERE business = $1 ORDER BY name`,
    [brand],
  );
  return rows;
}
async function getSegment({ brand, id }) {
  const { rows } = await query(
    `SELECT * FROM shared.contact_segments WHERE segment_id = $1 AND business = $2`,
    [id, brand],
  );
  return rows[0] || null;
}
async function createSegment({ brand, s, user_id }) {
  const { rows } = await query(
    `INSERT INTO shared.contact_segments (business, name, description, filter, created_by)
     VALUES ($1,$2,$3,COALESCE($4,'{}'::jsonb),$5) RETURNING *`,
    [
      brand,
      s.name,
      s.description || null,
      s.filter ? JSON.stringify(s.filter) : null,
      user_id || null,
    ],
  );
  return rows[0];
}
async function updateSegmentCount({ brand, id, count }) {
  await query(
    `UPDATE shared.contact_segments
        SET cached_count = $2, cached_at = now(), updated_at = now()
      WHERE segment_id = $1 AND business = $3`,
    [id, count, brand],
  );
}
async function deleteSegment({ brand, id }) {
  const { rows } = await query(
    `DELETE FROM shared.contact_segments WHERE segment_id = $1 AND business = $2 RETURNING segment_id`,
    [id, brand],
  );
  return rows[0] || null;
}
/** Resolve emailable contacts for an audience (optionally restricted to ids). */
async function emailableContacts({ brand, filter = {} }) {
  const params = [brand];
  const clauses = audienceClauses({ filter, brand, alias: "c", params });
  const extra = clauses.length ? `AND ${clauses.join("\n        AND ")}` : "";
  const { rows } = await query(
    `SELECT c.contact_id, c.email, c.display_name
       FROM shared.contacts c
      WHERE c.is_deleted = false AND c.email IS NOT NULL
        AND ($1 = ANY(c.visible_to) OR c.visible_to = '{}')
        ${extra}`,
    params,
  );
  return rows;
}

module.exports = {
  nextNumber,
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  createCampaign,
  updateCampaign,
  getCampaign,
  listCampaigns,
  setCampaignStatus,
  incCampaignCounter,
  addRecipientsFromContacts,
  listRecipients,
  queuedRecipients,
  setRecipientStatus,
  findRecipientByEmail,
  findRecipient,
  bumpRecipientEngagement,
  insertEvent,
  createVariant,
  listVariants,
  setVariantWinner,
  setSchedule,
  dueScheduledCampaigns,
  eventBreakdown,
  listSegments,
  getSegment,
  createSegment,
  updateSegmentCount,
  deleteSegment,
  emailableContacts,
};
