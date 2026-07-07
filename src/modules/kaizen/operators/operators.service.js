/**
 * Kaizen operators service — invite / list / disable + invite acceptance.
 *
 * No internal RBAC (every active operator is a full admin), but every mutation
 * is audit-logged and the disable path is guarded (see controller).
 */

"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");

const { config } = require("../../../config/env");
const { AppError } = require("../../../utils/errors");
const { logger } = require("../../../config/logger");
const email = require("../../../services/email.service");

const repo = require("./operators.repo");
const authRepo = require("../auth/kaizen-auth.repo");

function sha256(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

async function list() {
  return repo.listOperators();
}

function inviteEmailHtml({ displayName, inviteUrl }) {
  return `
    <div style="font-family:Montserrat,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
      <h2 style="font-family:'Playfair Display',serif">You've been invited to Kaizen</h2>
      <p>Hi ${displayName || "there"},</p>
      <p>You've been given access to <strong>Kaizen</strong> — the JBS Praxis
         maintenance &amp; monitoring console for Pixie Girl Hub.</p>
      <p>Set your password to activate your account (link valid for
         ${config.KAIZEN_INVITE_TTL_HOURS} hours):</p>
      <p><a href="${inviteUrl}"
            style="display:inline-block;padding:12px 20px;background:#a81d1d;color:#fff;
                   text-decoration:none;border-radius:8px">Set my password</a></p>
      <p style="font-size:12px;color:#666">If the button doesn't work, paste this
         link into your browser:<br>${inviteUrl}</p>
    </div>`;
}

/**
 * Invite an operator by email. Creates an 'invited' operator + a one-time
 * token, emails the set-password link, and (option 2A) returns the link in the
 * response as a copy-paste fallback for when SMTP isn't reachable.
 */
async function invite({ email: rawEmail, displayName, invitedBy, ip }) {
  const address = String(rawEmail).toLowerCase().trim();
  const existing = await repo.findByEmail(address);
  if (existing && existing.status === "active") {
    throw new AppError(
      "KAIZEN_OPERATOR_EXISTS",
      "An active operator with this email already exists",
      409,
      { user_message: "That email is already an active operator." },
    );
  }

  const operator =
    existing ||
    (await repo.createInvitedOperator({
      email: address,
      displayName: displayName || address,
      createdBy: invitedBy,
    }));

  const rawToken = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + config.KAIZEN_INVITE_TTL_HOURS * 60 * 60 * 1000,
  );
  await repo.createInvite({
    email: address,
    tokenHash: sha256(rawToken),
    invitedBy,
    expiresAt,
  });

  const inviteUrl = `${config.KAIZEN_BASE_URL.replace(/\/$/, "")}/accept-invite?token=${rawToken}`;

  let emailed = false;
  try {
    await email.send({
      to: address,
      subject: "Your Kaizen invitation",
      html: inviteEmailHtml({ displayName: operator.display_name, inviteUrl }),
      text: `You've been invited to Kaizen. Set your password: ${inviteUrl}`,
      brand: "pixiegirl",
    });
    emailed = true;
  } catch (err) {
    // SMTP not reachable — not fatal. The caller still gets the link to share.
    logger.warn({ err: err.message }, "kaizen invite email failed to send");
  }

  await authRepo.writeAudit({
    operatorId: invitedBy,
    action: "operator.invite",
    targetType: "operator",
    targetId: operator.operator_id,
    metadata: { email: address, emailed },
    ip,
  });

  return {
    operator_id: operator.operator_id,
    email: address,
    emailed,
    invite_url: inviteUrl, // copy-paste fallback (2A)
    expires_at: expiresAt.toISOString(),
  };
}

/** Accept an invite: verify token, set password, activate. */
async function acceptInvite({ token, password }) {
  const invite = await repo.findLiveInviteByTokenHash(sha256(token));
  if (!invite) {
    throw new AppError(
      "KAIZEN_INVALID_INVITE",
      "Invite is invalid or expired",
      400,
      { user_message: "This invitation link is invalid or has expired." },
    );
  }
  const operator = await repo.findByEmail(invite.email);
  if (!operator) {
    throw new AppError("KAIZEN_INVALID_INVITE", "Operator not found", 400);
  }
  const hash = await argon2.hash(password);
  await authRepo.updatePassword(operator.operator_id, hash); // sets active + clears must_change
  await repo.markInviteAccepted(invite.invite_id);
  await authRepo.writeAudit({
    operatorId: operator.operator_id,
    action: "operator.accept_invite",
    targetType: "operator",
    targetId: operator.operator_id,
  });
  return { operator_id: operator.operator_id, email: operator.email };
}

/** Disable an operator (guarded at controller). Revokes their sessions. */
async function disable({ operatorId, actorId, ip }) {
  if (operatorId === actorId) {
    throw new AppError(
      "KAIZEN_CANNOT_DISABLE_SELF",
      "You cannot disable your own account",
      400,
      { user_message: "You cannot disable your own account." },
    );
  }
  const activeCount = await repo.countActive();
  if (activeCount <= 1) {
    throw new AppError(
      "KAIZEN_LAST_OPERATOR",
      "Cannot disable the last active operator",
      400,
      { user_message: "You can't disable the last active operator." },
    );
  }
  const updated = await repo.setStatus(operatorId, "disabled");
  if (!updated) throw new AppError("NOT_FOUND", "Operator not found", 404);
  await authRepo.revokeAllSessions(operatorId);
  await authRepo.writeAudit({
    operatorId: actorId,
    action: "operator.disable",
    targetType: "operator",
    targetId: operatorId,
    ip,
  });
  return updated;
}

module.exports = { list, invite, acceptInvite, disable, sha256 };
