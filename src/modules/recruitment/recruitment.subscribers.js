/**
 * Recruitment subscribers.
 *
 * When an offer is fully signed on the e-sign engine, generate the employment
 * contract + send the welcome email. onOfferSigned is idempotent, so this acts
 * as a backstop even though the public sign path also calls it directly.
 *
 * Loaded for its side effects from recruitment.routes.js.
 */

"use strict";

const documentsEvents = require("../../shared/documents/documents.events");
const service = require("./recruitment.service");
const { logger } = require("../../config/logger");

documentsEvents.on("signature.fully_signed", async (payload) => {
  if (!payload || payload.reference_type !== "recruitment_offer") return;
  try {
    await service.onOfferSigned({
      offerId: payload.reference_id,
      business: payload.business,
    });
  } catch (err) {
    logger.error(
      { err: err.message, reference_id: payload.reference_id },
      "recruitment: onOfferSigned subscriber failed",
    );
  }
});

module.exports = {};
