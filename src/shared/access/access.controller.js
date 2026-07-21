/**
 * Identity & Access Administration controller (V2.2 §3 — RBAC).
 * HTTP only — translates req/res to service calls.
 */

"use strict";

const service = require("./access.service");

// ── roles ──────────────────────────────────────────────────

async function listRoles(req, res) {
  res.json(await service.listRoles({ brand: req.brand }));
}

async function getRole(req, res) {
  const role = await service.getRole({
    brand: req.brand,
    role_id: req.params.role_id,
  });
  res.json({ data: role });
}

async function createRole(req, res) {
  const role = await service.createRole({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    input: req.body,
  });
  res.status(201).json({ data: role });
}

async function updateRole(req, res) {
  const role = await service.updateRole({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    role_id: req.params.role_id,
    patch: req.body,
  });
  res.json({ data: role });
}

async function deleteRole(req, res) {
  await service.deleteRole({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    role_id: req.params.role_id,
  });
  res.status(204).end();
}

// ── permission matrix ──────────────────────────────────────

async function getCatalog(_req, res) {
  res.json({ data: service.getCatalog() });
}

async function getRolePermissions(req, res) {
  res.json(await service.getRolePermissions({ role_id: req.params.role_id }));
}

async function setRolePermissions(req, res) {
  const result = await service.setRolePermissions({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    role_id: req.params.role_id,
    grants: req.body.grants,
  });
  res.json(result);
}

// ── contact-type visibility (contacts §6.12) ───────────────

async function getRoleContactTypes(req, res) {
  res.json(await service.getRoleContactTypes({ role_id: req.params.role_id }));
}

async function setRoleContactTypes(req, res) {
  const result = await service.setRoleContactTypes({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    role_id: req.params.role_id,
    contact_types: req.body.contact_types,
  });
  res.json(result);
}

// ── user-role grants ───────────────────────────────────────

async function listUserRoles(req, res) {
  res.json(await service.listUserRoles({ user_id: req.params.user_id }));
}

async function listGrantableUsers(req, res) {
  res.json(
    await service.listGrantableUsers({
      brand: req.brand,
      search: req.query.search,
    }),
  );
}

async function grantRoleMembers(req, res) {
  const result = await service.grantRoleMembers({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    role_id: req.params.role_id,
    input: req.body,
  });
  res.status(201).json(result);
}

async function grantUserRole(req, res) {
  const grant = await service.grantUserRole({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    user_id: req.params.user_id,
    input: req.body,
  });
  res.status(201).json({ data: grant });
}

async function revokeUserRole(req, res) {
  await service.revokeUserRole({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    user_id: req.params.user_id,
    role_id: req.params.role_id,
    business: req.query.business,
  });
  res.status(204).end();
}

// ── brand access ───────────────────────────────────────────

async function getUserAccess(req, res) {
  res.json({
    data: await service.getUserAccess({ user_id: req.params.user_id }),
  });
}

async function setUserAccess(req, res) {
  const access = await service.setUserAccess({
    brand: req.brand,
    user: req.user,
    request_id: req.request_id,
    user_id: req.params.user_id,
    input: req.body,
  });
  res.json({ data: access });
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
