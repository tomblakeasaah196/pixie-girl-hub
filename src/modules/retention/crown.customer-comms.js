/**
 * Crown 👑 customer comms — turns customer-facing Crown events into branded
 * emails via the Comms Studio dispatcher (channel + templates authored there,
 * like order_confirmation). Best-effort: an unconfigured automation is a clean
 * no-op (`reason: "not_configured"`), so this can ship before the copy is
 * authored and starts sending the moment the team enables the automation.
 *
 * Event keys for the Studio:
 *   crown_tier_reached   — vars: { tier_name }
 *   crown_streak_reminder — vars: { streak_type, deadline_at }
 */

"use strict";

const events = require("./retention.events");
const { logger } = require("../../config/logger");

const swallow = (label) => (err) =>
  logger.error({ err: err.message }, `crown comms: ${label} failed`);

// Lazy require avoids a load-time cycle (comms studio → … → retention).
const comms = () => require("../comms_studio/comms-studio.service");

let registered = false;

function register() {
  if (registered) return;
  registered = true;

  // Tier promotion → congratulate the shopper.
  events.on("crown.tier_promoted", ({ brand, contact_id, tier_name }) => {
    if (!contact_id) return;
    comms()
      .dispatch({
        brand,
        event_key: "crown_tier_reached",
        contact_id,
        reference_type: "contact",
        reference_id: contact_id,
        dedup_key: `crown_tier:${contact_id}:${tier_name}`,
        variables: { tier_name: tier_name || "a new tier" },
      })
      .catch(swallow("tier_reached"));
  });

  // Streak entering its warning window → remind the shopper to keep it alive.
  events.on("crown.streak_at_risk", ({ brand, contact_id, streak_type, deadline_at }) => {
    if (!contact_id) return;
    comms()
      .dispatch({
        brand,
        event_key: "crown_streak_reminder",
        contact_id,
        reference_type: "contact",
        reference_id: contact_id,
        dedup_key: `crown_streak:${contact_id}:${streak_type}:${deadline_at || ""}`,
        variables: {
          streak_type: String(streak_type || "").replace(/_/g, " "),
          deadline_at: deadline_at || "",
        },
      })
      .catch(swallow("streak_reminder"));
  });

  logger.info("crown customer-comms subscribers registered (tier_reached + streak_reminder)");
}

register();

module.exports = { register };
