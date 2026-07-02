/**
 * Sales pricing — exit-intent promo predicate (§6.22).
 *
 * Pure: does the entered promo code match the campaign's LIVE exit-intent
 * code with a positive flat discount? Campaign liveness is resolved by the
 * caller (campaignsService.resolveState) and passed in, keeping this free
 * of module dependencies.
 */

"use strict";

const { money } = require("../../../utils/money");

/**
 * @param {object|null} campRow    The campaign row (or null).
 * @param {string} enteredCode     Trimmed, upper-cased code the buyer typed.
 * @param {string|null} liveState  campaignsService.resolveState(campRow).
 */
function exitIntentMatches(campRow, enteredCode, liveState) {
  return !!(
    campRow &&
    campRow.exit_intent_enabled &&
    campRow.exit_intent_code &&
    String(campRow.exit_intent_code).trim().toUpperCase() === enteredCode &&
    campRow.exit_intent_discount_ngn !== null &&
    campRow.exit_intent_discount_ngn !== undefined &&
    money(campRow.exit_intent_discount_ngn).gt(money(0)) &&
    liveState === "live"
  );
}

module.exports = { exitIntentMatches };
