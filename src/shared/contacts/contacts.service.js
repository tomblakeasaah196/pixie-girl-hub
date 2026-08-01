/**
 * Contacts (V2.2 §6.12) — business logic. Contacts are global; segments
 * are brand-scoped. Emits events consumed by CRM / Sales / Smartcomm.
 */

"use strict";

const repo = require("./contacts.repo");
const timelineRepo = require("./contacts.timeline.repo");
const events = require("./contacts.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, PermissionDeniedError } = require("../../utils/errors");

/**
 * Contact-type visibility guard (contacts §6.12). `allowedTypes` is
 * req.contact_type_scope: null = unrestricted. When restricted, block a write
 * that would give a contact a type the caller can't see (so they can't create
 * or convert a contact into one that then vanishes from their own view, nor
 * reach across the type boundary the CEO drew). An empty/absent type list on a
 * write is left to the caller — an untyped contact touches no boundary.
 */
function assertCanUseTypes(allowedTypes, types) {
  if (!Array.isArray(allowedTypes)) return; // unrestricted
  if (!Array.isArray(types) || types.length === 0) return; // nothing to check
  const allowed = new Set(allowedTypes);
  const blocked = types.filter((t) => !allowed.has(t));
  if (blocked.length) {
    throw new PermissionDeniedError(
      `You don't have access to these contact types: ${blocked.join(", ")}`,
    );
  }
}

const A = (
  brand,
  user_id,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
  before,
) =>
  audit({
    business: brand,
    user_id,
    action_key,
    target_type,
    target_id,
    before,
    after,
    request_id,
  });

// ── Contacts ─────────────────────────────────────────────
function list({ filters, page, page_size, allowedTypes = null }) {
  const offset = (page - 1) * page_size;
  return repo.findAll({ filters, allowedTypes, page, page_size, offset });
}
async function getById({ id, allowedTypes = null }) {
  const c = await repo.findById({ id, allowedTypes });
  if (!c) throw new NotFoundError("Contact");
  return c;
}

/** Contacts 360: time-sorted activity feed across all modules. */
async function getTimeline({
  brand,
  id,
  kinds,
  category,
  page,
  page_size,
  allowedTypes = null,
}) {
  const c = await repo.findById({ id, allowedTypes });
  if (!c) throw new NotFoundError("Contact");
  return timelineRepo.timeline({
    brand,
    contact_id: id,
    kinds,
    category,
    page,
    page_size,
  });
}

/** Contacts 360: header roll-up (orders, spend, AR, deals, loyalty).
 *  Shaped to match the frontend `ContactSummary` contract. */
async function getSummary({ brand, id, allowedTypes = null }) {
  const c = await repo.findById({ id, allowedTypes });
  if (!c) throw new NotFoundError("Contact");
  const raw = await timelineRepo.summary({ brand, contact_id: id });
  return {
    total_orders: Number(raw.orders_count ?? 0),
    lifetime_value_ngn: String(raw.lifetime_spend_ngn ?? "0"),
    last_activity_at: raw.last_activity_at ?? null,
    open_deals: Number(raw.open_deals ?? 0),
    churn_risk_score: raw.churn_risk_score ?? null,
    churn_risk_band: raw.churn_risk_band ?? null,
    loyalty_points: Number(raw.loyalty_balance ?? 0),
  };
}
async function create({ brand, user, request_id, input, allowedTypes = null }) {
  assertCanUseTypes(allowedTypes, input.contact_type);
  return transaction(async (client) => {
    const c = await repo.create({ client, input, user_id: user.user_id });
    await A(
      brand,
      user.user_id,
      "contacts.create",
      "contact",
      c.contact_id,
      c,
      request_id,
    );
    events.emit("created", { brand, id: c.contact_id });
    return c;
  });
}
async function update({
  brand,
  user,
  request_id,
  id,
  patch,
  allowedTypes = null,
}) {
  const before = await repo.findById({ id, allowedTypes });
  if (!before) throw new NotFoundError("Contact");
  // Can't re-type a contact into a bucket you can't see (would lose your own
  // access, or reach across the type boundary).
  assertCanUseTypes(allowedTypes, patch.contact_type);
  const c = await repo.update({ id, patch });
  await A(
    brand,
    user.user_id,
    "contacts.update",
    "contact",
    id,
    c,
    request_id,
    before,
  );
  events.emit("updated", { brand, id });
  return c;
}
async function remove({ brand, user, request_id, id, allowedTypes = null }) {
  // Gate on visibility first so a restricted role can't delete a contact it
  // can't even see (404, not 403 — never reveal the contact exists).
  const existing = await repo.findById({ id, allowedTypes });
  if (!existing) throw new NotFoundError("Contact");
  const ok = await repo.softDelete({ id });
  if (!ok) throw new NotFoundError("Contact");
  await A(
    brand,
    user.user_id,
    "contacts.delete",
    "contact",
    id,
    null,
    request_id,
  );
  events.emit("deleted", { brand, id });
}

// ── Segments ─────────────────────────────────────────────
const listSegments = ({ brand }) => repo.listSegments({ brand });
async function getSegment({ brand, id }) {
  const s = await repo.getSegment({ brand, id });
  if (!s) throw new NotFoundError("Segment");
  return s;
}
async function createSegment({ brand, user, request_id, input }) {
  const s = await repo.createSegment({ brand, input, user_id: user.user_id });
  await A(
    brand,
    user.user_id,
    "contacts.segment.create",
    "contact_segment",
    s.segment_id,
    s,
    request_id,
  );
  return s;
}
async function updateSegment({ brand, user, request_id, id, patch }) {
  const before = await repo.getSegment({ brand, id });
  if (!before) throw new NotFoundError("Segment");
  const s = await repo.updateSegment({ brand, id, patch });
  await A(
    brand,
    user.user_id,
    "contacts.segment.update",
    "contact_segment",
    id,
    s,
    request_id,
    before,
  );
  return s;
}
async function deleteSegment({ brand, user, request_id, id }) {
  const ok = await repo.deleteSegment({ brand, id });
  if (!ok) throw new NotFoundError("Segment");
  await A(
    brand,
    user.user_id,
    "contacts.segment.delete",
    "contact_segment",
    id,
    null,
    request_id,
  );
}

// ── Addresses (under a contact) ──────────────────────────
// ensureContact doubles as the visibility gate for every sub-resource (tags,
// addresses): if the caller's type scope can't see the parent contact, it
// reads as "not found" and the whole sub-operation 404s.
async function ensureContact({ id, allowedTypes = null }) {
  const c = await repo.findById({ id, allowedTypes });
  if (!c) throw new NotFoundError("Contact");
  return c;
}
async function listAddresses({ id, allowedTypes = null }) {
  await ensureContact({ id, allowedTypes });
  return repo.listAddresses({ contact_id: id });
}
async function addAddress({ brand, user, request_id, id, input, allowedTypes = null }) {
  await ensureContact({ id, allowedTypes });
  return transaction(async (client) => {
    if (input.is_default) {
      await repo.clearDefaultAddresses({
        client,
        contact_id: id,
        address_type: input.address_type || "delivery",
      });
    }
    const addr = await repo.addAddress({
      client,
      contact_id: id,
      input,
      user_id: user.user_id,
    });
    await A(
      brand,
      user.user_id,
      "contacts.address.add",
      "contact_address",
      addr.address_id,
      addr,
      request_id,
    );
    events.emit("address.added", {
      brand,
      contact_id: id,
      address_id: addr.address_id,
    });
    return addr;
  });
}
async function updateAddress({
  brand,
  user,
  request_id,
  id,
  address_id,
  patch,
  allowedTypes = null,
}) {
  await ensureContact({ id, allowedTypes });
  return transaction(async (client) => {
    const before = await repo.getAddress({
      client,
      contact_id: id,
      address_id,
    });
    if (!before) throw new NotFoundError("Address");
    if (patch.is_default) {
      await repo.clearDefaultAddresses({
        client,
        contact_id: id,
        address_type: patch.address_type || before.address_type,
      });
    }
    const addr = await repo.updateAddress({
      client,
      contact_id: id,
      address_id,
      patch,
    });
    await A(
      brand,
      user.user_id,
      "contacts.address.update",
      "contact_address",
      address_id,
      addr,
      request_id,
      before,
    );
    return addr;
  });
}
async function deleteAddress({
  brand,
  user,
  request_id,
  id,
  address_id,
  allowedTypes = null,
}) {
  await ensureContact({ id, allowedTypes });
  const ok = await repo.deleteAddress({ contact_id: id, address_id });
  if (!ok) throw new NotFoundError("Address");
  await A(
    brand,
    user.user_id,
    "contacts.address.delete",
    "contact_address",
    address_id,
    null,
    request_id,
  );
}

/** Upcoming contact birthdays within `days` days (default 7, clamped 1..366). */
function milestones({ days, allowedTypes = null }) {
  const d = Math.min(Math.max(Number(days) || 7, 1), 366);
  return repo.upcomingMilestones({ days: d, allowedTypes });
}

// ── Contact tags ─────────────────────────────────────────
async function listTags({ brand, id, allowedTypes = null }) {
  await ensureContact({ id, allowedTypes });
  return repo.listTags({ brand, contact_id: id });
}
async function addTag({ brand, user, request_id, id, input, allowedTypes = null }) {
  await ensureContact({ id, allowedTypes });
  const tag = await repo.addTag({
    brand,
    contact_id: id,
    tag_name: input.tag_name,
    colour: input.colour,
    user_id: user.user_id,
  });
  await A(
    brand,
    user.user_id,
    "contacts.tag.add",
    "contact",
    id,
    { tag_name: input.tag_name },
    request_id,
  );
  return tag;
}
async function removeTag({ brand, user, request_id, id, tag_id, allowedTypes = null }) {
  await ensureContact({ id, allowedTypes });
  const ok = await repo.removeTag({ brand, contact_id: id, tag_id });
  if (!ok) throw new NotFoundError("Tag");
  await A(
    brand,
    user.user_id,
    "contacts.tag.remove",
    "contact",
    id,
    { tag_id },
    request_id,
  );
}

// ── Global tag management (tag_name is the identity) ─────────
function listAllTags({ brand }) {
  return repo.listAllTags({ brand });
}
async function updateTag({ brand, user, request_id, tag_id, input }) {
  const tag = await repo.renameTagGlobal({
    brand,
    old_name: tag_id,
    new_name: input.tag_name,
    colour: input.colour,
  });
  await A(
    brand,
    user.user_id,
    "contacts.tag.update",
    "contact_tag",
    tag_id,
    { new_name: input.tag_name, colour: input.colour },
    request_id,
  );
  return tag;
}
async function deleteTagGlobal({ brand, user, request_id, tag_id }) {
  const removed = await repo.deleteTagGlobal({ brand, tag_name: tag_id });
  await A(
    brand,
    user.user_id,
    "contacts.tag.delete",
    "contact_tag",
    tag_id,
    { removed },
    request_id,
  );
}
async function mergeTags({ brand, user, request_id, source_tag_id, target_tag_id }) {
  const tag = await repo.renameTagGlobal({
    brand,
    old_name: source_tag_id,
    new_name: target_tag_id,
  });
  await A(
    brand,
    user.user_id,
    "contacts.tag.merge",
    "contact_tag",
    target_tag_id,
    { from: source_tag_id },
    request_id,
  );
  return tag;
}

function stats({ brand, allowedTypes = null }) {
  return repo.stats({ brand, allowedTypes });
}

module.exports = {
  stats,
  listTags,
  addTag,
  removeTag,
  listAllTags,
  updateTag,
  deleteTagGlobal,
  mergeTags,
  milestones,
  list,
  getById,
  getTimeline,
  getSummary,
  create,
  update,
  remove,
  listSegments,
  getSegment,
  createSegment,
  updateSegment,
  deleteSegment,
  listAddresses,
  addAddress,
  updateAddress,
  deleteAddress,
};
