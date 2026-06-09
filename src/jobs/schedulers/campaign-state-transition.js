/**
 * Campaign state-transition sweep (V2.2 §6.22 three-phase lifecycle).
 * Runs every minute:
 *   - scheduled → live   when starts_at <= now (fires the go-live blast)
 *   - live      → ended  when ends_at   <= now (generates the report)
 *
 * Manual launch/pause/resume/end via the API still work; this just covers
 * the time-based edges so a campaign goes live / ends on schedule.
 */

"use strict";

const { query } = require("../../config/database");
const { logger } = require("../../config/logger");
const events = require("../../modules/sales_campaigns/campaigns.events");
const notifications = require("../../modules/sales_campaigns/campaigns.notifications.service");

const { BRANDS } = require("../../config/brands");

async function runCampaignStateTransitions() {
  for (const brand of BRANDS) {
    // Go live
    const { rows: live } = await query(
      `UPDATE ${brand}.sales_campaigns
          SET status = 'live'
        WHERE status = 'scheduled' AND starts_at <= now() AND ends_at > now()
        RETURNING campaign_id, slug`,
    );
    for (const c of live) {
      events.emit("launch", { brand, id: c.campaign_id, status: "live" });
      notifications
        .fireGoLiveBlast({ brand, campaign_id: c.campaign_id })
        .catch((err) =>
          logger.error(
            { err, brand, id: c.campaign_id },
            "go-live blast failed",
          ),
        );
      logger.info({ brand, slug: c.slug }, "campaign auto-launched");
    }

    // End
    const { rows: ended } = await query(
      `UPDATE ${brand}.sales_campaigns
          SET status = 'ended'
        WHERE status IN ('live', 'paused') AND ends_at <= now()
        RETURNING campaign_id, slug`,
    );
    for (const c of ended) {
      events.emit("end", { brand, id: c.campaign_id, status: "ended" });
      notifications
        .generatePostCampaignReport({ brand, campaign_id: c.campaign_id })
        .catch((err) =>
          logger.error(
            { err, brand, id: c.campaign_id },
            "post-campaign report failed",
          ),
        );
      logger.info({ brand, slug: c.slug }, "campaign auto-ended");
    }
  }
}

module.exports = { runCampaignStateTransitions };
