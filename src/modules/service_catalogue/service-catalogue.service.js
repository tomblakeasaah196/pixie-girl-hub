/**
 * Service Catalogue — business logic.
 */

"use strict";

const repo = require("./service-catalogue.repo");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");

function listServices({ brand, category, active_only }) {
  return repo.listServices({ brand, category, active_only });
}

async function getService({ brand, id }) {
  const s = await repo.getService({ brand, id });
  if (!s) throw new NotFoundError("Service");
  return s;
}

async function createService({ brand, user, request_id, input }) {
  const s = await repo.createService({
    brand,
    user_id: user.user_id,
    input,
  });
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.create",
    target_type: "service_offering",
    target_id: s.service_id,
    after: { name: s.name, slug: s.slug, price: s.base_price_ngn },
    request_id,
  });
  return s;
}

async function updateService({ brand, user, request_id, id, input }) {
  const s = await repo.updateService({ brand, id, input });
  if (!s) throw new NotFoundError("Service");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.update",
    target_type: "service_offering",
    target_id: id,
    request_id,
  });
  return s;
}

async function deleteService({ brand, user, request_id, id }) {
  const s = await repo.deleteService({ brand, id });
  if (!s) throw new NotFoundError("Service");
  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "service_catalogue.delete",
    target_type: "service_offering",
    target_id: id,
    request_id,
  });
}

module.exports = {
  listServices,
  getService,
  createService,
  updateService,
  deleteService,
};
