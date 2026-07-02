/**
 * Sales Campaigns v2 — VIP rollup + gift workflow.
 *
 * At campaign end (or on-demand via the admin endpoint), pick the top-N
 * spenders for the campaign, tag them as `campaign_vip` in the per-brand
 * contact-segment system, promote anyone crossing the lifetime spend
 * threshold to `Platinum VIP`, and open a "Send VIP gift" task for the
 * CEO. The task carries the customer's delivery address + a Praxis-
 * suggested gift category based on the order.
 *
 * Background scheduler hook lives in src/jobs/schedulers/ (PR 2 deploy).
 */

"use strict";

const { query, transaction } = require("../../config/database");
const { t } = require("../../config/brands");
const campaignsRepo = require("./campaigns.repo");
const events = require("./campaigns.events");
const { audit } = require("../../middleware/audit");
const { NotFoundError } = require("../../utils/errors");

// Order statuses that count as money the customer has actually spent. Mirrors
// the "paid" convention used across the codebase (contacts timeline, weekly
// reports) — sales_orders has no `payment_status` column; spend is derived from
// the lifecycle `status`. Kept in one place so the campaign-spend rollup and the
// lifetime-spend promotion check can never drift apart.
const PAID_ORDER_STATUSES =
  "('paid','awaiting_dispatch','dispatched','completed')";

/**
 * Compute the top-N spenders for a campaign + their order info, ready
 * to be granted VIP status. Pure read — does not write.
 */
async function listTopSpenders({ brand, campaign_id, top_n = 10 }) {
  const { rows } = await query(
    `SELECT so.contact_id,
            c.first_name, c.last_name, c.email, c.primary_phone AS phone,
            c.ambassador_profile->'social_handles'->>'instagram' AS instagram_handle,
            SUM(so.total_ngn)::numeric(14,4)        AS total_spend_ngn,
            COUNT(*)::int                            AS orders_count,
            MAX(so.delivery_address_id)              AS last_delivery_address_id
       FROM ${t(brand, "sales_orders")} so
       LEFT JOIN shared.contacts c ON c.contact_id = so.contact_id
      WHERE so.sales_campaign_id = $1
        AND so.status IN ${PAID_ORDER_STATUSES}
        AND so.contact_id        IS NOT NULL
      GROUP BY so.contact_id, c.first_name, c.last_name, c.email, c.primary_phone,
            c.ambassador_profile
      ORDER BY total_spend_ngn DESC
      LIMIT $2`,
    [campaign_id, top_n],
  );
  return rows.map((r, idx) => ({ ...r, rank: idx + 1 }));
}

/**
 * Grant top spenders the campaign_vip tag and open gift tasks.
 * Idempotent via the (campaign_id, contact_id) unique constraint on
 * sales_campaign_vip_grants.
 */
async function grantTopSpenders({
  brand,
  user,
  request_id,
  campaign_id,
  top_n,
}) {
  const campaign = await campaignsRepo.findById({ brand, id: campaign_id });
  if (!campaign) throw new NotFoundError("Campaign");

  const effectiveN = top_n || campaign.vip_top_n || 10;
  const spenders = await listTopSpenders({
    brand,
    campaign_id,
    top_n: effectiveN,
  });
  if (!spenders.length) return { granted: 0, lifetime_promoted: 0 };

  let granted = 0;
  let lifetimePromoted = 0;

  for (const spender of spenders) {
    await transaction(async (client) => {
      // Lifetime spend
      const { rows: lifeRows } = await client.query(
        `SELECT COALESCE(SUM(total_ngn),0)::numeric AS lifetime
           FROM ${t(brand, "sales_orders")}
          WHERE contact_id = $1 AND status IN ${PAID_ORDER_STATUSES}`,
        [spender.contact_id],
      );
      const lifetime = Number(lifeRows[0].lifetime || 0);
      const lifetimeThreshold = Number(
        campaign.vip_lifetime_threshold_ngn || 0,
      );
      const promoteLifetime =
        lifetimeThreshold > 0 && lifetime >= lifetimeThreshold;

      // Tag — write into shared.contact_tags (idempotent via UNIQUE).
      await client.query(
        `INSERT INTO shared.contact_tags (contact_id, tag_name, business, colour)
         VALUES ($1, 'campaign_vip', $2, '#A81D1D')
         ON CONFLICT (contact_id, tag_name, business) DO NOTHING`,
        [spender.contact_id, brand],
      );
      if (promoteLifetime) {
        await client.query(
          `INSERT INTO shared.contact_tags (contact_id, tag_name, business, colour)
           VALUES ($1, 'platinum_vip', $2, '#690909')
           ON CONFLICT (contact_id, tag_name, business) DO NOTHING`,
          [spender.contact_id, brand],
        );
        lifetimePromoted++;
      }

      // Create the grant row + gift task (idempotent on (campaign_id, contact_id))
      const { rows: gRows } = await client.query(
        `INSERT INTO ${t(brand, "sales_campaign_vip_grants")}
           (campaign_id, contact_id, rank, total_spend_ngn, promoted_to_platinum,
            praxis_gift_suggestion, gift_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT (campaign_id, contact_id) DO UPDATE SET
           rank                   = EXCLUDED.rank,
           total_spend_ngn        = EXCLUDED.total_spend_ngn,
           promoted_to_platinum   = EXCLUDED.promoted_to_platinum,
           praxis_gift_suggestion = EXCLUDED.praxis_gift_suggestion
         RETURNING *`,
        [
          campaign_id,
          spender.contact_id,
          spender.rank,
          spender.total_spend_ngn,
          promoteLifetime,
          // Praxis suggestion intentionally minimal in v1; the chat surface
          // can refine when CEO opens the task.
          giftCategoryForSpend(spender.total_spend_ngn),
        ],
      );

      // Open a "Send VIP gift" task assigned to the CEO if not already present.
      const grant = gRows[0];
      if (!grant.gift_task_id) {
        const { rows: tRows } = await client.query(
          `INSERT INTO shared.tasks
             (business, title, description, status, priority, assigned_to,
              created_by, due_at, reference_type, reference_id)
           VALUES ($1, $2, $3, 'today', 'high', NULL, $4, now() + interval '7 days',
                   'sales_campaign_vip_grant', $5)
           RETURNING task_id`,
          [
            brand,
            `Send VIP gift — ${spender.first_name || ""} ${spender.last_name || ""}`.trim(),
            `Top spender (#${spender.rank}) on campaign ${campaign.name}.\n` +
              `Spend: ₦${Number(spender.total_spend_ngn).toLocaleString()}\n` +
              `Suggested gift: ${grant.praxis_gift_suggestion}\n` +
              `Contact: ${spender.email || ""} ${spender.phone || ""}`,
            user.user_id,
            grant.grant_id,
          ],
        );
        await client.query(
          `UPDATE ${t(brand, "sales_campaign_vip_grants")} SET gift_task_id = $1 WHERE grant_id = $2`,
          [tRows[0].task_id, grant.grant_id],
        );
      }
      granted++;
    });
  }

  await audit({
    business: brand,
    user_id: user.user_id,
    action_key: "sales_campaigns.vip.grant",
    target_type: "sales_campaigns",
    target_id: campaign_id,
    after: { granted, lifetime_promoted: lifetimePromoted, top_n: effectiveN },
    request_id,
  });
  events.emit("vip_granted", {
    brand,
    id: campaign_id,
    granted,
    lifetime_promoted: lifetimePromoted,
  });
  return { granted, lifetime_promoted: lifetimePromoted };
}

async function listGrants({ brand, campaign_id }) {
  const { rows } = await query(
    `SELECT g.*, c.first_name, c.last_name, c.email,
            c.ambassador_profile->'social_handles'->>'instagram' AS instagram_handle
       FROM ${t(brand, "sales_campaign_vip_grants")} g
       LEFT JOIN shared.contacts c ON c.contact_id = g.contact_id
      WHERE g.campaign_id = $1
      ORDER BY g.rank ASC`,
    [campaign_id],
  );
  return rows;
}

async function updateGiftStatus({
  brand,
  user,
  request_id,
  campaign_id,
  grant_id,
  gift_status,
}) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE ${t(brand, "sales_campaign_vip_grants")}
          SET gift_status = $1,
              thank_you_sent_at = CASE WHEN $1 = 'dispatched' THEN now() ELSE thank_you_sent_at END
        WHERE grant_id = $2 AND campaign_id = $3
        RETURNING *`,
      [gift_status, grant_id, campaign_id],
    );
    if (!rows[0]) throw new NotFoundError("VIP grant");
    await audit({
      business: brand,
      user_id: user.user_id,
      action_key: "sales_campaigns.vip.gift_status",
      target_type: "sales_campaign_vip_grants",
      target_id: grant_id,
      after: { gift_status },
      request_id,
    });
    return rows[0];
  });
}

// ── Heuristic gift category — placeholder while the LLM is offline ──
function giftCategoryForSpend(total) {
  const n = Number(total || 0);
  if (n >= 1_000_000)
    return "branded wig + handwritten letter + scented candle gift box";
  if (n >= 500_000) return "branded scarf + scented candle";
  return "branded postcard + thank-you scarf";
}

module.exports = {
  listTopSpenders,
  grantTopSpenders,
  listGrants,
  updateGiftStatus,
};
