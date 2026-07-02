/**
 * Stylist Partner Programme (V2.2 §6.26) — business logic.
 *
 * External stylist partners with their own portal login (separate from staff),
 * tiered certifications, an offer-pool assignment router, and Pixie-managed
 * payout batches. System connections:
 *   - a production service_job (§6.24) opens an assignment; on acceptance the
 *     stylist is written back onto service_jobs.assigned_stylist_id.
 *   - completed assignments roll into a payout batch.
 */

"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const argon2 = require("argon2");
const { hashOptions } = require("../../utils/password");
const repo = require("./stylist.repo");
const events = require("./stylist.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");
const { logger } = require("../../config/logger");

const A = (
  brand,
  user,
  action_key,
  target_type,
  target_id,
  after,
  request_id,
) =>
  audit({
    business: brand || null,
    user_id: user ? user.user_id : null,
    action_key,
    target_type,
    target_id,
    after,
    request_id,
  });

const code = (prefix) =>
  `${prefix}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

// ════════════════════════════════════════════════════════════
// Partners — lifecycle
// ════════════════════════════════════════════════════════════
function listPartners(args) {
  return repo.listPartners(args);
}
async function getPartner({ id }) {
  const p = await repo.findPartner({ id });
  if (!p) throw new NotFoundError("Stylist");
  const [specialities, certifications] = await Promise.all([
    repo.listSpecialities({ stylist_id: id }),
    repo.listCertifications({ stylist_id: id }),
  ]);
  return { ...p, specialities, certifications };
}

/** Onboard a partner (already a contact) + optional portal credential. */
async function createPartner({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const existing = await repo.findPartnerByContact({
      client,
      contact_id: input.contact_id,
    });
    if (existing)
      throw new AppError(
        "ALREADY_PARTNER",
        "Contact is already a stylist partner",
        409,
      );
    const partner = await repo.createPartner({
      client,
      p: { ...input, partner_code: code("PXS") },
    });
    if (input.login_email && input.login_password) {
      const password_hash = await argon2.hash(
        input.login_password,
        hashOptions,
      );
      await repo.createCredential({
        client,
        c: {
          stylist_id: partner.stylist_id,
          email: input.login_email.toLowerCase(),
          password_hash,
        },
      });
    }
    await A(
      brand,
      user,
      "stylist.partner.create",
      "stylist_partner",
      partner.stylist_id,
      { partner_code: partner.partner_code },
      request_id,
    );
    events.emit("partner.created", { stylist_id: partner.stylist_id });
    return partner;
  });
}
async function updatePartner({ brand, user, request_id, id, patch }) {
  const before = await repo.findPartner({ id });
  if (!before) throw new NotFoundError("Stylist");
  const updated = await repo.updatePartner({ id, patch });
  await A(
    brand,
    user,
    "stylist.partner.update",
    "stylist_partner",
    id,
    updated,
    request_id,
  );
  return updated;
}
async function setStatus({ brand, user, request_id, id, status, reason }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Stylist");
  const fields = {};
  if (status === "vetted") {
    fields.vetted_at = new Date().toISOString();
    fields.vetted_by = user.user_id;
  } else if (status === "suspended") {
    fields.suspended_at = new Date().toISOString();
    fields.suspended_reason = reason || null;
  } else if (status === "terminated") {
    fields.terminated_at = new Date().toISOString();
    fields.terminated_reason = reason || null;
  }
  const updated = await repo.setPartnerStatus({ id, status, fields });
  await A(
    brand,
    user,
    "stylist.partner.status",
    "stylist_partner",
    id,
    { status },
    request_id,
  );
  events.emit("partner.status_changed", { stylist_id: id, status });
  return updated;
}

// ── Badge (public verification) ───────────────────────────
async function issueBadge({ brand, user, request_id, id }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Stylist");
  const token = crypto.randomBytes(16).toString("hex");
  const updated = await repo.setBadge({
    id,
    badge_token: token,
    revoked: false,
  });
  await A(
    brand,
    user,
    "stylist.badge.issue",
    "stylist_partner",
    id,
    null,
    request_id,
  );
  return updated;
}
async function revokeBadge({ brand, user, request_id, id }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Stylist");
  const updated = await repo.setBadge({
    id,
    badge_token: partner.badge_token,
    revoked: true,
  });
  await A(
    brand,
    user,
    "stylist.badge.revoke",
    "stylist_partner",
    id,
    null,
    request_id,
  );
  return updated;
}
async function verifyBadge({ token }) {
  const partner = await repo.findPartnerByBadge({ token });
  if (!partner || partner.badge_revoked_at) return { valid: false };
  const certified =
    partner.status === "certified" || partner.status === "vetted";
  return {
    valid: certified,
    partner_code: partner.partner_code,
    display_name: partner.display_name,
    status: partner.status,
    city: partner.city,
    country_code: partner.country_code,
    current_tier: partner.current_tier_key,
    tier_expires_at: partner.current_tier_expires_at,
    portfolio_url: partner.portfolio_url,
  };
}

// ════════════════════════════════════════════════════════════
// Specialities
// ════════════════════════════════════════════════════════════
function listSpecialities({ id, brand }) {
  return repo.listSpecialities({ stylist_id: id, business: brand });
}
async function setSpeciality({ brand, user, request_id, id, input }) {
  const partner = await repo.findPartner({ id });
  if (!partner) throw new NotFoundError("Stylist");
  const sp = await repo.upsertSpeciality({
    s: { ...input, stylist_id: id, business: brand },
  });
  await A(
    brand,
    user,
    "stylist.speciality.set",
    "stylist_speciality",
    sp.speciality_id,
    { service_key: sp.service_key },
    request_id,
  );
  return sp;
}
async function removeSpeciality({ brand, user, request_id, speciality_id }) {
  const ok = await repo.deactivateSpeciality({ id: speciality_id });
  if (!ok) throw new NotFoundError("Speciality");
  await A(
    brand,
    user,
    "stylist.speciality.remove",
    "stylist_speciality",
    speciality_id,
    null,
    request_id,
  );
}

// ════════════════════════════════════════════════════════════
// Certifications (drives partner current_tier)
// ════════════════════════════════════════════════════════════
function listCertifications({ id }) {
  return repo.listCertifications({ stylist_id: id });
}
async function awardCertification({ brand, user, request_id, id, input }) {
  return transaction(async (client) => {
    const partner = await repo.findPartner({ client, id });
    if (!partner) throw new NotFoundError("Stylist");
    await repo.supersedeCurrentCerts({ client, stylist_id: id });
    const cert = await repo.addCertification({
      client,
      c: { ...input, stylist_id: id, awarded_by: user.user_id },
    });
    await repo.setCurrentTier({
      client,
      id,
      tier_key: cert.tier_key,
      expires_at: cert.expires_at,
    });
    // First certification moves an applicant/vetted partner to 'certified'.
    if (partner.status !== "certified")
      await repo.setPartnerStatus({
        client,
        id,
        status: "certified",
        fields: {},
      });
    await A(
      brand,
      user,
      "stylist.cert.award",
      "stylist_certification",
      cert.certification_id,
      { tier_key: cert.tier_key },
      request_id,
    );
    events.emit("certification.awarded", {
      stylist_id: id,
      tier_key: cert.tier_key,
    });
    return cert;
  });
}
async function revokeCertification({
  brand,
  user,
  request_id,
  certification_id,
  reason,
}) {
  const cert = await repo.revokeCertification({
    id: certification_id,
    revoked_by: user.user_id,
    reason,
  });
  if (!cert) throw new NotFoundError("Certification");
  await A(
    brand,
    user,
    "stylist.cert.revoke",
    "stylist_certification",
    certification_id,
    { reason },
    request_id,
  );
  return cert;
}

// ════════════════════════════════════════════════════════════
// Assignments (offer-pool router)
// ════════════════════════════════════════════════════════════
function listAssignments(args) {
  return repo.listAssignments(args);
}
async function getAssignment({ id }) {
  const a = await repo.findAssignment({ id });
  if (!a) throw new NotFoundError("Assignment");
  const offers = await repo.listOffersForAssignment({ assignment_id: id });
  return { ...a, offers };
}

/**
 * Open an assignment and offer it to candidate stylists. Subscribers call this
 * best-effort (they wrap it in their own try/catch) to route a service_job.
 */
async function openAssignment({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const offerExpires =
      input.offer_expires_at ||
      new Date(
        Date.now() + (input.offer_window_hours || 24) * 3600 * 1000,
      ).toISOString();
    const assignment = await repo.createAssignment({
      client,
      a: {
        assignment_number: code("PXS-ASN"),
        business: brand,
        customer_contact_id: input.customer_contact_id,
        reference_type: input.reference_type,
        reference_id: input.reference_id,
        service_key: input.service_key,
        offer_expires_at: offerExpires,
        base_rate: input.base_rate,
        platform_fee_pct: input.platform_fee_pct,
        payout_currency: input.payout_currency,
        scheduled_at: input.scheduled_at,
        service_address: input.service_address,
      },
    });
    const candidates = input.candidate_stylist_ids || [];
    for (const sid of candidates)
      await repo.createOffer({
        client,
        assignment_id: assignment.assignment_id,
        stylist_id: sid,
      });
    await A(
      brand,
      user,
      "stylist.assignment.open",
      "stylist_assignment",
      assignment.assignment_id,
      { candidates: candidates.length },
      request_id,
    );
    events.emit("assignment.opened", {
      assignment_id: assignment.assignment_id,
      business: brand,
      candidates: candidates.length,
    });
    return { ...assignment, offered_to: candidates.length };
  });
}

/** A stylist accepts an offer — first to accept wins. */
async function acceptOffer({ stylist_id, request_id, assignment_id }) {
  return transaction(async (client) => {
    const assignment = await repo.findAssignment({ client, id: assignment_id });
    if (!assignment) throw new NotFoundError("Assignment");
    if (assignment.status !== "offered_pool")
      throw new AppError(
        "ALREADY_TAKEN",
        "This assignment is no longer open",
        409,
      );
    const offer = await repo.findOffer({ client, assignment_id, stylist_id });
    if (!offer || offer.response !== "pending")
      throw new AppError("NO_OFFER", "No open offer for this stylist", 409);

    const partner = await repo.findPartner({ client, id: stylist_id });
    if (!partner) throw new NotFoundError("Stylist");
    if (partner.current_active_count >= partner.max_active_assignments)
      throw new AppError(
        "AT_CAPACITY",
        "Stylist is at maximum active assignments",
        422,
      );

    // Payout snapshot: speciality rate (or assignment base_rate) × tier multiplier.
    const speciality = await repo.findSpeciality({
      client,
      stylist_id,
      business: assignment.business,
      service_key: assignment.service_key,
    });
    const baseRate = money(
      assignment.base_rate !== null && assignment.base_rate !== undefined
        ? assignment.base_rate
        : speciality
          ? speciality.rate
          : 0,
    );
    const tierMultiplier = money(assignment.tier_multiplier || 1);
    const gross = baseRate.times(tierMultiplier);
    const feePct = money(assignment.platform_fee_pct || 0).dividedBy(100);
    const net = gross.times(money(1).minus(feePct));

    await repo.respondOffer({
      client,
      assignment_id,
      stylist_id,
      response: "accepted",
    });
    await repo.supersedeOtherOffers({
      client,
      assignment_id,
      winner_stylist_id: stylist_id,
    });
    const updated = await repo.setAssignmentStatus({
      client,
      id: assignment_id,
      status: "accepted",
      fields: {
        stylist_id,
        accepted_at: new Date().toISOString(),
        base_rate: toCurrencyString(baseRate),
        gross_payout: toCurrencyString(gross),
        net_payout: toCurrencyString(net),
        payout_currency:
          assignment.payout_currency || partner.payout_currency || "NGN",
      },
    });
    await repo.bumpActiveCount({ client, id: stylist_id, delta: 1 });

    // System write-back: a service_booking assignment stamps the service_job.
    if (assignment.reference_type === "service_booking") {
      try {
        await repo.linkServiceJobStylist({
          client,
          brand: assignment.business,
          job_id: assignment.reference_id,
          stylist_id,
        });
      } catch {
        // job may not exist in this brand schema; assignment still stands.
      }
    }
    await A(
      assignment.business,
      { user_id: stylist_id },
      "stylist.assignment.accept",
      "stylist_assignment",
      assignment_id,
      null,
      request_id,
    );
    events.emit("assignment.accepted", {
      assignment_id,
      stylist_id,
      business: assignment.business,
    });
    return updated;
  });
}

async function declineOffer({ stylist_id, assignment_id, reason }) {
  const offer = await repo.findOffer({ assignment_id, stylist_id });
  if (!offer || offer.response !== "pending")
    throw new AppError("NO_OFFER", "No open offer for this stylist", 409);
  await repo.respondOffer({
    assignment_id,
    stylist_id,
    response: "declined",
    decline_reason: reason,
  });
  events.emit("assignment.declined", { assignment_id, stylist_id });
  return { assignment_id, stylist_id, response: "declined" };
}
async function startAssignment({ stylist_id, assignment_id }) {
  const a = await repo.findAssignment({ id: assignment_id });
  if (!a) throw new NotFoundError("Assignment");
  if (a.stylist_id !== stylist_id)
    throw new AppError("NOT_YOURS", "Not your assignment", 403);
  if (a.status !== "accepted")
    throw new AppError("BAD_STATE", `Assignment is ${a.status}`, 422);
  return repo.setAssignmentStatus({
    id: assignment_id,
    status: "in_progress",
    fields: { started_at: new Date().toISOString() },
  });
}
async function completeAssignment({ stylist_id, assignment_id }) {
  return transaction(async (client) => {
    const a = await repo.findAssignment({ client, id: assignment_id });
    if (!a) throw new NotFoundError("Assignment");
    if (a.stylist_id !== stylist_id)
      throw new AppError("NOT_YOURS", "Not your assignment", 403);
    if (a.status !== "in_progress" && a.status !== "accepted")
      throw new AppError("BAD_STATE", `Assignment is ${a.status}`, 422);
    const updated = await repo.setAssignmentStatus({
      client,
      id: assignment_id,
      status: "completed",
      fields: { completed_at: new Date().toISOString() },
    });
    await repo.bumpActiveCount({ client, id: stylist_id, delta: -1 });
    events.emit("assignment.completed", {
      assignment_id,
      stylist_id,
      business: a.business,
    });
    return updated;
  });
}
async function cancelAssignment({
  brand,
  user,
  request_id,
  assignment_id,
  reason,
}) {
  return transaction(async (client) => {
    const a = await repo.findAssignment({ client, id: assignment_id });
    if (!a) throw new NotFoundError("Assignment");
    if (a.status === "completed")
      throw new AppError(
        "BAD_STATE",
        "Cannot cancel a completed assignment",
        422,
      );
    const updated = await repo.setAssignmentStatus({
      client,
      id: assignment_id,
      status: "cancelled",
      fields: {
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason || null,
      },
    });
    if (a.stylist_id && (a.status === "accepted" || a.status === "in_progress"))
      await repo.bumpActiveCount({ client, id: a.stylist_id, delta: -1 });
    await A(
      brand,
      user,
      "stylist.assignment.cancel",
      "stylist_assignment",
      assignment_id,
      { reason },
      request_id,
    );
    return updated;
  });
}
async function rateAssignment({
  brand,
  user,
  request_id,
  assignment_id,
  rating,
  review,
}) {
  const a = await repo.findAssignment({ id: assignment_id });
  if (!a) throw new NotFoundError("Assignment");
  const updated = await repo.setAssignmentStatus({
    id: assignment_id,
    status: a.status,
    fields: {
      customer_rating: rating,
      customer_review: review || null,
      reviewed_at: new Date().toISOString(),
    },
  });
  await A(
    brand,
    user,
    "stylist.assignment.rate",
    "stylist_assignment",
    assignment_id,
    { rating },
    request_id,
  );
  return updated;
}

// ════════════════════════════════════════════════════════════
// Payouts
// ════════════════════════════════════════════════════════════
function listPayouts(args) {
  return repo.listPayouts(args);
}
async function getPayout({ id }) {
  const p = await repo.findPayout({ id });
  if (!p) throw new NotFoundError("Payout");
  return p;
}
/** Build a draft payout from a stylist's completed, unpaid assignments. */
async function generatePayout({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const partner = await repo.findPartner({ client, id: input.stylist_id });
    if (!partner) throw new NotFoundError("Stylist");
    const assignments = await repo.completedUnpaidAssignments({
      client,
      stylist_id: input.stylist_id,
      period_start: input.period_start,
      period_end: input.period_end,
    });
    if (!assignments.length)
      throw new AppError(
        "NOTHING_TO_PAY",
        "No completed unpaid assignments in period",
        422,
      );

    let gross = money(0);
    let fee = money(0);
    let net = money(0);
    for (const a of assignments) {
      gross = gross.plus(money(a.gross_payout || 0));
      const lineNet = money(a.net_payout || a.gross_payout || 0);
      net = net.plus(lineNet);
      fee = fee.plus(money(a.gross_payout || 0).minus(lineNet));
    }
    const currency = partner.payout_currency || "NGN";
    const payout = await repo.createPayout({
      client,
      p: {
        payout_number: code("PXS-PO"),
        stylist_id: input.stylist_id,
        period_start: input.period_start,
        period_end: input.period_end,
        currency,
        gross_amount: toCurrencyString(gross),
        platform_fee_amount: toCurrencyString(fee),
        net_amount: toCurrencyString(net),
        amount_ngn: currency === "NGN" ? toCurrencyString(net) : null,
        created_by: user.user_id,
      },
    });
    for (const a of assignments) {
      const g = money(a.gross_payout || 0);
      const n = money(a.net_payout || a.gross_payout || 0);
      await repo.addPayoutLine({
        client,
        line: {
          payout_id: payout.payout_id,
          assignment_id: a.assignment_id,
          gross_amount: toCurrencyString(g),
          platform_fee_amount: toCurrencyString(g.minus(n)),
          net_amount: toCurrencyString(n),
          description: a.assignment_number,
        },
      });
      await repo.linkAssignmentToPayout({
        client,
        assignment_id: a.assignment_id,
        payout_id: payout.payout_id,
      });
    }
    await A(
      brand,
      user,
      "stylist.payout.generate",
      "stylist_payout",
      payout.payout_id,
      { lines: assignments.length },
      request_id,
    );
    events.emit("payout.generated", {
      payout_id: payout.payout_id,
      stylist_id: input.stylist_id,
    });
    return { ...payout, lines_count: assignments.length };
  });
}
/**
 * NGN value of a payout for the GL: explicit amount_ngn, else the net for
 * NGN-denominated payouts. Foreign-currency payouts without an NGN figure
 * cannot be valued — both GL legs skip together (logged), never one-sided.
 */
function payoutNgn(p) {
  if (p.amount_ngn) return money(p.amount_ngn);
  if ((p.currency || "NGN") === "NGN") return money(p.net_amount || 0);
  return null;
}

/** Policy Q11: earned commissions are a liability the moment they're approved. */
async function postPayoutAccrual({ brand, user_id, p }) {
  const ngn = payoutNgn(p);
  if (!ngn || ngn.lte(0)) {
    logger.warn(
      { payout_id: p.payout_id, currency: p.currency },
      "stylist payout has no NGN value — GL accrual skipped",
    );
    return null;
  }
  const accounting = require("../accounting/accounting.service");
  const { ACCOUNTS } = require("../accounting/posting-map");
  const amt = toCurrencyString(ngn);
  return accounting.postEntry({
    brand,
    user_id,
    entry: {
      source_type: "expense",
      source_table: "stylist_payouts",
      source_id: p.payout_id,
      reference: p.payout_number,
      description: `Stylist payout accrued — ${p.payout_number}`,
      idempotency_key: `stylist_payout_accrual:${p.payout_id}`,
    },
    lines: [
      {
        account_code: ACCOUNTS.MARKETING_INFLUENCER,
        debit_ngn: amt,
        description: `Stylist commission — ${p.payout_number}`,
      },
      {
        account_code: ACCOUNTS.COMMISSIONS_PAYABLE,
        credit_ngn: amt,
        description: `Payable to stylist — ${p.payout_number}`,
      },
    ],
  });
}

async function approvePayout({ brand, user, request_id, id }) {
  const p = await repo.findPayout({ id });
  if (!p) throw new NotFoundError("Payout");
  if (p.status !== "draft")
    throw new AppError("BAD_STATE", `Payout is ${p.status}`, 422);
  await postPayoutAccrual({ brand, user_id: user.user_id, p });
  const updated = await repo.setPayoutStatus({
    id,
    status: "approved",
    fields: {
      approved_by: user.user_id,
      approved_at: new Date().toISOString(),
    },
  });
  await A(
    brand,
    user,
    "stylist.payout.approve",
    "stylist_payout",
    id,
    null,
    request_id,
  );
  return updated;
}
async function markPayoutPaid({ brand, user, request_id, id, transfer_code }) {
  const p = await repo.findPayout({ id });
  if (!p) throw new NotFoundError("Payout");
  if (p.status !== "approved" && p.status !== "processing")
    throw new AppError("BAD_STATE", `Payout is ${p.status}`, 422);
  // Q11 second leg: clear the payable. Accrual first (idempotent) in case
  // the payout reached 'processing' without passing through approvePayout.
  const accrued = await postPayoutAccrual({ brand, user_id: user.user_id, p });
  const ngn = payoutNgn(p);
  if (ngn && ngn.gt(0) && accrued !== null) {
    const accounting = require("../accounting/accounting.service");
    const { ACCOUNTS } = require("../accounting/posting-map");
    const amt = toCurrencyString(ngn);
    await accounting.postEntry({
      brand,
      user_id: user.user_id,
      entry: {
        source_type: "payment",
        source_table: "stylist_payouts",
        source_id: id,
        reference: p.payout_number,
        description: `Stylist payout paid — ${p.payout_number}`,
        idempotency_key: `stylist_payout_paid:${id}`,
      },
      lines: [
        {
          account_code: ACCOUNTS.COMMISSIONS_PAYABLE,
          debit_ngn: amt,
          description: `Payable settled — ${p.payout_number}`,
        },
        {
          account_code: ACCOUNTS.BANK_MAIN,
          credit_ngn: amt,
          description: `Transfer to stylist — ${p.payout_number}`,
        },
      ],
    });
  }
  const updated = await repo.setPayoutStatus({
    id,
    status: "paid",
    fields: {
      paid_at: new Date().toISOString(),
      paystack_transfer_code: transfer_code || null,
      paystack_transfer_status: "success",
    },
  });
  await A(
    brand,
    user,
    "stylist.payout.paid",
    "stylist_payout",
    id,
    null,
    request_id,
  );
  events.emit("payout.paid", { payout_id: id, stylist_id: p.stylist_id });
  return updated;
}

// ════════════════════════════════════════════════════════════
// Portal auth (separate from staff)
// ════════════════════════════════════════════════════════════
async function login({ email, password, ip }) {
  if (!email || !password)
    throw new AppError(
      "INVALID_CREDENTIALS",
      "Email and password required",
      400,
    );
  const cred = await repo.findCredentialByEmail({ email: email.toLowerCase() });
  if (!cred || !cred.is_active)
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  if (cred.locked_until && new Date(cred.locked_until) > new Date())
    throw new AppError("LOCKED", "Account temporarily locked", 423);
  const ok = await argon2.verify(cred.password_hash, password);
  if (!ok) {
    await repo.recordCredentialFailure({ credential_id: cred.credential_id });
    throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }
  const partner = await repo.findPartner({ id: cred.stylist_id });
  if (!partner || partner.status === "terminated")
    throw new AppError("INACTIVE", "Stylist account is not active", 401);
  await repo.recordCredentialLogin({ stylist_id: cred.stylist_id, ip });

  const access_token = jwt.sign(
    { sub: cred.stylist_id, type: "stylist", email: cred.email },
    config.JWT_SECRET,
    { expiresIn: config.JWT_ACCESS_EXPIRES_IN },
  );
  return {
    stylist: {
      stylist_id: partner.stylist_id,
      partner_code: partner.partner_code,
      display_name: partner.display_name,
      status: partner.status,
      current_tier: partner.current_tier_key,
      force_password_reset: cred.force_password_reset,
    },
    access_token,
    expires_in: 15 * 60,
  };
}

// Portal self-service views (req.stylist.stylist_id from stylist auth).
function myProfile({ stylist_id }) {
  return getPartner({ id: stylist_id });
}
function myOpenOffers({ stylist_id }) {
  return repo.listOpenOffersForStylist({ stylist_id });
}
function myAssignments({ stylist_id, status }) {
  return repo.listAssignments({ stylist_id, status });
}
function myPayouts({ stylist_id }) {
  return repo.listPayouts({ stylist_id });
}

module.exports = {
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  setStatus,
  issueBadge,
  revokeBadge,
  verifyBadge,
  listSpecialities,
  setSpeciality,
  removeSpeciality,
  listCertifications,
  awardCertification,
  revokeCertification,
  listAssignments,
  getAssignment,
  openAssignment,
  acceptOffer,
  declineOffer,
  startAssignment,
  completeAssignment,
  cancelAssignment,
  rateAssignment,
  listPayouts,
  getPayout,
  generatePayout,
  approvePayout,
  markPayoutPaid,
  login,
  myProfile,
  myOpenOffers,
  myAssignments,
  myPayouts,
};
