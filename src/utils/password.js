"use strict";

/**
 * Centralised argon2id parameters. Keeping them here means password-hash cost
 * is (a) tunable via env without code changes and (b) identical at every hash
 * site. ARGON2_MEMORY_COST is in KiB, ARGON2_TIME_COST is the iteration count.
 *
 * Only hashing takes options — argon2.verify() reads the algorithm and
 * parameters back out of the stored hash, so existing hashes keep verifying
 * even if these values change later.
 */

const argon2 = require("argon2");
const { config } = require("../config/env");

const hashOptions = {
  type: argon2.argon2id,
  memoryCost: config.ARGON2_MEMORY_COST,
  timeCost: config.ARGON2_TIME_COST,
};

module.exports = { hashOptions };
