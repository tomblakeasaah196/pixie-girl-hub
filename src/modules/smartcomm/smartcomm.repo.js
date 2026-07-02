/**
 * Messaging Smartcomm (V2.2 §6.17) — repository.
 *
 * SHARED messaging tables. The list-channels query is the inbox row
 * (one indexed read per user thanks to the denorm last_message_* on
 * message_channels — see migration 000213). Parameterised SQL only.
 */

"use strict";

const { query, ex } = require("../../config/database");
const { config } = require("../../config/env");

// Build a browser-fetchable URL for a stored document file_path, mirroring
// services/storage.service.js (CDN when configured, else the /media proxy).
function mediaUrl(filePath) {
  if (!filePath) return null;
  return config.CDN_BASE_URL
    ? `${config.CDN_BASE_URL}/${filePath}`
    : `/media/${filePath}`;
}

// ── Channels ──────────────────────────────────────────────

/**
 * The inbox query — one row per channel the user is a member of,
 * enriched with the denormalised last message, unread count and
 * member-level pin/mute state.
 *
 *   filters: business, channel_type, external_platform, status,
 *            assigned_to_me, q (text search across name + preview),
 *            include_archived (default false)
 */
async function listChannelsForUser({
  user_id,
  brand,
  channel_type,
  external_platform,
  status,
  assigned_to_me,
  q,
  include_archived = false,
  limit = 50,
  offset = 0,
}) {
  const where = ["cm.user_id = $1"];
  const params = [user_id];
  let i = 2;
  if (brand) {
    where.push(`c.business = $${i++}`);
    params.push(brand);
  }
  if (!include_archived) where.push("c.is_archived = false");
  if (channel_type) {
    where.push(`c.channel_type = $${i++}`);
    params.push(channel_type);
  }
  if (external_platform) {
    where.push(`c.external_platform = $${i++}`);
    params.push(external_platform);
  }
  if (status) {
    where.push(`c.status = $${i++}`);
    params.push(status);
  }
  if (assigned_to_me) {
    where.push(`c.assigned_to = $1`);
  }
  if (q) {
    where.push(`(c.name ILIKE $${i} OR c.last_message_preview ILIKE $${i})`);
    params.push(`%${q}%`);
    i++;
  }

  // Pinned channels float to the top.
  const sql = `
    SELECT
      c.channel_id,
      c.channel_type,
      c.name,
      c.business,
      c.external_platform,
      c.external_thread_ref,
      c.status,
      c.assigned_to,
      c.assigned_at,
      c.wa_window_expires_at,
      c.metadata,
      c.is_archived,
      c.last_message_at,
      c.last_message_preview,
      c.last_message_kind,
      c.created_at,
      c.updated_at,
      cm.is_pinned,
      cm.muted_until,
      cm.notification_pref,
      cm.last_read_at,
      cm.role AS my_role,
      (
        SELECT count(*)::int FROM shared.messages m
         WHERE m.channel_id = c.channel_id
           AND m.is_deleted = false
           AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
           AND (m.sender_user_id IS DISTINCT FROM cm.user_id)
      ) AS unread_count
    FROM shared.channel_members cm
    JOIN shared.message_channels c ON c.channel_id = cm.channel_id
    WHERE ${where.join(" AND ")}
    ORDER BY cm.is_pinned DESC,
             COALESCE(c.last_message_at, c.created_at) DESC
    LIMIT $${i++} OFFSET $${i}`;
  params.push(limit, offset);

  const { rows } = await query(sql, params);
  return rows;
}

async function getChannel({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.message_channels WHERE channel_id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** Convenience: pull members + last 50 messages alongside the channel. */
async function getChannelEnriched({ id, user_id }) {
  const channel = await getChannel({ id });
  if (!channel) return null;
  const [members, messages, me] = await Promise.all([
    listMembers({ channel_id: id }),
    listMessages({ channel_id: id, limit: 50, user_id }),
    user_id ? findMember({ channel_id: id, user_id }) : Promise.resolve(null),
  ]);
  return { ...channel, members, messages, my_member: me };
}

async function findCustomerThread({ client, brand, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.message_channels
      WHERE channel_type = 'customer_thread' AND business = $1
        AND metadata->>'contact_id' = $2
      LIMIT 1`,
    [brand, contact_id],
  );
  return rows[0] || null;
}

async function findCustomerThreadByExternalRef({
  client,
  brand,
  platform,
  external_thread_ref,
}) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.message_channels
      WHERE channel_type = 'customer_thread'
        AND business = $1
        AND external_platform = $2
        AND external_thread_ref = $3
      LIMIT 1`,
    [brand, platform, external_thread_ref],
  );
  return rows[0] || null;
}

async function createChannel({ client, channel }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.message_channels
       (channel_type, name, business, external_platform, external_thread_ref, metadata, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb),$7) RETURNING *`,
    [
      channel.channel_type,
      channel.name || null,
      channel.business || null,
      channel.external_platform || null,
      channel.external_thread_ref || null,
      channel.metadata ? JSON.stringify(channel.metadata) : null,
      channel.created_by || null,
    ],
  );
  return rows[0];
}

async function setChannelArchived({ id, archived }) {
  const { rows } = await query(
    `UPDATE shared.message_channels SET is_archived = $2, updated_at = now()
      WHERE channel_id = $1 RETURNING *`,
    [id, archived],
  );
  return rows[0] || null;
}

async function setChannelStatus({ id, status, assigned_to }) {
  const { rows } = await query(
    `UPDATE shared.message_channels
        SET status = COALESCE($2, status),
            assigned_to = COALESCE($3, assigned_to),
            assigned_at = CASE WHEN $3 IS NOT NULL THEN now() ELSE assigned_at END,
            updated_at = now()
      WHERE channel_id = $1 RETURNING *`,
    [id, status || null, assigned_to || null],
  );
  return rows[0] || null;
}

// ── Members ───────────────────────────────────────────────

async function addMember({ client, m }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.channel_members (channel_id, user_id, contact_id, role)
     VALUES ($1,$2,$3,COALESCE($4,'member'))
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [m.channel_id, m.user_id || null, m.contact_id || null, m.role || null],
  );
  return rows[0] || null;
}

async function removeMember({ channel_id, member_id }) {
  const { rows } = await query(
    `DELETE FROM shared.channel_members
      WHERE channel_id = $1 AND member_id = $2 RETURNING member_id`,
    [channel_id, member_id],
  );
  return rows[0] || null;
}

async function listMembers({ channel_id }) {
  const { rows } = await query(
    `SELECT cm.*, u.display_name AS user_display_name,
            con.display_name AS contact_display_name,
            con.primary_phone, con.whatsapp_number, con.email
       FROM shared.channel_members cm
       LEFT JOIN shared.users    u   ON u.user_id    = cm.user_id
       LEFT JOIN shared.contacts con ON con.contact_id = cm.contact_id
      WHERE cm.channel_id = $1
      ORDER BY cm.joined_at`,
    [channel_id],
  );
  return rows;
}

async function findMember({ client, channel_id, user_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.channel_members
      WHERE channel_id = $1 AND user_id = $2 LIMIT 1`,
    [channel_id, user_id],
  );
  return rows[0] || null;
}

async function setMemberPinned({ channel_id, user_id, pinned }) {
  const { rows } = await query(
    `UPDATE shared.channel_members
        SET is_pinned = $3
      WHERE channel_id = $1 AND user_id = $2 RETURNING *`,
    [channel_id, user_id, !!pinned],
  );
  return rows[0] || null;
}

async function setMemberMuted({ channel_id, user_id, muted_until }) {
  const { rows } = await query(
    `UPDATE shared.channel_members
        SET muted_until = $3
      WHERE channel_id = $1 AND user_id = $2 RETURNING *`,
    [channel_id, user_id, muted_until || null],
  );
  return rows[0] || null;
}

async function touchMemberPresence({ user_id, when }) {
  await query(
    `UPDATE shared.channel_members
        SET last_seen_at = $2
      WHERE user_id = $1`,
    [user_id, when || new Date()],
  );
}

// ── Messages ──────────────────────────────────────────────

async function insertMessage({ client, message }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.messages
       (channel_id, sender_user_id, sender_contact_id, message_type, content,
        reply_to_id, external_ref, delivery_status, is_forwarded, forwarded_from_id, metadata)
     VALUES ($1,$2,$3,COALESCE($4,'text'),$5,$6,$7,COALESCE($8,'sent'),COALESCE($9,false),$10,
             COALESCE($11::jsonb, '{}'::jsonb))
     RETURNING *`,
    [
      message.channel_id,
      message.sender_user_id || null,
      message.sender_contact_id || null,
      message.message_type,
      message.content || null,
      message.reply_to_id || null,
      message.external_ref || null,
      message.delivery_status || null,
      message.is_forwarded || false,
      message.forwarded_from_id || null,
      message.metadata ? JSON.stringify(message.metadata) : null,
    ],
  );
  return rows[0];
}

async function setMessageExternalRef({ client, message_id, external_ref }) {
  await ex(client)(
    `UPDATE shared.messages SET external_ref = $2 WHERE message_id = $1`,
    [message_id, external_ref],
  );
}

async function setMessageDelivery({
  message_id,
  delivery_status,
  delivery_error,
  external_ref,
}) {
  await query(
    `UPDATE shared.messages
        SET delivery_status = COALESCE($2, delivery_status),
            delivery_error  = $3,
            external_ref    = COALESCE($4, external_ref)
      WHERE message_id = $1`,
    [
      message_id,
      delivery_status || null,
      delivery_error || null,
      external_ref || null,
    ],
  );
}

async function editMessageContent({ client, message_id, content }) {
  const { rows } = await ex(client)(
    `UPDATE shared.messages
        SET content = $2,
            edited_at = now()
      WHERE message_id = $1 AND is_deleted = false RETURNING *`,
    [message_id, content],
  );
  return rows[0] || null;
}

async function listMessages({ channel_id, before, limit = 50 }) {
  const params = [channel_id];
  let extra = "";
  if (before) {
    params.push(before);
    extra = ` AND m.created_at < $${params.length}`;
  }
  params.push(limit);
  // Bring reactions + stars + reply preview in one round-trip.
  const sql = `
    SELECT m.*,
           COALESCE(r.reactions, '[]'::jsonb) AS reactions,
           COALESCE(s.is_starred, false)      AS is_starred,
           rp.message_id  AS reply_message_id,
           rp.content     AS reply_content,
           rp.message_type AS reply_message_type,
           rp.sender_user_id AS reply_sender_user_id,
           rp_sender.display_name AS reply_sender_name,
           CASE WHEN m.sender_user_id IS NOT NULL THEN u.display_name
                WHEN m.sender_contact_id IS NOT NULL THEN con.display_name
                ELSE 'System' END AS sender_name,
           CASE WHEN m.sender_user_id IS NOT NULL THEN 'staff'
                WHEN m.sender_contact_id IS NOT NULL THEN 'customer'
                ELSE 'system' END AS sender_kind,
           COALESCE(att.attachments, '[]'::jsonb) AS attachments
      FROM shared.messages m
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
                 'emoji', mr.emoji,
                 'user_id', mr.user_id,
                 'user_name', ur.display_name)) AS reactions
          FROM shared.message_reactions mr
          LEFT JOIN shared.users ur ON ur.user_id = mr.user_id
         WHERE mr.message_id = m.message_id
      ) r ON true
      LEFT JOIN LATERAL (
        SELECT true AS is_starred FROM shared.message_stars ms
         WHERE ms.message_id = m.message_id AND ms.user_id = m.sender_user_id
         LIMIT 1
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
                 'document_id', ma.document_id,
                 'display_name', COALESCE(ma.display_name, d.title),
                 'mime_type', d.mime_type,
                 'file_size_bytes', d.file_size_bytes,
                 'file_path', d.file_path
               ) ORDER BY ma.created_at) AS attachments
          FROM shared.message_attachments ma
          LEFT JOIN shared.documents d ON d.document_id = ma.document_id
         WHERE ma.message_id = m.message_id
      ) att ON true
      LEFT JOIN shared.messages rp ON rp.message_id = m.reply_to_id
      LEFT JOIN shared.users rp_sender ON rp_sender.user_id = rp.sender_user_id
      LEFT JOIN shared.users u ON u.user_id = m.sender_user_id
      LEFT JOIN shared.contacts con ON con.contact_id = m.sender_contact_id
     WHERE m.channel_id = $1 AND m.is_deleted = false${extra}
     ORDER BY m.created_at ASC
     LIMIT $${params.length}`;
  const { rows } = await query(sql, params);
  // Turn each attachment's storage file_path into a browser URL (and drop the
  // raw path from the payload — the client only needs the URL + display meta).
  for (const r of rows) {
    if (Array.isArray(r.attachments)) {
      r.attachments = r.attachments.map((a) => ({
        document_id: a.document_id,
        display_name: a.display_name,
        mime_type: a.mime_type,
        file_size_bytes: a.file_size_bytes,
        url: mediaUrl(a.file_path),
      }));
    }
  }
  return rows;
}

async function getMessage({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.messages WHERE message_id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function softDeleteMessage({ client, id }) {
  const { rows } = await ex(client)(
    `UPDATE shared.messages SET is_deleted = true WHERE message_id = $1 RETURNING message_id, channel_id`,
    [id],
  );
  return rows[0] || null;
}

// ── Reactions ─────────────────────────────────────────────

async function toggleReaction({ message_id, user_id, emoji }) {
  // Try delete first; if nothing removed, insert. Returns { added }.
  const del = await query(
    `DELETE FROM shared.message_reactions
      WHERE message_id = $1 AND user_id = $2 AND emoji = $3 RETURNING reaction_id`,
    [message_id, user_id, emoji],
  );
  if (del.rows.length) return { added: false, emoji };
  await query(
    `INSERT INTO shared.message_reactions (message_id, user_id, emoji)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [message_id, user_id, emoji],
  );
  return { added: true, emoji };
}

async function listReactions({ message_id }) {
  const { rows } = await query(
    `SELECT mr.*, u.display_name AS user_name
       FROM shared.message_reactions mr
       LEFT JOIN shared.users u ON u.user_id = mr.user_id
      WHERE mr.message_id = $1
      ORDER BY mr.created_at`,
    [message_id],
  );
  return rows;
}

// ── Stars ─────────────────────────────────────────────────

async function toggleStar({ message_id, user_id }) {
  const del = await query(
    `DELETE FROM shared.message_stars
      WHERE message_id = $1 AND user_id = $2 RETURNING message_id`,
    [message_id, user_id],
  );
  if (del.rows.length) return { starred: false };
  await query(
    `INSERT INTO shared.message_stars (message_id, user_id)
     VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [message_id, user_id],
  );
  return { starred: true };
}

async function listStarredForUser({ user_id, limit = 100 }) {
  const { rows } = await query(
    `SELECT m.*, ms.created_at AS starred_at,
            c.name AS channel_name, c.channel_type,
            u.display_name AS sender_name
       FROM shared.message_stars ms
       JOIN shared.messages m ON m.message_id = ms.message_id AND m.is_deleted = false
       JOIN shared.message_channels c ON c.channel_id = m.channel_id
       LEFT JOIN shared.users u ON u.user_id = m.sender_user_id
      WHERE ms.user_id = $1
      ORDER BY ms.created_at DESC
      LIMIT $2`,
    [user_id, limit],
  );
  return rows;
}

// ── Search ────────────────────────────────────────────────

async function searchMessages({ user_id, q, channel_id, limit = 30 }) {
  // Restrict to channels the user belongs to.
  const params = [user_id, `%${q}%`];
  let extra = "";
  if (channel_id) {
    params.push(channel_id);
    extra = ` AND m.channel_id = $${params.length}`;
  }
  params.push(limit);
  const { rows } = await query(
    `SELECT m.message_id, m.channel_id, m.sender_user_id, m.message_type,
            m.content, m.created_at,
            c.name AS channel_name, c.channel_type,
            COALESCE(u.display_name, con.display_name, 'System') AS sender_name
       FROM shared.messages m
       JOIN shared.message_channels c  ON c.channel_id = m.channel_id
       JOIN shared.channel_members  cm ON cm.channel_id = c.channel_id AND cm.user_id = $1
       LEFT JOIN shared.users    u   ON u.user_id    = m.sender_user_id
       LEFT JOIN shared.contacts con ON con.contact_id = m.sender_contact_id
      WHERE m.is_deleted = false
        AND m.content ILIKE $2${extra}
      ORDER BY m.created_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows;
}

// ── Read receipts ─────────────────────────────────────────

async function markChannelRead({ client, channel_id, user_id, up_to_id }) {
  // Record per-message receipts then advance the cursor.
  if (up_to_id) {
    await ex(client)(
      `INSERT INTO shared.message_reads (message_id, user_id)
       SELECT m.message_id, $2 FROM shared.messages m
        WHERE m.channel_id = $1 AND m.is_deleted = false
          AND m.created_at <= (SELECT created_at FROM shared.messages WHERE message_id = $3)
          AND NOT EXISTS (
            SELECT 1 FROM shared.message_reads r
             WHERE r.message_id = m.message_id AND r.user_id = $2)
       ON CONFLICT DO NOTHING`,
      [channel_id, user_id, up_to_id],
    );
  } else {
    await ex(client)(
      `INSERT INTO shared.message_reads (message_id, user_id)
       SELECT m.message_id, $2 FROM shared.messages m
        WHERE m.channel_id = $1 AND m.is_deleted = false
          AND NOT EXISTS (
            SELECT 1 FROM shared.message_reads r
             WHERE r.message_id = m.message_id AND r.user_id = $2)
       ON CONFLICT DO NOTHING`,
      [channel_id, user_id],
    );
  }
  await ex(client)(
    `UPDATE shared.channel_members SET last_read_at = now()
      WHERE channel_id = $1 AND user_id = $2`,
    [channel_id, user_id],
  );
}

async function unreadCountForUser({ user_id, brand }) {
  const params = [user_id];
  let extra = "";
  if (brand) {
    params.push(brand);
    extra = ` AND c.business = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT c.channel_id, c.business, c.external_platform,
            count(m.message_id)::int AS unread
       FROM shared.channel_members cm
       JOIN shared.message_channels c ON c.channel_id = cm.channel_id
       JOIN shared.messages m
         ON m.channel_id = cm.channel_id
        AND m.is_deleted = false
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
        AND (m.sender_user_id IS DISTINCT FROM cm.user_id)
      WHERE cm.user_id = $1${extra}
        AND c.is_archived = false
      GROUP BY c.channel_id, c.business, c.external_platform`,
    params,
  );
  const total = rows.reduce((s, r) => s + r.unread, 0);
  return { total, by_channel: rows };
}

// ── Attachments ───────────────────────────────────────────

async function addAttachment({ client, a }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.message_attachments (message_id, document_id, display_name)
     VALUES ($1,$2,$3) RETURNING *`,
    [a.message_id, a.document_id, a.display_name || null],
  );
  return rows[0];
}

async function listAttachments({ message_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.message_attachments WHERE message_id = $1 ORDER BY created_at`,
    [message_id],
  );
  return rows;
}

// ── Drafts ────────────────────────────────────────────────

async function getDraft({ channel_id, user_id }) {
  const { rows } = await query(
    `SELECT * FROM shared.message_drafts WHERE channel_id = $1 AND user_id = $2`,
    [channel_id, user_id],
  );
  return rows[0] || null;
}

async function upsertDraft({
  channel_id,
  user_id,
  content,
  attachments,
  reply_to_id,
  generated_by,
}) {
  const { rows } = await query(
    `INSERT INTO shared.message_drafts
       (channel_id, user_id, content, attachments, reply_to_id, generated_by,
        generated_at, updated_at)
     VALUES ($1,$2,$3,COALESCE($4,'[]'::jsonb),$5,COALESCE($6,'human'),
             CASE WHEN COALESCE($6,'human') = 'praxis' THEN now() ELSE NULL END,
             now())
     ON CONFLICT (channel_id, user_id) DO UPDATE
       SET content       = EXCLUDED.content,
           attachments   = EXCLUDED.attachments,
           reply_to_id   = EXCLUDED.reply_to_id,
           generated_by  = EXCLUDED.generated_by,
           generated_at  = EXCLUDED.generated_at,
           updated_at    = now()
     RETURNING *`,
    [
      channel_id,
      user_id,
      content || "",
      attachments ? JSON.stringify(attachments) : null,
      reply_to_id || null,
      generated_by || null,
    ],
  );
  return rows[0];
}

async function deleteDraft({ channel_id, user_id }) {
  await query(
    `DELETE FROM shared.message_drafts WHERE channel_id = $1 AND user_id = $2`,
    [channel_id, user_id],
  );
}

// ── Quick replies ─────────────────────────────────────────

async function listQuickReplies({ user_id, brand }) {
  const { rows } = await query(
    `SELECT * FROM shared.message_quick_replies
      WHERE is_active = true
        AND (
          (scope = 'personal' AND owner_user_id = $1)
          OR (scope = 'brand' AND business = $2)
        )
      ORDER BY scope DESC, sort_order ASC, title ASC`,
    [user_id, brand || null],
  );
  return rows;
}

async function createQuickReply({ user_id, brand, input }) {
  const scope = input.scope || "personal";
  const { rows } = await query(
    `INSERT INTO shared.message_quick_replies
       (scope, owner_user_id, business, slug, title, body, variables, category, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0))
     RETURNING *`,
    [
      scope,
      scope === "personal" ? user_id : null,
      scope === "brand" ? brand : null,
      input.slug,
      input.title,
      input.body,
      input.variables || [],
      input.category || null,
      input.sort_order || 0,
    ],
  );
  return rows[0];
}

async function updateQuickReply({ reply_id, owner_user_id, brand, input }) {
  const { rows } = await query(
    `UPDATE shared.message_quick_replies
        SET title       = COALESCE($2, title),
            body        = COALESCE($3, body),
            variables   = COALESCE($4, variables),
            category    = COALESCE($5, category),
            sort_order  = COALESCE($6, sort_order),
            is_active   = COALESCE($7, is_active)
      WHERE reply_id = $1
        AND (
          (scope = 'personal' AND owner_user_id = $8)
          OR (scope = 'brand'  AND business = $9)
        )
      RETURNING *`,
    [
      reply_id,
      input.title,
      input.body,
      input.variables || null,
      input.category,
      input.sort_order,
      input.is_active,
      owner_user_id,
      brand,
    ],
  );
  return rows[0] || null;
}

async function deleteQuickReply({ reply_id, owner_user_id, brand }) {
  const { rows } = await query(
    `DELETE FROM shared.message_quick_replies
      WHERE reply_id = $1
        AND (
          (scope = 'personal' AND owner_user_id = $2)
          OR (scope = 'brand'  AND business = $3)
        )
      RETURNING reply_id`,
    [reply_id, owner_user_id, brand],
  );
  return rows[0] || null;
}

// ── Contact lookup + identity (for inbound webhook routing) ────

async function getContactChannelInfo({ client, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT contact_id, display_name, primary_phone, whatsapp_number, email
       FROM shared.contacts WHERE contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}

async function findContactByPhone({ client, phone }) {
  if (!phone) return null;
  const norm = phone.replace(/[^0-9+]/g, "");
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts
      WHERE is_deleted = false
        AND (whatsapp_number = $1 OR primary_phone = $1)
      LIMIT 1`,
    [norm],
  );
  return rows[0] || null;
}

async function findContactByEmail({ client, email }) {
  if (!email) return null;
  const { rows } = await ex(client)(
    `SELECT * FROM shared.contacts
      WHERE is_deleted = false AND email = $1
      LIMIT 1`,
    [email.toLowerCase()],
  );
  return rows[0] || null;
}

async function findContactBySocialHandle({
  client,
  platform,
  external_user_id,
}) {
  if (!external_user_id) return null;
  const { rows } = await ex(client)(
    `SELECT c.* FROM shared.contacts c
       JOIN shared.contact_social_handles h ON h.contact_id = c.contact_id
      WHERE h.platform = $1 AND h.external_user_id = $2
        AND c.is_deleted = false
      LIMIT 1`,
    [platform, external_user_id],
  );
  return rows[0] || null;
}

async function createLeadContact({ client, c }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.contacts
       (contact_type, display_name, first_name, last_name,
        primary_phone, whatsapp_number, email, date_of_birth, source,
        priority_level, visible_to)
     VALUES (ARRAY['customer'], $1, $2, $3, $4, $5, $6, $7, $8, 'new', COALESCE($9, ARRAY[]::text[]))
     RETURNING *`,
    [
      c.display_name || c.first_name || "New contact",
      c.first_name || null,
      c.last_name || null,
      c.primary_phone || null,
      c.whatsapp_number || null,
      c.email || null,
      c.date_of_birth || null,
      c.source || "instagram_dm",
      c.visible_to || null,
    ],
  );
  return rows[0];
}

async function upsertSocialHandle({ client, h }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.contact_social_handles
       (contact_id, platform, handle, external_user_id, display_name, profile_picture_url, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (platform, external_user_id) WHERE external_user_id IS NOT NULL
       DO UPDATE SET handle              = EXCLUDED.handle,
                     display_name        = EXCLUDED.display_name,
                     profile_picture_url = EXCLUDED.profile_picture_url,
                     verified_at         = COALESCE(shared.contact_social_handles.verified_at, now()),
                     updated_at          = now()
     RETURNING *`,
    [
      h.contact_id,
      h.platform,
      h.handle || null,
      h.external_user_id || null,
      h.display_name || null,
      h.profile_picture_url || null,
    ],
  );
  return rows[0];
}

// ── Messaging account lookup (webhook → brand routing) ────────

async function findMessagingAccount({ client, platform, external_account_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.messaging_accounts
      WHERE platform = $1 AND external_account_id = $2 AND is_active = true
      LIMIT 1`,
    [platform, external_account_id],
  );
  return rows[0] || null;
}

async function listMessagingAccounts({ brand }) {
  const params = [];
  let extra = "";
  if (brand) {
    params.push(brand);
    extra = `WHERE business = $${params.length} `;
  }
  const { rows } = await query(
    `SELECT account_id, business, platform, external_account_id, display_name,
            is_active, last_inbound_at, created_at
       FROM shared.messaging_accounts
       ${extra}
       ORDER BY business, platform`,
    params,
  );
  return rows;
}

// ── Customer 360 ──────────────────────────────────────────
// One read, four sections. Per the V2.0 schema-per-brand split,
// orders/invoices/deliveries live in business.* — we read both
// brand schemas under the assumption only one carries the contact.

async function customer360({ contact_id, brand }) {
  const contactRow = await query(
    `SELECT contact_id, display_name, company_name, primary_phone,
            whatsapp_number, email, priority_level, source,
            COALESCE(notes,'') AS notes
       FROM shared.contacts WHERE contact_id = $1`,
    [contact_id],
  );
  if (contactRow.rows.length === 0) return null;

  // The schema is named after the brand key; brand is required.
  // Falls back gracefully if brand is null.
  const schema = brand ? `"${brand}"` : null;
  let orders = [];
  let invoices = [];
  let deliveries = [];
  if (schema) {
    try {
      const o = await query(
        `SELECT order_id, order_number, status, total_ngn AS total,
                created_at, sales_channel
           FROM ${schema}.sales_orders
          WHERE contact_id = $1
          ORDER BY created_at DESC LIMIT 10`,
        [contact_id],
      );
      orders = o.rows;
    } catch {
      orders = [];
    }
    try {
      const inv = await query(
        `SELECT invoice_id, invoice_number, amount_due_ngn AS amount_due, due_date
           FROM ${schema}.invoices
          WHERE contact_id = $1 AND COALESCE(amount_due_ngn,0) > 0
          ORDER BY due_date NULLS LAST LIMIT 10`,
        [contact_id],
      );
      invoices = inv.rows;
    } catch {
      invoices = [];
    }
    try {
      const d = await query(
        `SELECT delivery_id, delivery_number, status, created_at
           FROM ${schema}.deliveries
          WHERE contact_id = $1
          ORDER BY created_at DESC LIMIT 10`,
        [contact_id],
      );
      deliveries = d.rows;
    } catch {
      deliveries = [];
    }
  }
  const handles = await query(
    `SELECT platform, handle, display_name, external_user_id
       FROM shared.contact_social_handles
      WHERE contact_id = $1`,
    [contact_id],
  );
  // Outbound comms audit ("did she get her receipt?") — best-effort; the
  // table arrives in 000229 so guard against running before the migration.
  let comms = [];
  try {
    const cl = await query(
      `SELECT log_id, channel, event_key, subject, recipient, status, created_at
         FROM shared.outbound_comms_log
        WHERE contact_id = $1
        ORDER BY created_at DESC LIMIT 10`,
      [contact_id],
    );
    comms = cl.rows;
  } catch {
    comms = [];
  }
  return {
    contact: contactRow.rows[0],
    handles: handles.rows,
    orders,
    invoices,
    deliveries,
    comms,
  };
}

module.exports = {
  // Channels
  listChannelsForUser,
  getChannel,
  getChannelEnriched,
  findCustomerThread,
  findCustomerThreadByExternalRef,
  createChannel,
  setChannelArchived,
  setChannelStatus,
  // Members
  addMember,
  removeMember,
  listMembers,
  findMember,
  setMemberPinned,
  setMemberMuted,
  touchMemberPresence,
  // Messages
  insertMessage,
  setMessageExternalRef,
  setMessageDelivery,
  editMessageContent,
  listMessages,
  getMessage,
  softDeleteMessage,
  // Reactions / stars / search
  toggleReaction,
  listReactions,
  toggleStar,
  listStarredForUser,
  searchMessages,
  // Reads
  markChannelRead,
  unreadCountForUser,
  // Attachments
  addAttachment,
  listAttachments,
  // Drafts
  getDraft,
  upsertDraft,
  deleteDraft,
  // Quick replies
  listQuickReplies,
  createQuickReply,
  updateQuickReply,
  deleteQuickReply,
  // Identity
  getContactChannelInfo,
  findContactByPhone,
  findContactByEmail,
  findContactBySocialHandle,
  createLeadContact,
  upsertSocialHandle,
  // Account routing
  findMessagingAccount,
  listMessagingAccounts,
  // Customer 360
  customer360,
};
