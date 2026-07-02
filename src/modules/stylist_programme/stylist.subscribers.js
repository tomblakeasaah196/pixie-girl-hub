/**
 * Stylist subscribers — the programme's cross-module reactions.
 *
 * 1. service_jobs.created (in-process): a customer styling job with no
 *    in-house owner opens a routing assignment (dispatch queue).
 * 2. order.paid (durable outbox, post-commit, at-least-once): a paid order
 *    carrying sales_orders.stylist_referral_code accrues the partner's
 *    referral commission (Q17). Idempotent via UNIQUE (business, order_id).
 * 3. documents signature.fully_signed (in-process): a fully-signed partner
 *    contract stamps contract_signed_at and auto-issues the badge (Q10).
 *
 * Best-effort + idempotent throughout. Registered once.
 */

"use strict";

const serviceJobEvents = require("../service_jobs/service-jobs.events");
const documentsEvents = require("../../shared/documents/documents.events");
const outbox = require("../../shared/outbox/outbox");
const repo = require("./stylist.repo");
const service = require("./stylist.service");
const { logger } = require("../../config/logger");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  // 1. Unowned customer styling job → routing assignment.
  serviceJobEvents.on("created", async ({ brand, job_id }) => {
    try {
      const job = await repo.getServiceJob({ brand, job_id });
      if (!job) return;
      // Only route genuinely unassigned, customer-facing jobs to partners.
      if (!job.customer_contact_id) return;
      if (job.assigned_stylist_id || job.assigned_staff_user_id) return;
      // Idempotency: don't open a second assignment for the same job.
      const existing = await repo.listAssignments({
        business: brand,
        customer_contact_id: job.customer_contact_id,
      });
      if (
        existing.some(
          (a) =>
            a.reference_type === "service_booking" && a.reference_id === job_id,
        )
      )
        return;

      await service.openAssignment({
        brand,
        user: null,
        request_id: null,
        input: {
          customer_contact_id: job.customer_contact_id,
          reference_type: "service_booking",
          reference_id: job_id,
          service_key: "styling",
          base_rate: job.agreed_cost_ngn,
          scheduled_at: job.scheduled_for,
          candidate_stylist_ids: [],
          // Routed jobs are dispatched by Ops with the suggest drawer; the
          // subscriber only parks them in the queue (no blind auto-offer).
          auto_offer: false,
        },
      });
    } catch (err) {
      logger.error(
        { err: err.message, brand, job_id },
        "stylist: auto-open assignment on service_job.created failed",
      );
    }
  });

  // 2. Durable referral accrual — runs in the worker's outbox dispatcher.
  outbox.register(
    "order.paid",
    "stylist_referral_accrual",
    async (payload) => {
      const referral = require("./referral.service");
      await referral.accrueForPaidOrder({
        brand: payload.brand,
        order_id: payload.order_id,
      });
    },
  );

  // 3. Contract fully signed → badge (in-process; signing happens in the API
  //    process via the public sign endpoint).
  documentsEvents.on("signature.fully_signed", async (payload) => {
    if (payload.reference_type !== "stylist_partner") return;
    try {
      const contract = require("./contract.service");
      await contract.onContractSigned({ reference_id: payload.reference_id });
    } catch (err) {
      logger.error(
        { err: err.message, stylist_id: payload.reference_id },
        "stylist: contract-signed reaction failed",
      );
    }
  });

  logger.info(
    "stylist subscribers registered (service_jobs.created → routing · order.paid → referral accrual · contract signed → badge)",
  );
}

register();

module.exports = { register };
