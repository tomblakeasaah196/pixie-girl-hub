/**
 * Sales pricing — channel price tier resolution (V2.2 §6.2).
 *
 * Pure: picks the unit price for a sales channel from a variant/service
 * pricing context row, falling back to the storefront tier.
 */

"use strict";

function channelPrice(ctx, channel) {
  // NOTE: the POS *terminal app* was retired (replaced by the Quick Sale Form),
  // but 'pos' survives here as the IN-STORE PRICE TIER (price_pos_ngn) and as a
  // sales_channel/payroll-commission channel. That is a pricing concept, not the
  // terminal, and is intentionally kept — a walk-in sale can still be priced at
  // the in-store rate. Renaming the tier is a separate, deliberate migration.
  if (channel === "pos") return ctx.price_pos_ngn ?? ctx.price_storefront_ngn;
  if (channel === "wholesale" || channel === "intercompany")
    return ctx.price_wholesale_ngn ?? ctx.price_storefront_ngn;
  if (channel === "partner" || channel === "stylist_routed")
    return ctx.price_partner_ngn ?? ctx.price_storefront_ngn;
  return ctx.price_storefront_ngn ?? ctx.price_pos_ngn;
}

module.exports = { channelPrice };
