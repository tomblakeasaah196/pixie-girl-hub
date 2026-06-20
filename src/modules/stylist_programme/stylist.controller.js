/**
 * Stylist Partner Programme (V2.2 §6.26) — HTTP controllers.
 * Three audiences: admin (staff JWT), portal (stylist JWT), public (badge).
 */

"use strict";

const service = require("./stylist.service");

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
async function markPayoutPaid(req, res) {
  res.json({
    data: await service.markPayoutPaid({
      ...base(req),
      id: req.params.id,
      transfer_code: req.body.transfer_code,
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

// ════════════════ Public ════════════════
async function verifyBadge(req, res) {
  res.json({ data: await service.verifyBadge({ token: req.params.badge_id }) });
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
  approvePayout,
  markPayoutPaid,
  // portal
  login,
  myProfile,
  myOffers,
  myAssignments,
  myPayouts,
  acceptOffer,
  declineOffer,
  startAssignment,
  completeAssignment,
  // public
  verifyBadge,
};
