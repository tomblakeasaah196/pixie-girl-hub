/**
 * Identity & Access Administration service (V2.2 §3 — RBAC).
 *
 * Orchestrates role definitions, the role→permission matrix, user-role grants,
 * and per-user brand access. Every mutation is audited as sensitive and
 * emits a domain event. Escalation guards (access.guards) stop a delegated
 * `settings` admin from granting themselves the owner role or rewriting
 * system roles; the owner/CEO bypasses them.
 *
 * Note: the RBAC middleware reads shared.permissions directly (no cache), so
 * matrix and grant changes take effect on the user's next request.
 */

"use strict";

const rolesRepo = require("./roles.repo");
const grantsRepo = require("./grants.repo");
const guards = require("./access.guards");
const catalog = require("./access.catalog");
const events = require("./access.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const {
  NotFoundError,
  ConflictError,
  ValidationError,
} = require("../../utils/errors");

function sensitiveAudit(fields) {
  return audit({ ...fields, is_sensitive: true });
}

// ── roles ──────────────────────────────────────────────────

async function listRoles({ brand }) {
  return { data: await rolesRepo.listRoles({ business: brand }) };
}

async function getRole({ role_id }) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  const [permissions, members, ctAccess] = await Promise.all([
    rolesRepo.listPermissions({ role_id }),
    grantsRepo.listRoleMembers({ role_id }),
    rolesRepo.getContactTypeAccess({ role_id }),
  ]);
  return {
    ...role,
    permissions,
    members,
    // Contacts §6.12: null = unrestricted (sees every type); a row restricts to
    // its contact_types (empty array = sees no contacts).
    contact_type_access: ctAccess ? ctAccess.contact_types : null,
  };
}

async function createRole({ brand, user, request_id, input }) {
  // A system-wide role (business = null) may only be created by the owner.
  const business = input.scope === "system" ? null : brand;
  if (business === null && !guards.isOwnerActor(user)) {
    throw new ValidationError("Only the owner can create a system-wide role");
  }
  const dupe = await rolesRepo.findRoleByName({
    role_name: input.role_name,
    business,
  });
  if (dupe) throw new ConflictError("A role with that name already exists");

  return transaction(async (client) => {
    const role = await rolesRepo.createRole({
      client,
      role_name: input.role_name,
      description: input.description,
      business,
    });
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.create_role",
      target_type: "roles",
      target_id: role.role_id,
      after: role,
      request_id,
    });
    events.emit("role_created", { brand, role_id: role.role_id });
    return role;
  });
}

async function updateRole({ brand, user, request_id, role_id, patch }) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  guards.assertCanMutateRole(user, role);

  if (patch.role_name && patch.role_name !== role.role_name) {
    const dupe = await rolesRepo.findRoleByName({
      role_name: patch.role_name,
      business: role.business,
    });
    if (dupe) throw new ConflictError("A role with that name already exists");
  }

  return transaction(async (client) => {
    const updated = await rolesRepo.updateRole({
      client,
      role_id,
      patch: {
        role_name: patch.role_name,
        description: patch.description,
      },
    });
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.update_role",
      target_type: "roles",
      target_id: role_id,
      before: role,
      after: updated,
      request_id,
    });
    events.emit("role_updated", { brand, role_id });
    return updated;
  });
}

async function deleteRole({ brand, user, request_id, role_id }) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  guards.assertCanDeleteRole(user, role);

  return transaction(async (client) => {
    await rolesRepo.deleteRole({ client, role_id });
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.delete_role",
      target_type: "roles",
      target_id: role_id,
      before: role,
      request_id,
    });
    events.emit("role_deleted", { brand, role_id });
  });
}

// ── permission matrix ──────────────────────────────────────

function getCatalog() {
  return catalog.catalog();
}

async function getRolePermissions({ role_id }) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  return { data: await rolesRepo.listPermissions({ role_id }) };
}

function validateGrants(grants) {
  const seen = new Set();
  for (const g of grants) {
    if (!catalog.isValidModule(g.module)) {
      throw new ValidationError(`Unknown module '${g.module}'`);
    }
    if (!catalog.isValidAction(g.action)) {
      throw new ValidationError(`Unknown action '${g.action}'`);
    }
    if (g.record_scope && !catalog.isValidScope(g.record_scope)) {
      throw new ValidationError(`Invalid record_scope '${g.record_scope}'`);
    }
    const key = `${g.module}.${g.action}`;
    if (seen.has(key)) {
      throw new ValidationError(`Duplicate grant for '${key}'`);
    }
    seen.add(key);
  }
}

async function setRolePermissions({
  brand,
  user,
  request_id,
  role_id,
  grants,
}) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  guards.assertCanEditPermissions(user, role);
  validateGrants(grants);

  return transaction(async (client) => {
    const before = await rolesRepo.listPermissions({ client, role_id });
    const after = await rolesRepo.replacePermissions({
      client,
      role_id,
      grants,
    });
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.set_permissions",
      target_type: "permissions",
      target_id: role_id,
      before: { permissions: before },
      after: { permissions: after },
      request_id,
    });
    events.emit("permissions_changed", { brand, role_id });
    return { data: after };
  });
}

// ── contact-type visibility (contacts §6.12) ───────────────

/** A role's contact-type allow-list, or null when the role is unrestricted. */
async function getRoleContactTypes({ role_id }) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  const row = await rolesRepo.getContactTypeAccess({ role_id });
  return { data: row ? row.contact_types : null };
}

/**
 * Set (or clear) which contact types a role may see.
 *   contact_types = null  → clear the restriction (role sees every type again)
 *   contact_types = [...]  → restrict to that set (empty array = sees none)
 */
async function setRoleContactTypes({
  brand,
  user,
  request_id,
  role_id,
  contact_types,
}) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  // Reuse the permission-matrix guard: editing contact visibility is the same
  // class of change as editing the role's grants.
  guards.assertCanEditPermissions(user, role);

  if (contact_types !== null && contact_types !== undefined) {
    if (!Array.isArray(contact_types)) {
      throw new ValidationError("contact_types must be an array or null");
    }
    const bad = contact_types.filter((t) => !catalog.isValidContactType(t));
    if (bad.length) {
      throw new ValidationError(`Unknown contact type(s): ${bad.join(", ")}`);
    }
  }

  return transaction(async (client) => {
    const before = await rolesRepo.getContactTypeAccess({ client, role_id });
    let after = null;
    if (contact_types === null || contact_types === undefined) {
      await rolesRepo.clearContactTypeAccess({ client, role_id });
    } else {
      const row = await rolesRepo.setContactTypeAccess({
        client,
        role_id,
        contact_types: [...new Set(contact_types)],
        updated_by: user.user_id,
      });
      after = row.contact_types;
    }
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.set_contact_types",
      target_type: "role_contact_type_access",
      target_id: role_id,
      before: { contact_types: before ? before.contact_types : null },
      after: { contact_types: after },
      request_id,
    });
    events.emit("contact_type_access_changed", { brand, role_id });
    return { data: after };
  });
}

// ── user-role grants ───────────────────────────────────────

async function listUserRoles({ user_id }) {
  return { data: await grantsRepo.listUserRoles({ user_id }) };
}

/** Grantable login users for the active brand, for the bulk-assign picker. */
async function listGrantableUsers({ brand, search }) {
  const term = typeof search === "string" ? search.trim().slice(0, 100) : "";
  return {
    data: await grantsRepo.listGrantableUsers({
      business: brand,
      search: term || undefined,
    }),
  };
}

async function assertBusinessValue(client, business) {
  if (business === "*") return;
  const brands = await grantsRepo.validBrands({ client });
  if (!brands.includes(business)) {
    throw new ValidationError(`Unknown business '${business}'`);
  }
}

/**
 * Grant `role_id`/`business` to one user inside an open transaction, extending
 * the user's brand access when the grant targets a concrete business they can't
 * yet enter (otherwise the role is a silent no-op — brand-context 403s before
 * RBAC ever sees it). Audits + emits per user. Shared by the single- and
 * bulk-grant paths so both behave identically. `target` is the userExists row.
 */
async function applyRoleGrant({
  client,
  brand,
  actor,
  request_id,
  user_id,
  role_id,
  business,
  expires_at,
  target,
}) {
  const grant = await grantsRepo.grantRole({
    client,
    user_id,
    role_id,
    business,
    granted_by: actor.user_id,
    expires_at,
  });
  let accessExtended = false;
  if (
    business !== "*" &&
    !(target.permitted_businesses || []).includes(business)
  ) {
    await grantsRepo.setUserAccess({
      client,
      user_id,
      permitted_businesses: [...(target.permitted_businesses || []), business],
      default_business: target.default_business || business,
    });
    accessExtended = true;
  }
  await sensitiveAudit({
    business: brand,
    user_id: actor.user_id,
    action_key: "access.grant_role",
    target_type: "user_roles",
    target_id: user_id,
    after: accessExtended
      ? { ...grant, permitted_business_added: business }
      : grant,
    request_id,
  });
  events.emit("role_granted", { brand, user_id, role_id });
  return grant;
}

async function grantUserRole({ brand, user, request_id, user_id, input }) {
  const role = await rolesRepo.findRole({ role_id: input.role_id });
  if (!role) throw new NotFoundError("Role");
  guards.assertCanGrantRole(user, role);

  const target = await grantsRepo.userExists({ user_id });
  if (!target) throw new NotFoundError("User");

  return transaction(async (client) => {
    await assertBusinessValue(client, input.business);
    return applyRoleGrant({
      client,
      brand,
      actor: user,
      request_id,
      user_id,
      role_id: input.role_id,
      business: input.business,
      expires_at: input.expires_at,
      target,
    });
  });
}

/**
 * Bulk-grant one role to many users at once (the "assign this role to these N
 * staff" flow). Validates the role + actor authority once, then grants each
 * user in a single transaction. Users that don't exist are skipped and
 * reported rather than failing the whole batch; re-granting is idempotent.
 */
async function grantRoleMembers({ brand, user, request_id, role_id, input }) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  guards.assertCanGrantRole(user, role);

  const business = input.business;
  const userIds = [...new Set(input.user_ids)];

  return transaction(async (client) => {
    await assertBusinessValue(client, business);
    const granted = [];
    const skipped = [];
    for (const targetId of userIds) {
      const target = await grantsRepo.userExists({ client, user_id: targetId });
      if (!target) {
        skipped.push({ user_id: targetId, reason: "not_found" });
        continue;
      }
      await applyRoleGrant({
        client,
        brand,
        actor: user,
        request_id,
        user_id: targetId,
        role_id,
        business,
        expires_at: input.expires_at,
        target,
      });
      granted.push(targetId);
    }
    return {
      data: {
        role_id,
        business,
        granted,
        skipped,
        granted_count: granted.length,
        skipped_count: skipped.length,
      },
    };
  });
}

async function revokeUserRole({
  brand,
  user,
  request_id,
  user_id,
  role_id,
  business,
}) {
  const role = await rolesRepo.findRole({ role_id });
  if (!role) throw new NotFoundError("Role");
  guards.assertCanRevokeRole(user, role);

  return transaction(async (client) => {
    // Never strand the system without an owner.
    if (guards.isOwnerRole(role)) {
      const holders = await grantsRepo.countActiveRoleHolders({
        client,
        role_id,
      });
      if (holders <= 1) {
        throw new ConflictError("Cannot revoke the last owner");
      }
    }
    const removed = await grantsRepo.revokeRole({
      client,
      user_id,
      role_id,
      business,
    });
    if (!removed) throw new NotFoundError("Grant");
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.revoke_role",
      target_type: "user_roles",
      target_id: user_id,
      before: { role_id, business },
      request_id,
    });
    events.emit("role_revoked", { brand, user_id, role_id });
  });
}

// ── brand access ───────────────────────────────────────────

async function getUserAccess({ user_id }) {
  const access = await grantsRepo.getUserAccess({ user_id });
  if (!access) throw new NotFoundError("User");
  return access;
}

async function setUserAccess({ brand, user, request_id, user_id, input }) {
  const before = await grantsRepo.getUserAccess({ user_id });
  if (!before) throw new NotFoundError("User");

  return transaction(async (client) => {
    if (input.permitted_businesses) {
      const brands = await grantsRepo.validBrands({ client });
      for (const b of input.permitted_businesses) {
        if (!brands.includes(b)) {
          throw new ValidationError(`Unknown business '${b}'`);
        }
      }
    }
    if (input.default_business) {
      const permitted =
        input.permitted_businesses || before.permitted_businesses || [];
      if (!permitted.includes(input.default_business)) {
        throw new ValidationError(
          "default_business must be one of permitted_businesses",
        );
      }
    }
    const after = await grantsRepo.setUserAccess({
      client,
      user_id,
      permitted_businesses: input.permitted_businesses,
      default_business: input.default_business,
    });
    await sensitiveAudit({
      business: brand,
      user_id: user.user_id,
      action_key: "access.set_user_access",
      target_type: "users",
      target_id: user_id,
      before,
      after,
      request_id,
    });
    events.emit("user_access_changed", { brand, user_id });
    return after;
  });
}

module.exports = {
  listRoles,
  getRole,
  createRole,
  updateRole,
  deleteRole,
  getCatalog,
  getRolePermissions,
  setRolePermissions,
  getRoleContactTypes,
  setRoleContactTypes,
  listUserRoles,
  listGrantableUsers,
  grantUserRole,
  grantRoleMembers,
  revokeUserRole,
  getUserAccess,
  setUserAccess,
};
