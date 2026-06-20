/**
 * Staff invitations service (F-15 / §6.11 onboarding).
 *
 * Admin creates an invite → a single-use raw token is generated, emailed, and
 * stored only as a SHA-256 hash. The invitee accepts by setting a password,
 * which creates their shared.users login (status='active', force_password_reset
 * off), grants the invited roles per business, and marks the invite accepted.
 *
 * Brand access + is_active are maintained by the 000113 sync triggers from the
 * columns this service writes (permitted_businesses, status), so we set those
 * and let the DB keep user_business_access / is_active consistent.
 */

"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const { hashOptions } = require("../../utils/password");
const repo = require("./invitations.repo");
const events = require("./hr.events");
const email = require("../../services/email.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { logger } = require("../../config/logger");
const {
  NotFoundError,
  AppError,
  ConflictError,
} = require("../../utils/errors");

const DEFAULT_EXPIRY_DAYS = 7;

const sha256 = (raw) => crypto.createHash("sha256").update(raw).digest("hex");

function inviteLink(rawToken) {
  return `${config.APP_URL.replace(/\/$/, "")}/accept-invite?token=${rawToken}`;
}

// ── Admin ──────────────────────────────────────────────────
async function createInvitation({ user, request_id, input }) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const token_hash = sha256(rawToken);
  const days = input.expires_in_days || DEFAULT_EXPIRY_DAYS;
  const expires_at = new Date(Date.now() + days * 86400_000).toISOString();

  let invite;
  try {
    invite = await repo.createInvite({
      invite: {
        email: input.email,
        display_name: input.display_name,
        token_hash,
        role_ids: input.role_ids || [],
        business_keys: input.business_keys || [],
        default_business:
          input.default_business || (input.business_keys || [])[0] || null,
        is_ceo: input.is_ceo,
        staff_profile_id: input.staff_profile_id,
        invited_by: user ? user.user_id : null,
        expires_at,
      },
    });
  } catch (err) {
    // Partial unique index: one pending invite per email.
    if (err.code === "23505")
      throw new ConflictError(
        "A pending invitation already exists for this email",
      );
    throw err;
  }

  // Email the invite (best-effort — admin can resend if delivery fails).
  try {
    const link = inviteLink(rawToken);
    await email.send({
      to: input.email,
      subject: "You've been invited to Pixie Girl Hub",
      html: `<p>Hello${input.display_name ? " " + input.display_name : ""},</p>
             <p>You've been invited to join the team. Set your password to activate your account:</p>
             <p><a href="${link}">Accept your invitation</a></p>
             <p>This link expires in ${days} day(s). If you didn't expect this, ignore this email.</p>`,
      text: `You've been invited to Pixie Girl Hub. Accept here (expires in ${days} day(s)): ${link}`,
    });
  } catch (err) {
    logger.error(
      { err: err.message, invitation_id: invite.invitation_id },
      "invite email send failed — invitation created, admin may resend",
    );
  }

  await audit({
    business: null,
    user_id: user ? user.user_id : null,
    action_key: "hr_payroll.staff_invite.create",
    target_type: "staff_invitation",
    target_id: invite.invitation_id,
    after: { email: input.email, role_ids: input.role_ids },
    request_id,
  });
  events.emit("staff_invited", { invitation_id: invite.invitation_id });
  return safeInvite(invite);
}

const listInvitations = (args) => repo.listInvites(args);

async function revokeInvitation({ user, request_id, id }) {
  const invite = await repo.getById({ id });
  if (!invite) throw new NotFoundError("Invitation");
  if (invite.status !== "pending")
    throw new AppError(
      "INVITE_NOT_PENDING",
      `Cannot revoke a ${invite.status} invitation`,
      409,
    );
  const updated = await repo.setStatus({ id, status: "revoked" });
  await audit({
    business: null,
    user_id: user ? user.user_id : null,
    action_key: "hr_payroll.staff_invite.revoke",
    target_type: "staff_invitation",
    target_id: id,
    request_id,
  });
  return safeInvite(updated);
}

// ── Public (accept) ────────────────────────────────────────
async function getByToken({ token }) {
  if (!token) throw new NotFoundError("Invitation");
  const invite = await repo.getByTokenHash({ token_hash: sha256(token) });
  if (!invite || invite.status !== "pending")
    throw new NotFoundError("Invitation");
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await repo.setStatus({ id: invite.invitation_id, status: "expired" });
    throw new AppError("INVITE_EXPIRED", "This invitation has expired", 410);
  }
  return {
    email: invite.email,
    display_name: invite.display_name,
    expires_at: invite.expires_at,
  };
}

async function acceptInvitation({ token, password, display_name }) {
  if (!token) throw new NotFoundError("Invitation");
  const token_hash = sha256(token);
  const password_hash = await argon2.hash(password, hashOptions);

  return transaction(async (client) => {
    const invite = await repo.getByTokenHash({ client, token_hash });
    if (!invite || invite.status !== "pending")
      throw new NotFoundError("Invitation");
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      await repo.setStatus({
        client,
        id: invite.invitation_id,
        status: "expired",
      });
      throw new AppError("INVITE_EXPIRED", "This invitation has expired", 410);
    }
    if (await repo.userExistsByEmail({ client, email: invite.email }))
      throw new ConflictError("An account with this email already exists");

    const newUser = await repo.createUser({
      client,
      user: {
        email: invite.email,
        password_hash,
        display_name: display_name || invite.display_name,
        is_ceo: invite.is_ceo,
        default_business: invite.default_business,
        permitted_businesses: invite.business_keys || [],
      },
    });

    // Grant each invited role under each invited business (fallback: all '*').
    const businesses =
      invite.business_keys && invite.business_keys.length
        ? invite.business_keys
        : ["*"];
    for (const role_id of invite.role_ids || []) {
      for (const business of businesses) {
        await repo.assignRole({
          client,
          user_id: newUser.user_id,
          role_id,
          business,
          granted_by: invite.invited_by,
        });
      }
    }

    await repo.setStatus({
      client,
      id: invite.invitation_id,
      status: "accepted",
      fields: {
        accepted_at: new Date().toISOString(),
        accepted_user_id: newUser.user_id,
      },
    });

    await audit({
      business: null,
      user_id: newUser.user_id,
      action_key: "hr_payroll.staff_invite.accept",
      target_type: "staff_invitation",
      target_id: invite.invitation_id,
      after: { user_id: newUser.user_id, email: invite.email },
      request_id: null,
    });
    events.emit("staff_invite_accepted", {
      invitation_id: invite.invitation_id,
      user_id: newUser.user_id,
    });
    return { user_id: newUser.user_id, email: newUser.email };
  });
}

function safeInvite(i) {
  if (!i) return i;
  // never expose token_hash
  const { token_hash, ...rest } = i;
  void token_hash;
  return rest;
}

// ── Instant provisioning ───────────────────────────────────
// Generate a compliant temp password: 16 chars guaranteeing an uppercase, a
// digit and a special char (auth.service.assertStrongPassword rules).
function generateTempPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const special = "!@#$%&*?";
  const all = upper + lower + digit + special;
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(upper), pick(digit), pick(special)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed chars aren't always leading.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/**
 * Provision a Hub login immediately (no email round-trip): create the user with
 * a generated temporary password (force_password_reset = true), grant the
 * requested roles per business, and return the plaintext password exactly once
 * so the admin can hand it to the new hire.
 */
async function provisionLogin({ user, request_id, input }) {
  const emailAddr = String(input.email || "").trim();
  if (!emailAddr) throw new AppError("EMAIL_REQUIRED", "Email is required", 422);

  const temp_password = generateTempPassword();
  const password_hash = await argon2.hash(temp_password, hashOptions);
  const businessKeys = input.business_keys || [];

  const created = await transaction(async (client) => {
    if (await repo.userExistsByEmail({ client, email: emailAddr }))
      throw new ConflictError("An account with this email already exists");

    const newUser = await repo.createUser({
      client,
      user: {
        email: emailAddr,
        password_hash,
        display_name: input.display_name || null,
        is_ceo: input.is_ceo || false,
        default_business: input.default_business || businessKeys[0] || null,
        permitted_businesses: businessKeys,
        force_password_reset: true,
        staff_profile_id: input.staff_profile_id || null,
      },
    });

    const businesses = businessKeys.length ? businessKeys : ["*"];
    for (const role_id of input.role_ids || []) {
      for (const business of businesses) {
        await repo.assignRole({
          client,
          user_id: newUser.user_id,
          role_id,
          business,
          granted_by: user ? user.user_id : null,
        });
      }
    }

    await audit({
      business: null,
      user_id: user ? user.user_id : newUser.user_id,
      action_key: "hr_payroll.staff_login.provision",
      target_type: "users",
      target_id: newUser.user_id,
      after: { user_id: newUser.user_id, email: emailAddr },
      request_id,
      is_sensitive: true,
    });
    return newUser;
  });

  events.emit("staff_login_provisioned", {
    user_id: created.user_id,
    email: emailAddr,
  });

  // Plaintext password returned ONCE — never stored or logged.
  return { email: created.email, temp_password, force_password_reset: true };
}

module.exports = {
  createInvitation,
  listInvitations,
  revokeInvitation,
  getByToken,
  acceptInvitation,
  provisionLogin,
};
