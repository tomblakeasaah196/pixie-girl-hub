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
const programmeRepo = require("./programme.repo");
const notify = require("./stylist.notify");
const wf = require("../../workflows/engine");
const events = require("./stylist.events");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { config } = require("../../config/env");
const { money, toCurrencyString } = require("../../utils/money");
const { NotFoundError, AppError } = require("../../utils/errors");

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
  const onProbation =
    partner.probation_ends_at &&
    new Date(partner.probation_ends_at) > new Date();
  return {
    valid: certified,
    partner_code: partner.partner_code,
    display_name: partner.display_name,
    status: partner.status,
    on_probation: Boolean(onProbation),
    city: partner.city,
    country_code: partner.country_code,
    current_tier: partner.current_tier_key,
    tier_label: partner.tier_label,
    tier_color: partner.tier_color,
    tier_expires_at: partner.current_tier_expires_at,
    avg_rating: partner.avg_rating,
    rating_count: partner.rating_count,
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
  const cfg = await programmeRepo.getConfig({ business: brand });

  // Smart routing (Q13): with no hand-picked candidates, rank eligible
  // partners (nearest → tier/rating/capacity/specialty weighted) and offer to
  // the configured top N. Hand-picked ids skip the engine but still record.
  let ranked = [];
  let candidates = input.candidate_stylist_ids || [];
  if (!candidates.length && input.auto_offer !== false) {
    const routing = require("./routing.service");
    const suggestion = await routing.suggest({
      business: brand,
      service_key: input.service_key,
      target: {
        city: input.city,
        state: input.state,
        country_code: input.country_code,
        latitude: input.latitude,
        longitude: input.longitude,
        ...(input.service_address || {}),
      },
    });
    ranked = suggestion.candidates.slice(
      0,
      input.offer_top_n || suggestion.offer_top_n || 3,
    );
    candidates = ranked.map((c) => c.stylist_id);
  }

  const result = await transaction(async (client) => {
    const offerExpires =
      input.offer_expires_at ||
      new Date(
        Date.now() +
          (input.offer_window_hours ||
            (cfg ? cfg.offer_window_hours : 24) ||
            24) *
            3600 *
            1000,
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
    for (const sid of candidates) {
      const r = ranked.find((c) => c.stylist_id === sid);
      await repo.createOffer({
        client,
        assignment_id: assignment.assignment_id,
        stylist_id: sid,
        match_score: r ? r.match_score : undefined,
        match_rank: r ? r.match_rank : undefined,
      });
    }
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

  // Post-commit: nudge every offered partner (in-portal + email, best-effort).
  for (const sid of candidates)
    notify
      .notifyStylist({
        stylist_id: sid,
        type: "offer",
        title: "New job offer",
        body: `A ${input.service_key} job in ${input.city || "your area"} is open to you — first to accept wins.`,
        data: { assignment_id: result.assignment_id },
        email: {
          subject: "New Pixie Girl job offer",
          bodyHtml: `<p>A <strong>${input.service_key}</strong> assignment is
            open to you. Offers close ${new Date(result.offer_expires_at).toLocaleString("en-GB")} — first to accept wins.</p>`,
          ctaLabel: "View the offer",
          ctaPath: "/offers",
        },
      })
      .catch(() => {});
  return result;
}

/** Add offers to an already-open assignment (one-click "offer to top N"). */
async function addOffers({ brand, user, request_id, assignment_id, stylist_ids }) {
  const a = await repo.findAssignment({ id: assignment_id });
  if (!a) throw new NotFoundError("Assignment");
  if (a.status !== "offered_pool")
    throw new AppError("BAD_STATE", `Assignment is ${a.status}`, 422);
  let added = 0;
  for (const sid of stylist_ids) {
    const created = await repo.createOffer({
      assignment_id,
      stylist_id: sid,
    });
    if (!created) continue;
    added++;
    notify
      .notifyStylist({
        stylist_id: sid,
        type: "offer",
        title: "New job offer",
        body: `A ${a.service_key} job is open to you — first to accept wins.`,
        data: { assignment_id },
        email: {
          subject: "New Pixie Girl job offer",
          bodyHtml: `<p>A <strong>${a.service_key}</strong> assignment is open
            to you — first to accept wins.</p>`,
          ctaLabel: "View the offer",
          ctaPath: "/offers",
        },
      })
      .catch(() => {});
  }
  await A(
    brand,
    user,
    "stylist.assignment.add_offers",
    "stylist_assignment",
    assignment_id,
    { added },
    request_id,
  );
  return { assignment_id, added };
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
    // Tier multiplier snapshot (Q9): the partner's CURRENT tier at acceptance
    // sets the multiplier for this job; later tier changes never reprice it.
    const tier = partner.current_tier_key
      ? await programmeRepo.findTier({
          client,
          tier_key: partner.current_tier_key,
        })
      : null;
    const tierMultiplier = money(
      tier ? tier.payout_multiplier : assignment.tier_multiplier || 1,
    );
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
        tier_multiplier: tierMultiplier.toFixed(2),
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
  const updated = await transaction(async (client) => {
    const a = await repo.findAssignment({ client, id: assignment_id });
    if (!a) throw new NotFoundError("Assignment");
    if (a.stylist_id !== stylist_id)
      throw new AppError("NOT_YOURS", "Not your assignment", 403);
    if (a.status !== "in_progress" && a.status !== "accepted")
      throw new AppError("BAD_STATE", `Assignment is ${a.status}`, 422);

    // Quality-hold (Q14): payable when the customer confirms satisfaction or
    // the hold window lapses. The review token (Q15) is the confirmation key.
    const cfg = await programmeRepo.getConfig({
      client,
      business: a.business,
    });
    const holdDays = cfg ? Number(cfg.quality_hold_days ?? 7) : 7;
    const completedAt = new Date();
    await repo.setAssignmentStatus({
      client,
      id: assignment_id,
      status: "completed",
      fields: {
        completed_at: completedAt.toISOString(),
        payable_at: new Date(
          completedAt.getTime() + holdDays * 86_400_000,
        ).toISOString(),
      },
    });
    await programmeRepo.setAssignmentReviewToken({
      client,
      assignment_id,
      token: crypto.randomBytes(24).toString("base64url"),
    });
    await repo.bumpActiveCount({ client, id: stylist_id, delta: -1 });
    events.emit("assignment.completed", {
      assignment_id,
      stylist_id,
      business: a.business,
    });
    return repo.findAssignment({ client, id: assignment_id });
  });

  // Post-commit: invite the customer to confirm + review (verified reviews
  // come ONLY through this platform-routed token — §6.26).
  sendReviewInvite(updated).catch(() => {});
  return updated;
}

async function sendReviewInvite(assignment) {
  if (!assignment || !assignment.review_token) return;
  const { query } = require("../../config/database");
  const { rows } = await query(
    `SELECT email, display_name FROM shared.contacts WHERE contact_id = $1`,
    [assignment.customer_contact_id],
  );
  const contact = rows[0];
  if (!contact || !contact.email) return;
  await notify.emailAddress({
    to: contact.email,
    subject: "How was your styling service?",
    bodyHtml: `<p>Hi ${contact.display_name || "there"},</p>
      <p>Your stylist marked your service as complete. Confirming you're happy
      releases their payment — and your verified review helps other customers
      choose with confidence.</p>`,
    ctaLabel: "Confirm & review",
    ctaPath: `/review/${assignment.review_token}`,
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
  if (a.stylist_id)
    await programmeRepo.refreshPartnerRating({ stylist_id: a.stylist_id });
  return updated;
}

// ════════════════════════════════════════════════════════════
// Verified customer reviews + quality-hold confirmation (Q14/Q15)
// ════════════════════════════════════════════════════════════
/** Public: the review page reads the assignment behind its token. */
async function getReviewByToken({ token }) {
  const a = await programmeRepo.findAssignmentByReviewToken({ token });
  if (!a) throw new NotFoundError("Review link");
  return {
    assignment_number: a.assignment_number,
    service_key: a.service_key,
    stylist_name: a.stylist_name,
    completed_at: a.completed_at,
    already_reviewed: Boolean(a.reviewed_at),
    satisfaction_confirmed: Boolean(a.satisfaction_confirmed_at),
  };
}

/**
 * Public: submit the verified review. Only platform-routed customers hold a
 * token, so ratings cannot be gamed (§6.26). Doubles as the satisfaction
 * confirmation that releases the quality hold immediately.
 */
async function submitReviewByToken({ token, rating, review }) {
  return transaction(async (client) => {
    const a = await programmeRepo.findAssignmentByReviewToken({
      client,
      token,
    });
    if (!a) throw new NotFoundError("Review link");
    if (a.status !== "completed")
      throw new AppError("BAD_STATE", "This service is not completed yet", 422);
    if (a.reviewed_at)
      throw new AppError("ALREADY_REVIEWED", "This service was already reviewed", 409);
    const now = new Date().toISOString();
    await repo.setAssignmentStatus({
      client,
      id: a.assignment_id,
      status: a.status,
      fields: {
        customer_rating: rating,
        customer_review: review || null,
        reviewed_at: now,
        satisfaction_confirmed_at: now,
        payable_at: now, // confirmation releases the hold immediately
      },
    });
    if (a.stylist_id)
      await programmeRepo.refreshPartnerRating({
        client,
        stylist_id: a.stylist_id,
      });
    await A(
      a.business,
      null,
      "stylist.review.submit",
      "stylist_assignment",
      a.assignment_id,
      { rating },
      null,
    );
    events.emit("review.received", {
      assignment_id: a.assignment_id,
      stylist_id: a.stylist_id,
      rating,
    });
    if (a.stylist_id)
      notify
        .notifyStylist({
          stylist_id: a.stylist_id,
          type: "assignment",
          title: `Customer review: ${rating}★`,
          body: `Your ${a.service_key} job ${a.assignment_number} was confirmed by the customer — payment released for the next payout.`,
          data: { assignment_id: a.assignment_id, rating },
        })
        .catch(() => {});
    return { ok: true };
  });
}

// ── Disputes freeze the payable (Q14) ─────────────────────
async function disputeAssignment({ brand, user, request_id, id, input }) {
  const a = await repo.findAssignment({ id });
  if (!a) throw new NotFoundError("Assignment");
  if (input.action === "open") {
    if (a.status !== "completed" && a.status !== "in_progress")
      throw new AppError("BAD_STATE", `Assignment is ${a.status}`, 422);
    const updated = await repo.setAssignmentStatus({
      id,
      status: "disputed",
      fields: {
        disputed_at: new Date().toISOString(),
        dispute_reason: input.reason || null,
        dispute_resolved_at: null,
        dispute_resolution: null,
      },
    });
    await A(brand, user, "stylist.dispute.open", "stylist_assignment", id, { reason: input.reason }, request_id);
    events.emit("assignment.disputed", { assignment_id: id, stylist_id: a.stylist_id });
    if (a.stylist_id)
      notify
        .notifyStylist({
          stylist_id: a.stylist_id,
          type: "assignment",
          title: "A job is under review",
          body: `Assignment ${a.assignment_number} has an open customer dispute — payment is on hold while Operations reviews it.`,
          data: { assignment_id: id },
        })
        .catch(() => {});
    return updated;
  }
  if (input.action === "resolve") {
    if (!a.disputed_at || a.dispute_resolved_at)
      throw new AppError("BAD_STATE", "No open dispute on this assignment", 422);
    // Resolution returns the assignment to 'completed'; uphold voids the
    // payable by clearing payable_at (ops can re-set via a fresh resolution).
    const fields = {
      dispute_resolved_at: new Date().toISOString(),
      dispute_resolution: input.resolution || null,
    };
    if (input.outcome === "uphold") fields.payable_at = null;
    const updated = await repo.setAssignmentStatus({
      id,
      status: "completed",
      fields,
    });
    await A(brand, user, "stylist.dispute.resolve", "stylist_assignment", id, { outcome: input.outcome }, request_id);
    return updated;
  }
  throw new AppError("BAD_ACTION", "action must be open|resolve", 422);
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
    // Two-way earnings (Q17): payable referral commissions join the batch.
    const attributions = await programmeRepo.payableAttributions({
      client,
      stylist_id: input.stylist_id,
      period_end: input.period_end,
    });
    if (!assignments.length && !attributions.length)
      throw new AppError(
        "NOTHING_TO_PAY",
        "No payable assignments or referral commissions in period",
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
    for (const r of attributions) {
      gross = gross.plus(money(r.commission_amount_ngn || 0));
      net = net.plus(money(r.commission_amount_ngn || 0));
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
          line_kind: "assignment",
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
    for (const r of attributions) {
      await repo.addPayoutLine({
        client,
        line: {
          payout_id: payout.payout_id,
          attribution_id: r.attribution_id,
          line_kind: "referral",
          gross_amount: toCurrencyString(money(r.commission_amount_ngn || 0)),
          platform_fee_amount: "0.00",
          net_amount: toCurrencyString(money(r.commission_amount_ngn || 0)),
          description: `Referral commission — order ${r.order_number || r.order_id}`,
        },
      });
      await programmeRepo.linkAttributionToPayout({
        client,
        attribution_id: r.attribution_id,
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
 * Submit a draft payout into the approval workflow (Q16). The default route
 * ("stylist_programme:payout") sends every batch to Finance/CEO; the Org &
 * Workflow builder can re-route or threshold it without a code change.
 */
async function submitPayout({ brand, user, request_id, id }) {
  return transaction(async (client) => {
    const p = await repo.findPayout({ client, id });
    if (!p) throw new NotFoundError("Payout");
    if (p.status !== "draft")
      throw new AppError("BAD_STATE", `Payout is ${p.status}`, 422);
    const instance = await wf.openInstance({
      client,
      business: brand,
      trigger_module: "stylist_programme",
      trigger_action: "payout",
      reference_table: "shared.stylist_payouts",
      reference_id: id,
      opened_by: user.user_id,
      context: {
        payout_number: p.payout_number,
        net_amount: p.net_amount,
        currency: p.currency,
        stylist_id: p.stylist_id,
      },
    });
    const updated = await repo.setPayoutStatus({
      client,
      id,
      status: "pending_approval",
      fields: { workflow_instance_id: instance.instance_id },
    });
    await A(
      brand,
      user,
      "stylist.payout.submit",
      "stylist_payout",
      id,
      { workflow_instance_id: instance.instance_id },
      request_id,
    );
    events.emit("payout.submitted", { payout_id: id });
    return updated;
  });
}

async function approvePayout({ brand, user, request_id, id, notes }) {
  return transaction(async (client) => {
    const p = await repo.findPayout({ client, id });
    if (!p) throw new NotFoundError("Payout");
    // Drafts remain directly approvable for backward compatibility; submitted
    // batches must clear their workflow stage (permission AND route enforced).
    if (p.status !== "draft" && p.status !== "pending_approval")
      throw new AppError("BAD_STATE", `Payout is ${p.status}`, 422);
    if (p.status === "pending_approval") {
      const instance = await wf.findOpenInstance({
        client,
        business: brand,
        reference_table: "shared.stylist_payouts",
        reference_id: id,
      });
      if (instance)
        await wf.act({
          client,
          instance_id: instance.instance_id,
          user,
          action: "approve",
          notes,
        });
    }
    const updated = await repo.setPayoutStatus({
      client,
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
    events.emit("payout.approved", { payout_id: id, stylist_id: p.stylist_id });
    return updated;
  });
}
async function markPayoutPaid({ brand, user, request_id, id, transfer_code }) {
  const updated = await transaction(async (client) => {
    const p = await repo.findPayout({ client, id });
    if (!p) throw new NotFoundError("Payout");
    if (p.status !== "approved" && p.status !== "processing")
      throw new AppError("BAD_STATE", `Payout is ${p.status}`, 422);
    const row = await repo.setPayoutStatus({
      client,
      id,
      status: "paid",
      fields: {
        paid_at: new Date().toISOString(),
        paystack_transfer_code: transfer_code || null,
        paystack_transfer_status: "success",
      },
    });
    await programmeRepo.markAttributionsPaid({ client, payout_id: id });
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
    return row;
  });
  notify
    .notifyStylist({
      stylist_id: updated.stylist_id,
      type: "payout",
      title: "Payout sent",
      body: `Payout ${updated.payout_number} (${updated.currency} ${updated.net_amount}) has been paid.`,
      data: { payout_id: updated.payout_id },
      email: {
        subject: "Your Pixie Girl payout has been sent",
        bodyHtml: `<p>Payout <strong>${updated.payout_number}</strong> —
          ${updated.currency} ${updated.net_amount} — has been transferred to
          your registered account. Your statement is available in the portal.</p>`,
        ctaLabel: "View statement",
        ctaPath: "/earnings",
      },
    })
    .catch(() => {});
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
async function myProfile({ stylist_id }) {
  const profile = await getPartner({ id: stylist_id });
  const tier = profile.current_tier_key
    ? await programmeRepo.findTier({ tier_key: profile.current_tier_key })
    : null;
  // Never ship payout secrets or internal vetting notes to the browser.
  delete profile.payout_account_number;
  delete profile.vetting_decision_note;
  return {
    ...profile,
    tier_label: tier ? tier.label : null,
    tier_color: tier ? tier.badge_color : null,
    on_probation: Boolean(
      profile.probation_ends_at &&
        new Date(profile.probation_ends_at) > new Date(),
    ),
    unread_notifications: await programmeRepo.unreadNotificationCount({
      stylist_id,
    }),
  };
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
async function myPayout({ stylist_id, id }) {
  const p = await repo.findPayout({ id });
  if (!p || p.stylist_id !== stylist_id) throw new NotFoundError("Payout");
  return p;
}

/** Earnings dashboard: hold vs payable vs paid + referral totals. */
async function myEarnings({ stylist_id }) {
  const [assignments, payouts] = await Promise.all([
    repo.listAssignments({ stylist_id, status: "completed" }),
    repo.listPayouts({ stylist_id }),
  ]);
  const referral = await require("./referral.service").summary({ stylist_id });
  const now = new Date();
  let onHold = money(0);
  let payable = money(0);
  for (const a of assignments) {
    if (a.payout_id) continue;
    const amt = money(a.net_payout || 0);
    const openDispute = a.disputed_at && !a.dispute_resolved_at;
    if (!openDispute && a.payable_at && new Date(a.payable_at) <= now)
      payable = payable.plus(amt);
    else onHold = onHold.plus(amt);
  }
  const paid = payouts
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s.plus(money(p.net_amount || 0)), money(0));
  return {
    assignments_on_hold_ngn: toCurrencyString(onHold),
    assignments_payable_ngn: toCurrencyString(payable),
    paid_out_ngn: toCurrencyString(paid),
    referral_totals: referral.totals,
    recent_payouts: payouts.slice(0, 6),
  };
}

/** Portal profile edits — public-facing fields only. */
async function updateMyProfile({ stylist_id, patch }) {
  const allowed = [
    "bio",
    "portfolio_url",
    "instagram_url",
    "youtube_url",
    "website_url",
    "city",
    "state",
    "country_code",
    "latitude",
    "longitude",
    "service_radius_km",
  ];
  const safe = {};
  for (const k of allowed) if (patch[k] !== undefined) safe[k] = patch[k];
  const updated = await repo.updatePartner({ id: stylist_id, patch: safe });
  if (!updated) throw new NotFoundError("Stylist");
  await A(
    notify.BRAND,
    null,
    "stylist.portal.profile_update",
    "stylist_partner",
    stylist_id,
    safe,
    null,
  );
  return myProfile({ stylist_id });
}

/** Portal payout details — bank fields only, audited. */
async function updateMyPayoutDetails({ stylist_id, patch }) {
  const allowed = [
    "payout_currency",
    "payout_bank_name",
    "payout_account_number",
    "payout_account_name",
  ];
  const safe = {};
  for (const k of allowed) if (patch[k] !== undefined) safe[k] = patch[k];
  const updated = await repo.updatePartner({ id: stylist_id, patch: safe });
  if (!updated) throw new NotFoundError("Stylist");
  await A(
    notify.BRAND,
    null,
    "stylist.portal.payout_details_update",
    "stylist_partner",
    stylist_id,
    { fields: Object.keys(safe) }, // never write account numbers to the audit log
    null,
  );
  return { ok: true };
}

// ── Portal notifications feed ─────────────────────────────
function myNotifications({ stylist_id, unread_only }) {
  return programmeRepo.listNotifications({ stylist_id, unread_only });
}
function markNotificationRead({ stylist_id, notification_id }) {
  return programmeRepo.markNotificationRead({ stylist_id, notification_id });
}
function markAllNotificationsRead({ stylist_id }) {
  return programmeRepo.markAllNotificationsRead({ stylist_id });
}

// ── Public directory (storefront + portal, Q2 section B) ──
async function publicDirectory({ city, country_code, tier, service_key }) {
  const partners = await repo.listPartners({
    status: "certified",
    country_code,
    city,
  });
  const tiers = await programmeRepo.listTiers({ active_only: true });
  const tierMap = new Map(tiers.map((t) => [t.tier_key, t]));
  let out = partners;
  if (tier) out = out.filter((p) => p.current_tier_key === tier);
  if (service_key) {
    const filtered = [];
    for (const p of out) {
      const specs = await repo.listSpecialities({
        stylist_id: p.stylist_id,
        business: notify.BRAND,
      });
      if (specs.some((s) => s.service_key === service_key && s.is_active))
        filtered.push(p);
    }
    out = filtered;
  }
  // Public fields only — never payout, docs, or scores.
  return out.map((p) => {
    const t = tierMap.get(p.current_tier_key);
    return {
      partner_code: p.partner_code,
      display_name: p.display_name,
      city: p.city,
      state: p.state,
      country_code: p.country_code,
      tier_key: p.current_tier_key,
      tier_label: t ? t.label : null,
      tier_color: t ? t.badge_color : null,
      avg_rating: p.avg_rating,
      rating_count: p.rating_count,
      bio: p.bio,
      portfolio_url: p.portfolio_url,
      instagram_url: p.instagram_url,
      website_url: p.website_url,
      badge_token: p.badge_revoked_at ? null : p.badge_token,
    };
  });
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
  addOffers,
  acceptOffer,
  declineOffer,
  startAssignment,
  completeAssignment,
  cancelAssignment,
  rateAssignment,
  getReviewByToken,
  submitReviewByToken,
  disputeAssignment,
  listPayouts,
  getPayout,
  generatePayout,
  submitPayout,
  approvePayout,
  markPayoutPaid,
  login,
  myProfile,
  myOpenOffers,
  myAssignments,
  myPayouts,
  myPayout,
  myEarnings,
  updateMyProfile,
  updateMyPayoutDetails,
  myNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  publicDirectory,
};
