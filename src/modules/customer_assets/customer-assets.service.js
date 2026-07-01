/**
 * Customer assets (Stylist Studio §6.24) — business logic.
 *
 * Chain of custody for a client's OWN wig brought in for a service. We are
 * liable for the item from check-in until it leaves the door, so every state
 * change is audited.
 */

"use strict";

const repo = require("./customer-assets.repo");
const { audit } = require("../../middleware/audit");
const { transaction } = require("../../config/database");
const { NotFoundError, AppError } = require("../../utils/errors");

const A = (brand, user, action_key, target_id, after, request_id) =>
  audit({
    business: brand,
    user_id: user ? user.user_id : null,
    action_key,
    target_type: "customer_asset",
    target_id,
    after,
    request_id,
  });

function list(args) {
  return repo.list(args);
}
async function get({ brand, id }) {
  const a = await repo.get({ brand, id });
  if (!a) throw new NotFoundError("Customer asset");
  return a;
}

/** Take possession of a customer's wig — allocates the FLH-CA-#### tag. */
async function checkIn({ brand, user, request_id, input }) {
  return transaction(async (client) => {
    const asset_tag = await repo.nextTag({ client, brand });
    const asset = await repo.create({
      client,
      brand,
      asset: {
        asset_tag,
        owner_contact_id: input.owner_contact_id,
        intake_photo_doc_id: input.intake_photo_doc_id,
        condition_note: input.condition_note,
        service_job_id: input.service_job_id,
        created_by: user.user_id,
      },
    });
    await A(
      brand,
      user,
      "customer_assets.check_in",
      asset.asset_id,
      { asset_tag },
      request_id,
    );
    return asset;
  });
}

/** Return the wig to its owner (or mark it lost). */
async function checkOut({ brand, user, request_id, id, status }) {
  const before = await repo.get({ brand, id });
  if (!before) throw new NotFoundError("Customer asset");
  if (before.status === "returned_to_owner")
    throw new AppError("ALREADY_RETURNED", "Asset already returned", 409);
  const next = status === "lost" ? "lost" : "returned_to_owner";
  const asset = await repo.setStatus({
    brand,
    id,
    status: next,
    fields: { checked_out_at: new Date().toISOString() },
  });
  await A(
    brand,
    user,
    "customer_assets.check_out",
    id,
    { status: next },
    request_id,
  );
  return asset;
}

module.exports = { list, get, checkIn, checkOut };
