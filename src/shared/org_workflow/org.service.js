/**
 * Organisation & Workflow Builder (V2.2 §6.27)
 * Business logic layer. Repos handle SQL; controllers handle HTTP.
 *
 * Owns: brand-isolation guards beyond shape, transaction orchestration,
 * audit logging, and domain-event emission for both org_units and
 * org_positions.
 */

"use strict";

const repo = require("./org.repo");
const grantsRepo = require("../access/grants.repo");
const events = require("./org.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError } = require("../../utils/errors");

/**
 * The organigramme hard link (V2.2 §6.27, owner Q1): a position grants its
 * role to whoever holds it, and the holder's job title + department flow from
 * the position. When the (person, role) pairing on a position changes we grant
 * the new role and revoke the old — unless the same person still holds that
 * role via another seat. Roles are only granted to people who have a login;
 * title/department always sync. `before`/`after` are enriched position rows
 * (findPosition), so they carry `unit_name` for the department.
 */
async function applyPositionAssignment({ client, brand, granted_by, before, after }) {
  const oldProfile = before?.profile_id ?? null;
  const oldRole = before?.role_id ?? null;
  const newProfile = after?.profile_id ?? null;
  const newRole = after?.role_id ?? null;
  const changed = oldProfile !== newProfile || oldRole !== newRole;

  if (changed && oldProfile && oldRole) {
    const stillHeld = await repo.profileHoldsRoleElsewhere({
      client,
      brand,
      profile_id: oldProfile,
      role_id: oldRole,
      exclude_position_id: after?.position_id ?? before.position_id,
    });
    if (!stillHeld) {
      const oldUser = await repo.userIdForProfile({ client, profile_id: oldProfile });
      if (oldUser) {
        await grantsRepo.revokeRole({
          client,
          user_id: oldUser,
          role_id: oldRole,
          business: brand,
        });
      }
    }
  }

  if (changed && newProfile && newRole) {
    const newUser = await repo.userIdForProfile({ client, profile_id: newProfile });
    if (newUser) {
      await grantsRepo.grantRole({
        client,
        user_id: newUser,
        role_id: newRole,
        business: brand,
        granted_by,
      });
    }
  }

  // Keep the holder's title + department aligned with the seat (also catches a
  // renamed position / moved unit even when the pairing itself didn't change).
  if (newProfile) {
    await repo.syncProfileFromPosition({
      client,
      brand,
      profile_id: newProfile,
      job_title: after.display_name,
      department: after.unit_name,
    });
  }
}

// ── org_units ──────────────────────────────────────────────

async function list({ brand, filters, page, page_size }) {
  return repo.findAll({ brand, filters, page, page_size });
}

async function getById({ brand, id }) {
  const item = await repo.findById({ brand, id });
  if (!item) throw new NotFoundError("OrgUnit");
  return item;
}

async function create({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const created = await repo.create({ client, brand, input });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.create_unit",
      target_type: "org_units",
      target_id: created.unit_id,
      after: created,
      request_id,
    });
    events.emit("unit_created", {
      brand,
      unit_id: created.unit_id,
      user_id: user.user_id,
    });
    return created;
  });
}

async function update({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("OrgUnit");
    const updated = await repo.update({ client, brand, id, patch });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.update_unit",
      target_type: "org_units",
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    events.emit("unit_updated", { brand, unit_id: id, user_id: user.user_id });
    return updated;
  });
}

async function archive({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.findById({ client, brand, id });
    if (!before) throw new NotFoundError("OrgUnit");
    await repo.deactivate({ client, brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.deactivate_unit",
      target_type: "org_units",
      target_id: id,
      before,
      request_id,
    });
    events.emit("unit_deactivated", {
      brand,
      unit_id: id,
      user_id: user.user_id,
    });
  });
}

// ── org_positions ──────────────────────────────────────────

async function listPositions({ brand, unit_id }) {
  return { data: await repo.listPositions({ brand, unit_id }) };
}

async function getPosition({ brand, id }) {
  const item = await repo.findPosition({ brand, id });
  if (!item) throw new NotFoundError("OrgPosition");
  return item;
}

async function createPosition({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    // Brand isolation: the parent unit must belong to this brand.
    const ok = await repo.unitBelongsToBrand({
      client,
      brand,
      unit_id: input.unit_id,
    });
    if (!ok) throw new NotFoundError("OrgUnit");

    const createdRaw = await repo.createPosition({ client, brand, input });
    // Re-read enriched (unit_name/role_name/holder_name) for the response and
    // for the assignment sync below.
    const created = await repo.findPosition({
      client,
      brand,
      id: createdRaw.position_id,
    });
    await applyPositionAssignment({
      client,
      brand,
      granted_by: user.user_id,
      before: null,
      after: created,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.create_position",
      target_type: "org_positions",
      target_id: created.position_id,
      after: created,
      request_id,
    });
    events.emit("position_created", {
      brand,
      position_id: created.position_id,
      user_id: user.user_id,
    });
    return created;
  });
}

async function updatePosition({ brand, user, request_id, id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findPosition({ client, brand, id });
    if (!before) throw new NotFoundError("OrgPosition");
    // If the unit is being reassigned, the new unit must be in-brand too.
    if (patch.unit_id && patch.unit_id !== before.unit_id) {
      const ok = await repo.unitBelongsToBrand({
        client,
        brand,
        unit_id: patch.unit_id,
      });
      if (!ok) throw new NotFoundError("OrgUnit");
    }
    await repo.updatePosition({ client, brand, id, patch });
    const updated = await repo.findPosition({ client, brand, id });
    await applyPositionAssignment({
      client,
      brand,
      granted_by: user.user_id,
      before,
      after: updated,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.update_position",
      target_type: "org_positions",
      target_id: id,
      before,
      after: updated,
      request_id,
    });
    events.emit("position_updated", {
      brand,
      position_id: id,
      user_id: user.user_id,
    });
    return updated;
  });
}

async function deletePosition({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const before = await repo.findPosition({ client, brand, id });
    if (!before) throw new NotFoundError("OrgPosition");
    // Removing the seat revokes the role it granted its holder (unless they
    // still hold it via another position).
    await applyPositionAssignment({
      client,
      brand,
      granted_by: user.user_id,
      before,
      after: null,
    });
    await repo.deletePosition({ client, brand, id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.delete_position",
      target_type: "org_positions",
      target_id: id,
      before,
      request_id,
    });
    events.emit("position_deleted", {
      brand,
      position_id: id,
      user_id: user.user_id,
    });
  });
}

// ── org_position_dotted_lines (info-only; never approval) ──

async function listDottedLines({ brand, position_id }) {
  return { data: await repo.listDottedLines({ brand, position_id }) };
}

async function createDottedLine({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    // Both endpoints must belong to this brand (isolation).
    const fromOk = await repo.positionBelongsToBrand({
      client,
      brand,
      position_id: input.position_id,
    });
    const toOk = await repo.positionBelongsToBrand({
      client,
      brand,
      position_id: input.dotted_to_position_id,
    });
    if (!fromOk || !toOk) throw new NotFoundError("OrgPosition");

    const created = await repo.createDottedLine({ client, brand, input });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.create_dotted_line",
      target_type: "org_position_dotted_lines",
      target_id: created.dotted_id,
      after: created,
      request_id,
    });
    events.emit("dotted_line_created", {
      brand,
      dotted_id: created.dotted_id,
      user_id: user.user_id,
    });
    return created;
  });
}

async function updateDottedLine({ brand, user, request_id, dotted_id, patch }) {
  return transaction(async (client) => {
    const before = await repo.findDottedLine({ client, brand, dotted_id });
    if (!before) throw new NotFoundError("DottedLine");
    const updated = await repo.updateDottedLine({
      client,
      brand,
      dotted_id,
      patch,
    });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.update_dotted_line",
      target_type: "org_position_dotted_lines",
      target_id: dotted_id,
      before,
      after: updated,
      request_id,
    });
    events.emit("dotted_line_updated", {
      brand,
      dotted_id,
      user_id: user.user_id,
    });
    return updated;
  });
}

async function deleteDottedLine({ brand, user, request_id, dotted_id }) {
  return transaction(async (client) => {
    const before = await repo.findDottedLine({ client, brand, dotted_id });
    if (!before) throw new NotFoundError("DottedLine");
    await repo.deleteDottedLine({ client, brand, dotted_id });
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "org_workflow.delete_dotted_line",
      target_type: "org_position_dotted_lines",
      target_id: dotted_id,
      before,
      request_id,
    });
    events.emit("dotted_line_deleted", {
      brand,
      dotted_id,
      user_id: user.user_id,
    });
  });
}

module.exports = {
  list,
  getById,
  create,
  update,
  archive,
  listPositions,
  getPosition,
  createPosition,
  updatePosition,
  deletePosition,
  listDottedLines,
  createDottedLine,
  updateDottedLine,
  deleteDottedLine,
};
