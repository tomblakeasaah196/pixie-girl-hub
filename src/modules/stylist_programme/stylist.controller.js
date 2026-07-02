/**
 * Stylist Partner Programme (V2.2 §6.26) — HTTP controllers.
 * Three audiences: admin (staff JWT), portal (stylist JWT), public (badge).
 */

"use strict";

const service = require("./stylist.service");
const applicationService = require("./application.service");
const contractService = require("./contract.service");
const referralService = require("./referral.service");
const routingService = require("./routing.service");
const badgeCard = require("./badge-card.service");
const programmeRepo = require("./programme.repo");
const notify = require("./stylist.notify");

const base = (req) => ({
  brand: req.brand,
  user: req.user,
  request_id: req.request_id,
});

// ════════════════ Admin ════════════════
async function listPartners(req, res) {
  res.json({
    data: await service.listPartners({
      status: req.query.status,
      country_code: req.query.country_code,
      city: req.query.city,
      contact_id: req.query.contact_id,
    }),
  });
}
async function getPartner(req, res) {
  res.json({ data: await service.getPartner({ id: req.params.id }) });
}
async function createPartner(req, res) {
  res.status(201).json({
    data: await service.createPartner({ ...base(req), input: req.body }),
  });
}
async function updatePartner(req, res) {
  res.json({
    data: await service.updatePartner({
      ...base(req),
      id: req.params.id,
      patch: req.body,
    }),
  });
}
async function setStatus(req, res) {
  res.json({
    data: await service.setStatus({
      ...base(req),
      id: req.params.id,
      status: req.body.status,
      reason: req.body.reason,
    }),
  });
}
async function issueBadge(req, res) {
  res.json({
    data: await service.issueBadge({ ...base(req), id: req.params.id }),
  });
}
async function revokeBadge(req, res) {
  res.json({
    data: await service.revokeBadge({ ...base(req), id: req.params.id }),
  });
}

async function listSpecialities(req, res) {
  res.json({
    data: await service.listSpecialities({
      id: req.params.id,
      brand: req.query.all === "true" ? undefined : req.brand,
    }),
  });
}
async function setSpeciality(req, res) {
  res.status(201).json({
    data: await service.setSpeciality({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function removeSpeciality(req, res) {
  await service.removeSpeciality({
    ...base(req),
    speciality_id: req.params.speciality_id,
  });
  res.status(204).end();
}

async function listCertifications(req, res) {
  res.json({ data: await service.listCertifications({ id: req.params.id }) });
}
async function awardCertification(req, res) {
  res.status(201).json({
    data: await service.awardCertification({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function revokeCertification(req, res) {
  res.json({
    data: await service.revokeCertification({
      ...base(req),
      certification_id: req.params.certification_id,
      reason: req.body.reason,
    }),
  });
}

async function listAssignments(req, res) {
  res.json({
    data: await service.listAssignments({
      business: req.brand,
      stylist_id: req.query.stylist_id,
      status: req.query.status,
      customer_contact_id: req.query.customer_contact_id,
    }),
  });
}
async function getAssignment(req, res) {
  res.json({ data: await service.getAssignment({ id: req.params.id }) });
}
async function openAssignment(req, res) {
  res.status(201).json({
    data: await service.openAssignment({ ...base(req), input: req.body }),
  });
}
async function cancelAssignment(req, res) {
  res.json({
    data: await service.cancelAssignment({
      ...base(req),
      assignment_id: req.params.id,
      reason: req.body.reason,
    }),
  });
}
async function rateAssignment(req, res) {
  res.json({
    data: await service.rateAssignment({
      ...base(req),
      assignment_id: req.params.id,
      rating: req.body.rating,
      review: req.body.review,
    }),
  });
}

async function listPayouts(req, res) {
  res.json({
    data: await service.listPayouts({
      stylist_id: req.query.stylist_id,
      status: req.query.status,
    }),
  });
}
async function getPayout(req, res) {
  res.json({ data: await service.getPayout({ id: req.params.id }) });
}
async function generatePayout(req, res) {
  res.status(201).json({
    data: await service.generatePayout({ ...base(req), input: req.body }),
  });
}
async function approvePayout(req, res) {
  res.json({
    data: await service.approvePayout({ ...base(req), id: req.params.id }),
  });
}
async function submitPayout(req, res) {
  res.json({
    data: await service.submitPayout({ ...base(req), id: req.params.id }),
  });
}
async function markPayoutPaid(req, res) {
  res.json({
    data: await service.markPayoutPaid({
      ...base(req),
      id: req.params.id,
      transfer_code: req.body.transfer_code,
    }),
  });
}

// ── Admin: applications & vetting ──────────────────────────
async function listApplications(req, res) {
  res.json({
    data: await applicationService.listApplications({
      status: req.query.status,
    }),
  });
}
async function getApplication(req, res) {
  res.json({
    data: await applicationService.getApplication({ id: req.params.id }),
  });
}
async function addVettingReview(req, res) {
  res.status(201).json({
    data: await applicationService.addVettingReview({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function decideApplication(req, res) {
  res.json({
    data: await applicationService.decide({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function invitePartner(req, res) {
  res.json({
    data: await applicationService.invite({ ...base(req), id: req.params.id }),
  });
}
async function sendContract(req, res) {
  res.json({
    data: await contractService.generateAndSend({
      ...base(req),
      stylist_id: req.params.id,
    }),
  });
}

// ── Admin: programme configuration ──────────────────────────
async function getConfig(req, res) {
  res.json({ data: await programmeRepo.getConfig({ business: notify.BRAND }) });
}
async function updateConfig(req, res) {
  res.json({
    data: await programmeRepo.updateConfig({
      business: notify.BRAND,
      patch: req.body,
    }),
  });
}
async function listTiers(req, res) {
  res.json({ data: await programmeRepo.listTiers({}) });
}
async function updateTier(req, res) {
  res.json({
    data: await programmeRepo.updateTier({
      tier_key: req.params.tier_key,
      patch: req.body,
    }),
  });
}
async function listQuestions(req, res) {
  res.json({ data: await programmeRepo.listQuestions({}) });
}
async function createQuestion(req, res) {
  res.status(201).json({ data: await programmeRepo.createQuestion({ q: req.body }) });
}
async function updateQuestion(req, res) {
  res.json({
    data: await programmeRepo.updateQuestion({
      question_id: req.params.question_id,
      patch: req.body,
    }),
  });
}

// ── Admin: routing, disputes, reviews, referrals ────────────
async function routingSuggest(req, res) {
  res.json({
    data: await routingService.suggest({
      business: req.brand,
      service_key: req.query.service_key,
      target: {
        city: req.query.city,
        state: req.query.state,
        country_code: req.query.country_code,
        latitude: req.query.latitude,
        longitude: req.query.longitude,
      },
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
  });
}
async function addOffers(req, res) {
  res.status(201).json({
    data: await service.addOffers({
      ...base(req),
      assignment_id: req.params.id,
      stylist_ids: req.body.stylist_ids,
    }),
  });
}
async function disputeAssignment(req, res) {
  res.json({
    data: await service.disputeAssignment({
      ...base(req),
      id: req.params.id,
      input: req.body,
    }),
  });
}
async function listReviews(req, res) {
  res.json({
    data: await programmeRepo.listVerifiedReviews({
      stylist_id: req.query.stylist_id,
      include_hidden: req.query.hidden === "true",
    }),
  });
}
async function setReviewVisibility(req, res) {
  res.json({
    data: await programmeRepo.setReviewVisibility({
      assignment_id: req.params.assignment_id,
      hidden: Boolean(req.body.hidden),
    }),
  });
}
async function listReferralAttributions(req, res) {
  res.json({
    data: await referralService.listAttributions({
      stylist_id: req.query.stylist_id,
      business: req.brand,
      status: req.query.status,
    }),
  });
}

// ════════════════ Portal (stylist JWT → req.stylist) ════════════════
async function login(req, res) {
  res.json({
    data: await service.login({
      email: req.body.email,
      password: req.body.password,
      ip: req.ip,
    }),
  });
}
async function myProfile(req, res) {
  res.json({
    data: await service.myProfile({ stylist_id: req.stylist.stylist_id }),
  });
}
async function myOffers(req, res) {
  res.json({
    data: await service.myOpenOffers({ stylist_id: req.stylist.stylist_id }),
  });
}
async function myAssignments(req, res) {
  res.json({
    data: await service.myAssignments({
      stylist_id: req.stylist.stylist_id,
      status: req.query.status,
    }),
  });
}
async function myPayouts(req, res) {
  res.json({
    data: await service.myPayouts({ stylist_id: req.stylist.stylist_id }),
  });
}
async function acceptOffer(req, res) {
  res.json({
    data: await service.acceptOffer({
      stylist_id: req.stylist.stylist_id,
      assignment_id: req.params.id,
      request_id: req.request_id,
    }),
  });
}
async function declineOffer(req, res) {
  res.json({
    data: await service.declineOffer({
      stylist_id: req.stylist.stylist_id,
      assignment_id: req.params.id,
      reason: req.body.reason,
    }),
  });
}
async function startAssignment(req, res) {
  res.json({
    data: await service.startAssignment({
      stylist_id: req.stylist.stylist_id,
      assignment_id: req.params.id,
    }),
  });
}
async function completeAssignment(req, res) {
  res.json({
    data: await service.completeAssignment({
      stylist_id: req.stylist.stylist_id,
      assignment_id: req.params.id,
    }),
  });
}
async function forgotPassword(req, res) {
  res.json({
    data: await applicationService.forgotPassword({ email: req.body.email }),
  });
}
async function resetPassword(req, res) {
  res.json({
    data: await applicationService.resetPassword({
      token: req.body.token,
      password: req.body.password,
    }),
  });
}
async function updateMyProfile(req, res) {
  res.json({
    data: await service.updateMyProfile({
      stylist_id: req.stylist.stylist_id,
      patch: req.body,
    }),
  });
}
async function updateMyPayoutDetails(req, res) {
  res.json({
    data: await service.updateMyPayoutDetails({
      stylist_id: req.stylist.stylist_id,
      patch: req.body,
    }),
  });
}
async function myEarnings(req, res) {
  res.json({
    data: await service.myEarnings({ stylist_id: req.stylist.stylist_id }),
  });
}
async function myPayout(req, res) {
  res.json({
    data: await service.myPayout({
      stylist_id: req.stylist.stylist_id,
      id: req.params.id,
    }),
  });
}
async function myReferrals(req, res) {
  res.json({
    data: await referralService.summary({
      stylist_id: req.stylist.stylist_id,
    }),
  });
}
async function createReferralLink(req, res) {
  res.status(201).json({
    data: await referralService.createLink({
      stylist_id: req.stylist.stylist_id,
      business: notify.BRAND,
      input: req.body,
    }),
  });
}
async function myNotifications(req, res) {
  res.json({
    data: await service.myNotifications({
      stylist_id: req.stylist.stylist_id,
      unread_only: req.query.unread === "true",
    }),
  });
}
async function markNotificationRead(req, res) {
  res.json({
    data: await service.markNotificationRead({
      stylist_id: req.stylist.stylist_id,
      notification_id: req.params.id,
    }),
  });
}
async function markAllNotificationsRead(req, res) {
  res.json({
    data: {
      updated: await service.markAllNotificationsRead({
        stylist_id: req.stylist.stylist_id,
      }),
    },
  });
}
async function myBadge(req, res) {
  res.json({
    data: await badgeCard.badgeInfo({ stylist_id: req.stylist.stylist_id }),
  });
}
async function myBadgeCard(req, res) {
  const card = await badgeCard.renderCard({
    stylist_id: req.stylist.stylist_id,
  });
  res.setHeader("Content-Type", card.mime_type);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${card.filename}"`,
  );
  res.send(card.buffer);
}
async function myContract(req, res) {
  res.json({
    data: await contractService.getContractState({
      stylist_id: req.stylist.stylist_id,
    }),
  });
}
async function signMyContract(req, res) {
  res.json({
    data: await contractService.signMyContract({
      stylist_id: req.stylist.stylist_id,
      signature_image_base64: req.body.signature_image,
      ip: req.ip,
      ua: req.headers["user-agent"],
    }),
  });
}
/** The contract PDF itself, streamed to the signed-in partner. */
async function myContractDocument(req, res) {
  const repo = require("./stylist.repo");
  const documents = require("../../shared/documents/documents.service");
  const partner = await repo.findPartner({ id: req.stylist.stylist_id });
  if (!partner || !partner.contract_document_id)
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "No contract" } });
  const dl = await documents.download({
    brand: notify.BRAND,
    id: partner.contract_document_id,
  });
  res.setHeader("Content-Type", dl.mime_type);
  res.setHeader("Content-Disposition", `inline; filename="${dl.filename}"`);
  res.send(dl.buffer);
}

// ════════════════ Public ════════════════
async function verifyBadge(req, res) {
  res.json({ data: await service.verifyBadge({ token: req.params.badge_id }) });
}
async function publicQuestions(req, res) {
  res.json({ data: await applicationService.getPublicQuestions() });
}
async function publicApply(req, res) {
  const files = {};
  for (const f of req.files || []) {
    if (f.fieldname === "id_doc") files.id_doc = f;
    if (f.fieldname === "business_doc") files.business_doc = f;
  }
  // Multipart fields arrive as strings; answers is a JSON-encoded array.
  const input = { ...req.body };
  if (typeof input.answers === "string") {
    try {
      input.answers = JSON.parse(input.answers);
    } catch {
      input.answers = [];
    }
  }
  res.status(201).json({
    data: await applicationService.apply({
      input,
      files,
      request_id: req.request_id,
    }),
  });
}
async function publicDirectory(req, res) {
  res.json({
    data: await service.publicDirectory({
      city: req.query.city,
      country_code: req.query.country_code,
      tier: req.query.tier,
      service_key: req.query.service_key,
    }),
  });
}
async function publicGetReview(req, res) {
  res.json({
    data: await service.getReviewByToken({ token: req.params.token }),
  });
}
async function publicSubmitReview(req, res) {
  res.json({
    data: await service.submitReviewByToken({
      token: req.params.token,
      rating: req.body.rating,
      review: req.body.review,
    }),
  });
}
async function publicReferralRedirect(req, res) {
  const { publicBaseUrl } = require("../../utils/brand-urls");
  const storefrontBase = (await publicBaseUrl(notify.BRAND)) || "";
  const hit = await referralService.resolveRedirect({ code: req.params.code });
  if (!hit) return res.redirect(302, `${storefrontBase}/`);
  const path =
    hit.target_path && hit.target_path.startsWith("/") ? hit.target_path : "/";
  res.redirect(
    302,
    `${storefrontBase}${path}${path.includes("?") ? "&" : "?"}ref=${encodeURIComponent(hit.code)}`,
  );
}

module.exports = {
  // admin
  listPartners,
  getPartner,
  createPartner,
  updatePartner,
  setStatus,
  issueBadge,
  revokeBadge,
  listSpecialities,
  setSpeciality,
  removeSpeciality,
  listCertifications,
  awardCertification,
  revokeCertification,
  listAssignments,
  getAssignment,
  openAssignment,
  cancelAssignment,
  rateAssignment,
  listPayouts,
  getPayout,
  generatePayout,
  submitPayout,
  approvePayout,
  markPayoutPaid,
  listApplications,
  getApplication,
  addVettingReview,
  decideApplication,
  invitePartner,
  sendContract,
  getConfig,
  updateConfig,
  listTiers,
  updateTier,
  listQuestions,
  createQuestion,
  updateQuestion,
  routingSuggest,
  addOffers,
  disputeAssignment,
  listReviews,
  setReviewVisibility,
  listReferralAttributions,
  // portal
  login,
  myProfile,
  myOffers,
  myAssignments,
  myPayouts,
  myPayout,
  acceptOffer,
  declineOffer,
  startAssignment,
  completeAssignment,
  forgotPassword,
  resetPassword,
  updateMyProfile,
  updateMyPayoutDetails,
  myEarnings,
  myReferrals,
  createReferralLink,
  myNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  myBadge,
  myBadgeCard,
  myContract,
  signMyContract,
  myContractDocument,
  // public
  verifyBadge,
  publicQuestions,
  publicApply,
  publicDirectory,
  publicGetReview,
  publicSubmitReview,
  publicReferralRedirect,
};
