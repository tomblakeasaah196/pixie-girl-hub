/**
 * Audit log (V2.2 §3) — read service. Thin wrapper over the read repo; the
 * write path is the audit() middleware used by every module.
 */

"use strict";

const repo = require("./audit.repo");
const { NotFoundError } = require("../../utils/errors");

function list(args) {
  return repo.list(args);
}
async function getById({ brand, id }) {
  const row = await repo.getById({ brand, id });
  if (!row) throw new NotFoundError("Audit entry");
  return row;
}
function forRecord(args) {
  return repo.forRecord(args);
}

function myFeed(args) {
  return repo.myFeed(args);
}

module.exports = { list, getById, forRecord, myFeed };
