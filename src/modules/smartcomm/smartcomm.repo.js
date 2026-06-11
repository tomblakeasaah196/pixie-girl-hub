/**
 * Messaging Smartcomm (V2.2 §6.17) — repository.
 *
 * SHARED messaging tables: message_channels (group / direct / customer_thread)
 * + messages. A customer thread links to its contact via metadata.contact_id
 * (no extra join table needed). Parameterised SQL only.
 */

"use strict";

const { query } = require("../../config/database");

const ex = (c) => (c ? c.query.bind(c) : query);

async function listChannels({ brand, channel_type, page = 1, page_size = 30 }) {
  const where = ["business = $1", "is_archived = false"];
  const params = [brand];
  let i = 2;
  if (channel_type) {
    where.push(`channel_type = $${i++}`);
    params.push(channel_type);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.message_channels ${w}`,
    params,
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.message_channels ${w}
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT $${i++} OFFSET $${i}`,
    [...params, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
}

async function getChannel({ client, id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.message_channels WHERE channel_id = $1`,
    [id],
  );
  return rows[0] || null;
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

async function createChannel({ client, channel }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.message_channels
       (channel_type, name, business, external_platform, external_thread_ref, metadata)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'{}'::jsonb)) RETURNING *`,
    [
      channel.channel_type,
      channel.name || null,
      channel.business || null,
      channel.external_platform || null,
      channel.external_thread_ref || null,
      channel.metadata ? JSON.stringify(channel.metadata) : null,
    ],
  );
  return rows[0];
}

async function insertMessage({ client, message }) {
  const { rows } = await ex(client)(
    `INSERT INTO shared.messages
       (channel_id, sender_user_id, sender_contact_id, message_type, content,
        reply_to_id, external_ref)
     VALUES ($1,$2,$3,COALESCE($4,'text'),$5,$6,$7) RETURNING *`,
    [
      message.channel_id,
      message.sender_user_id || null,
      message.sender_contact_id || null,
      message.message_type,
      message.content || null,
      message.reply_to_id || null,
      message.external_ref || null,
    ],
  );
  return rows[0];
}

async function listMessages({ channel_id, page = 1, page_size = 50 }) {
  const { rows: c } = await query(
    `SELECT count(*)::int AS total FROM shared.messages
      WHERE channel_id = $1 AND is_deleted = false`,
    [channel_id],
  );
  const offset = (page - 1) * page_size;
  const { rows } = await query(
    `SELECT * FROM shared.messages
      WHERE channel_id = $1 AND is_deleted = false
      ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [channel_id, page_size, offset],
  );
  return { data: rows, page, page_size, total: c[0].total };
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
    `UPDATE shared.messages SET is_deleted = true WHERE message_id = $1 RETURNING message_id`,
    [id],
  );
  return rows[0] || null;
}

async function setChannelArchived({ id, archived }) {
  const { rows } = await query(
    `UPDATE shared.message_channels SET is_archived = $2, updated_at = now()
      WHERE channel_id = $1 RETURNING *`,
    [id, archived],
  );
  return rows[0] || null;
}

// ── Members ────────────────────────────────────────────────
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
    `SELECT * FROM shared.channel_members WHERE channel_id = $1 ORDER BY joined_at`,
    [channel_id],
  );
  return rows;
}
async function findMember({ client, channel_id, user_id }) {
  const { rows } = await ex(client)(
    `SELECT * FROM shared.channel_members WHERE channel_id = $1 AND user_id = $2`,
    [channel_id, user_id],
  );
  return rows[0] || null;
}

// ── Read receipts ──────────────────────────────────────────
async function markChannelRead({ client, channel_id, user_id }) {
  // Record per-message receipts for anything unread, then advance the marker.
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
  await ex(client)(
    `UPDATE shared.channel_members SET last_read_at = now()
      WHERE channel_id = $1 AND user_id = $2`,
    [channel_id, user_id],
  );
}
async function unreadCountForUser({ user_id }) {
  const { rows } = await query(
    `SELECT cm.channel_id,
            count(m.message_id)::int AS unread
       FROM shared.channel_members cm
       JOIN shared.messages m
         ON m.channel_id = cm.channel_id
        AND m.is_deleted = false
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)
        AND (m.sender_user_id IS DISTINCT FROM cm.user_id)
      WHERE cm.user_id = $1
      GROUP BY cm.channel_id`,
    [user_id],
  );
  const total = rows.reduce((s, r) => s + r.unread, 0);
  return { total, by_channel: rows };
}

// ── Attachments ────────────────────────────────────────────
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

/** Look up a contact's reachability for outbound dispatch. */
async function getContactChannelInfo({ client, contact_id }) {
  const { rows } = await ex(client)(
    `SELECT contact_id, display_name, primary_phone, whatsapp_number, email
       FROM shared.contacts WHERE contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}

module.exports = {
  listChannels,
  getChannel,
  findCustomerThread,
  createChannel,
  insertMessage,
  listMessages,
  getMessage,
  softDeleteMessage,
  setChannelArchived,
  addMember,
  removeMember,
  listMembers,
  findMember,
  markChannelRead,
  unreadCountForUser,
  addAttachment,
  listAttachments,
  getContactChannelInfo,
};
