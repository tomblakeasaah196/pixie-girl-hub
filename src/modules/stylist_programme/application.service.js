/**
 * Stylist Partner Programme (V2.2 §6.26) — application & vetting (Q5–Q8).
 *
 * Public flow: the landing-page form posts profile + socials + questionnaire
 * answers + ID/business docs → contact + stylist_partners row (status
 * 'applicant') + responses. Admin flow: rubric-scored vetting reviews, then an
 * EXPLICIT human decision — auto-approval is never used (§6.26). Approval sets
 * probation (Q7), sends the contract for e-signature (Q10) and invites the
 * partner into the portal.
 */

"use strict";

const crypto = require("crypto");
const argon2 = require("argon2");
const { hashOptions } = require("../../utils/password");
const repo = require("./stylist.repo");
const programmeRepo = require("./programme.repo");
const events = require("./stylist.events");
const notify = require("./stylist.notify");
const documents = require("../../shared/documents/documents.service");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError, ValidationError } = require("../../utils/errors");

const BRAND = notify.BRAND;

const code = (prefix) =>
  `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

const A = (user, action_key, target_type, target_id, after, request_id) =>
  audit({
    business: BRAND,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

// ── Public: questionnaire ─────────────────────────────────
async function getPublicQuestions() {
  const questions = await programmeRepo.listQuestions({ active_only: true });
  return questions.map((q) => ({
    question_id: q.question_id,
    question: q.question,
    help_text: q.help_text,
    field_type: q.field_type,
    options: q.options,
    is_required: q.is_required,
    display_order: q.display_order,
  }));
}

// ── Public: apply ─────────────────────────────────────────
/**
 * files: { id_doc?: {buffer, originalname, mimetype},
 *          business_doc?: {buffer, originalname, mimetype} }
 */
async function apply({ input, files = {}, request_id }) {
  const cfg = await programmeRepo.getConfig({ business: BRAND });
  if (cfg && cfg.applications_open === false)
    throw new AppError(
      "APPLICATIONS_CLOSED",
      "Applications are currently closed — please check back soon.",
      403,
    );

  // Required questions must all be answered.
  const questions = await programmeRepo.listQuestions({ active_only: true });
  const answers = input.answers || [];
  const byQuestion = new Map(answers.map((a) => [a.question_id, a.answer]));
  for (const q of questions) {
    if (!q.is_required) continue;
    const a = byQuestion.get(q.question_id);
    if (a === undefined || a === null || a === "")
      throw new ValidationError(`Please answer: ${q.question}`);
  }

  return transaction(async (client) => {
    let contact = await programmeRepo.findContactByEmailOrPhone({
      client,
      email: input.email,
      phone: input.phone,
    });
    if (contact) {
      const existing = await repo.findPartnerByContact({
        client,
        contact_id: contact.contact_id,
      });
      if (existing)
        throw new AppError(
          "ALREADY_APPLIED",
          "An application or partnership already exists for this email/phone.",
          409,
        );
      await programmeRepo.tagContactAsStylist({
        client,
        contact_id: contact.contact_id,
      });
    } else {
      contact = await programmeRepo.createContact({
        client,
        brand: BRAND,
        contact: {
          display_name: input.display_name,
          first_name: input.first_name,
          last_name: input.last_name,
          primary_phone: input.phone,
          whatsapp_number: input.whatsapp_number,
          email: input.email,
        },
      });
    }

    const partner = await repo.createPartner({
      client,
      p: {
        partner_code: code("PXS"),
        contact_id: contact.contact_id,
        display_name: input.display_name,
        country_code: input.country_code,
        city: input.city,
        state: input.state,
        latitude: input.latitude,
        longitude: input.longitude,
        bio: input.bio,
        portfolio_url: input.portfolio_url,
      },
    });

    // Socials + application docs land via the generic column-patcher.
    const patch = {
      instagram_url: input.instagram_url || null,
      youtube_url: input.youtube_url || null,
      website_url: input.website_url || null,
    };
    const store = async (file, docType, title) => {
      if (!file || !file.buffer) return null;
      const doc = await documents.store({
        brand: BRAND,
        buffer: file.buffer,
        filename: file.originalname,
        mime_type: file.mimetype,
        document_type: docType,
        title,
        reference_type: "stylist_partner",
        reference_id: partner.stylist_id,
        client,
        request_id,
      });
      return doc.document_id;
    };
    patch.id_document_id = await store(
      files.id_doc,
      "stylist_id_verification",
      `${input.display_name} — ID verification`,
    );
    patch.business_document_id = await store(
      files.business_doc,
      "stylist_business_verification",
      `${input.display_name} — business verification`,
    );
    await repo.updatePartner({ client, id: partner.stylist_id, patch });

    for (const a of answers) {
      // Unknown/inactive question ids are silently dropped (stale form).
      if (!questions.some((q) => q.question_id === a.question_id)) continue;
      await programmeRepo.insertResponse({
        client,
        stylist_id: partner.stylist_id,
        question_id: a.question_id,
        answer: a.answer,
      });
    }

    await A(
      null,
      "stylist.application.received",
      "stylist_partner",
      partner.stylist_id,
      { partner_code: partner.partner_code },
      request_id,
    );
    events.emit("application.received", {
      stylist_id: partner.stylist_id,
      partner_code: partner.partner_code,
      city: input.city,
      country_code: input.country_code,
    });
    if (input.email)
      notify.emailAddress({
        to: input.email,
        subject: "We received your Pixie Girl Partner application",
        bodyHtml: `<p>Hi ${input.first_name || input.display_name},</p>
          <p>Thank you for applying to the Pixie Girl Global Stylist Partner
          Programme. Our team reviews every application personally — portfolio,
          verification and brand fit. You will hear from us once your review is
          complete.</p>
          <p>Your application reference: <strong>${partner.partner_code}</strong></p>`,
      });
    return {
      stylist_id: partner.stylist_id,
      partner_code: partner.partner_code,
      status: partner.status,
    };
  });
}

// ── Admin: vetting queue ──────────────────────────────────
async function listApplications({ status }) {
  const statuses = status ? [status] : ["applicant", "vetting"];
  const out = [];
  for (const s of statuses) {
    const partners = await repo.listPartners({ status: s });
    out.push(...partners);
  }
  // Attach the latest review score per applicant for the queue table.
  for (const p of out) {
    const reviews = await programmeRepo.listVettingReviews({
      stylist_id: p.stylist_id,
    });
    p.review_count = reviews.length;
    p.latest_review = reviews[0] || null;
  }
  return out.sort(
    (a, b) => new Date(a.application_received_at) - new Date(b.application_received_at),
  );
}

async function getApplication({ id }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Application");
  const [responses, reviews, specialities] = await Promise.all([
    programmeRepo.listResponses({ stylist_id: id }),
    programmeRepo.listVettingReviews({ stylist_id: id }),
    repo.listSpecialities({ stylist_id: id }),
  ]);
  return { ...partner, responses, reviews, specialities };
}

// ── Admin: rubric review ──────────────────────────────────
async function addVettingReview({ user, request_id, id, input }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Application");
  if (!["applicant", "vetting"].includes(partner.status))
    throw new AppError(
      "BAD_STATE",
      `Cannot review a partner in status '${partner.status}'`,
      422,
    );
  const total = input.rubric.reduce((s, r) => s + Number(r.score || 0), 0);
  const review = await programmeRepo.addVettingReview({
    r: {
      stylist_id: id,
      reviewer_user_id: user.user_id,
      rubric: input.rubric,
      total_score: total,
      recommendation: input.recommendation,
      notes: input.notes,
    },
  });
  await A(
    user,
    "stylist.vetting.review",
    "stylist_partner",
    id,
    { total_score: total, recommendation: input.recommendation },
    request_id,
  );
  return review;
}

// ── Admin: explicit decision (never automated) ────────────
async function decide({ user, request_id, id, input }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Application");

  if (input.decision === "start_vetting") {
    if (partner.status !== "applicant")
      throw new AppError("BAD_STATE", `Partner is '${partner.status}'`, 422);
    const updated = await repo.setPartnerStatus({
      id,
      status: "vetting",
      fields: { vetting_decision_note: input.note || null },
    });
    await A(user, "stylist.vetting.start", "stylist_partner", id, null, request_id);
    events.emit("application.decided", { stylist_id: id, decision: "start_vetting" });
    return updated;
  }

  if (input.decision === "reject") {
    if (!["applicant", "vetting"].includes(partner.status))
      throw new AppError("BAD_STATE", `Partner is '${partner.status}'`, 422);
    const updated = await repo.setPartnerStatus({
      id,
      status: "terminated",
      fields: {
        terminated_at: new Date().toISOString(),
        terminated_reason: input.note || "Application rejected",
        vetting_decision_note: input.note || null,
      },
    });
    await A(user, "stylist.vetting.reject", "stylist_partner", id, { note: input.note }, request_id);
    events.emit("application.decided", { stylist_id: id, decision: "reject" });
    const contact = await getContactEmail(partner.contact_id);
    if (contact && contact.email)
      notify.emailAddress({
        to: contact.email,
        subject: "Your Pixie Girl Partner application",
        bodyHtml: `<p>Thank you for your interest in the Stylist Partner
          Programme. After careful review we are unable to move forward at this
          time. You are welcome to re-apply as your portfolio grows.</p>`,
      });
    return updated;
  }

  if (input.decision === "approve") {
    if (!["applicant", "vetting"].includes(partner.status))
      throw new AppError("BAD_STATE", `Partner is '${partner.status}'`, 422);
    const months = input.probation_months === undefined ? 3 : input.probation_months;
    const probationEnds = months
      ? new Date(Date.now() + months * 30 * 86_400_000).toISOString()
      : null;
    const updated = await repo.setPartnerStatus({
      id,
      status: "vetted",
      fields: {
        vetted_at: new Date().toISOString(),
        vetted_by: user.user_id,
        probation_ends_at: probationEnds,
        vetting_decision_note: input.note || null,
      },
    });
    await A(
      user,
      "stylist.vetting.approve",
      "stylist_partner",
      id,
      { probation_ends_at: probationEnds },
      request_id,
    );
    events.emit("application.decided", { stylist_id: id, decision: "approve" });

    // Contract + portal invite ride behind the decision, best-effort — a
    // template or mail hiccup must never roll back the approval itself.
    const { logger } = require("../../config/logger");
    const contract = require("./contract.service");
    contract
      .generateAndSend({ user, request_id, stylist_id: id })
      .catch((err) =>
        logger.warn(
          { err: err.message, stylist_id: id },
          "stylist: contract generation after approval failed — resend via POST /:id/contract",
        ),
      );
    await invite({ user, request_id, id }).catch((err) =>
      logger.warn(
        { err: err.message, stylist_id: id },
        "stylist: portal invite after approval failed — resend via POST /:id/invite",
      ),
    );
    return updated;
  }

  throw new ValidationError(`Unknown decision '${input.decision}'`);
}

// ── Admin: portal invite (tokenised set-password) ─────────
async function invite({ user, request_id, id }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Stylist");

  // The partner's email comes from their contact record.
  const contact = await getContactEmail(partner.contact_id);
  if (!contact || !contact.email)
    throw new AppError("NO_EMAIL", "Partner has no email on their contact record", 422);

  let cred = await programmeRepo.findCredentialByStylist({ stylist_id: id });
  if (!cred) {
    // Placeholder hash — login is impossible until the invite link sets a
    // real password (force_password_reset defaults true).
    const placeholder = await argon2.hash(
      crypto.randomBytes(32).toString("hex"),
      hashOptions,
    );
    cred = await repo.createCredential({
      c: { stylist_id: id, email: contact.email, password_hash: placeholder },
    });
  }
  const token = crypto.randomBytes(32).toString("base64url");
  await programmeRepo.setResetToken({
    stylist_id: id,
    token,
    expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    invited: true,
  });
  await notify.emailAddress({
    to: contact.email,
    subject: "Welcome to the Pixie Girl Stylist Partner Programme",
    bodyHtml: `<p>Congratulations, ${partner.display_name}!</p>
      <p>Your application has been approved. Set your password to access your
      partner dashboard — offers, bookings, earnings and your verified badge
      all live there.</p>`,
    ctaLabel: "Set your password",
    ctaPath: `/set-password?token=${token}`,
  });
  await A(user, "stylist.invite", "stylist_partner", id, null, request_id);
  return { invited: true, email: contact.email };
}

async function getContactEmail(contact_id) {
  const { query } = require("../../config/database");
  const { rows } = await query(
    `SELECT email, display_name FROM shared.contacts WHERE contact_id = $1`,
    [contact_id],
  );
  return rows[0] || null;
}

// ── Portal: password rail (forgot + set) ──────────────────
async function forgotPassword({ email }) {
  // Always succeed (no account enumeration). Only active credentials get mail.
  const cred = await repo.findCredentialByEmail({ email: email.toLowerCase() });
  if (!cred || !cred.is_active) return { ok: true };
  const token = crypto.randomBytes(32).toString("base64url");
  await programmeRepo.setResetToken({
    stylist_id: cred.stylist_id,
    token,
    expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    invited: false,
  });
  await notify.emailAddress({
    to: cred.email,
    subject: "Reset your Pixie Girl partner password",
    bodyHtml: `<p>We received a request to reset your partner portal password.
      This link is valid for 2 hours. If you didn't request it, ignore this
      email.</p>`,
    ctaLabel: "Reset password",
    ctaPath: `/set-password?token=${token}`,
  });
  return { ok: true };
}

async function resetPassword({ token, password }) {
  const cred = await programmeRepo.findCredentialByResetToken({ token });
  if (!cred)
    throw new AppError("INVALID_TOKEN", "This link is invalid or has expired", 400);
  const password_hash = await argon2.hash(password, hashOptions);
  await programmeRepo.resetPassword({
    credential_id: cred.credential_id,
    password_hash,
  });
  await audit({
    business: BRAND,
    user_id: null,
    action_key: "stylist.password.reset",
    target_type: "stylist_credential",
    target_id: cred.credential_id,
  });
  return { ok: true };
}

module.exports = {
  getPublicQuestions,
  apply,
  listApplications,
  getApplication,
  addVettingReview,
  decide,
  invite,
  forgotPassword,
  resetPassword,
};
