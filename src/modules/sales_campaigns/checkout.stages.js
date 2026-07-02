/**
 * Public campaign checkout — pure stages.
 *
 * The decision/computation stages of campaigns.public.service's checkout()
 * (and quote path), extracted verbatim so each is directly unit-testable
 * without DB mocks. Every function here is deterministic: inputs → value or
 * a thrown AppError. All IO — campaign resolution, contact upsert, bundle/
 * styled lookups, delivery quoting, order creation, payment init — stays in
 * the service, in the same order as before.
 */

"use strict";

const { money, toCurrencyString } = require("../../utils/money");
const { AppError } = require("../../utils/errors");

// ── Wholesale minimum (cart-wide) ──────────────────────────
// Raw / unstyled wigs are a wholesale-only SKU: they only sell at or above the
// lowest configured bulk tier. The minimum is enforced on the COMBINED raw-wig
// count across every style in the cart — not per product — so a buyer can mix
// styles to reach it. The cart drawer mirrors this; this is the authoritative
// guard so the client check can't be bypassed.
function assertWholesaleMinimum(campaign, cart) {
  const bulkTiersForMin = Array.isArray(campaign.bulk_tiers)
    ? campaign.bulk_tiers
    : [];
  const minBulkQty = bulkTiersForMin
    .map((t) => Number(t && t.min_qty))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)[0];
  if (!minBulkQty) return;
  const rawWigQty = (cart || []).reduce(
    (sum, it) => sum + (it && it.unstyled ? Number(it.quantity) || 0 : 0),
    0,
  );
  if (rawWigQty > 0 && rawWigQty < minBulkQty) {
    throw new AppError(
      "WHOLESALE_MINIMUM_NOT_MET",
      `Raw (unstyled) wigs are sold wholesale — a minimum of ${minBulkQty} across any style. You have ${rawWigQty}. Add ${minBulkQty - rawWigQty} more, or remove the raw wigs, to continue.`,
      409,
    );
  }
}

// Delivery requires a usable address — the schema makes address optional so
// pickup can omit it; this guard stops a delivery checkout slipping through
// addressless and looking like a silent failure at fulfilment.
function assertDeliveryAddress(input) {
  if (input.fulfilment_type === "pickup") return;
  const a = input.contact.address;
  if (!a || !a.line1 || !a.city) {
    throw new AppError(
      "ADDRESS_REQUIRED",
      "Please enter your delivery address (or choose store pickup).",
      422,
    );
  }
}

// Styled line price: "buy unstyled / raw" prices at the styled product's
// anchor (retail_price_ngn) with no premiums; otherwise the override wins,
// else anchor + colour/size/lace premiums.
function styledUnitPrice(sv, unstyled) {
  return unstyled
    ? money(sv.retail_price_ngn || 0)
    : sv.price_override_ngn !== null && sv.price_override_ngn !== undefined
      ? money(sv.price_override_ngn)
      : money(sv.retail_price_ngn || 0)
          .plus(money(sv.colour_premium || 0))
          .plus(money(sv.size_premium || 0))
          .plus(money(sv.lace_premium || 0));
}

// Human label for the styled order line ("Colour · Size · Lace" or
// "Colour · Size · Unstyled").
function styledLineLabel(sv, unstyled) {
  return unstyled
    ? [sv.colour_name, sv.size_label, "Unstyled"].filter(Boolean).join(" · ")
    : [sv.colour_name, sv.size_label, sv.lace_code].filter(Boolean).join(" · ");
}

// PURE. Given a bundle's resolved component prices (per single bundle) and the
// campaign's fixed bundle price (campaign_bundle_price_ngn, or null when the
// operator didn't set one), return the sum-of-parts, the price the buyer pays
// per bundle, and the discount per bundle that brings the component sum down to
// the campaign price. The discount is applied ORDER-LEVEL (never per item) so it
// can't double-count with the deal ladder, and is clamped ≥ 0 so a mis-set
// campaign price can never INFLATE a bundle above its sum-of-parts.
function computeBundleDiscount({ components, campaignBundlePrice }) {
  const sumOfParts = (components || []).reduce(
    (a, c) =>
      a.plus(money(c.unit_price_ngn || 0).times(Number(c.quantity) || 1)),
    money(0),
  );
  const hasCampaignPrice =
    campaignBundlePrice !== null &&
    campaignBundlePrice !== undefined &&
    campaignBundlePrice !== "";
  // The campaign price may only ever DISCOUNT the bundle, never mark it up: a
  // price set above sum-of-parts is ignored (we keep sum-of-parts), so the quote
  // and the till always agree and effectivePrice === sumOfParts − discount.
  let effectivePrice = sumOfParts;
  if (hasCampaignPrice) {
    const cp = money(campaignBundlePrice);
    if (cp.lt(sumOfParts)) effectivePrice = cp;
  }
  const discountPerBundle = sumOfParts.minus(effectivePrice);
  return { sumOfParts, effectivePrice, discountPerBundle };
}

// Currency snapshot (admin clarity). USD checkouts settle in dollars at the
// gateway using the campaign's static rate (ngn_per_usd_rate, set in the
// builder); the dollar total is NGN total → whole units, ceil — the same
// conversion the gateway charges. NGN orders keep the defaults
// (display_total null, fx_rate_used null → existing NOT NULL default 1.0).
function resolveDisplayCurrency({ display_currency, campaign, total_ngn }) {
  const displayCurrency = String(display_currency || "NGN").toUpperCase();
  const campaignRate =
    campaign.ngn_per_usd_rate !== null &&
    campaign.ngn_per_usd_rate !== undefined
      ? Number(campaign.ngn_per_usd_rate)
      : null;
  let displayTotal = null;
  let fxRateUsed = null;
  if (displayCurrency !== "NGN" && campaignRate && campaignRate > 0) {
    displayTotal = toCurrencyString(
      money(total_ngn).dividedBy(money(campaignRate)).ceil(),
    );
    fxRateUsed = campaignRate;
  }
  return { displayCurrency, displayTotal, fxRateUsed };
}

// Per-campaign gateway gate: the owner can disable a rail for this sale in
// the builder. Enforced server-side — the public checkout only shows the
// allowed buttons, so a value outside this set is a stale/tampered client.
// USD has only the Nomba rail; NGN honours the buyer's pick, else the first
// gateway the campaign still has enabled.
function selectPaymentGateway({ checkoutCurrency, requestedGateway, campaign }) {
  const allowedGateways =
    Array.isArray(campaign.allowed_payment_gateways) &&
    campaign.allowed_payment_gateways.length
      ? campaign.allowed_payment_gateways
      : ["paystack", "nomba"];
  const preferredProvider =
    checkoutCurrency === "USD"
      ? "nomba"
      : requestedGateway && allowedGateways.includes(requestedGateway)
        ? requestedGateway
        : allowedGateways[0];
  if (!allowedGateways.includes(preferredProvider)) {
    // Either the buyer forced a disabled rail, or USD checkout hit a campaign
    // that has turned Nomba off — there is no valid rail to settle on.
    throw new AppError(
      "GATEWAY_NOT_AVAILABLE",
      checkoutCurrency === "USD"
        ? "USD payment is not available for this sale."
        : "That payment method is not available for this sale.",
      422,
    );
  }
  return preferredProvider;
}

// Structured internal notes for the back office: gift instructions, consent,
// fulfilment intent + resolved delivery zone/fee, pre-order detail, request
// origin. Mirrors exactly what checkout used to assemble inline.
function buildInternalNotes({
  contact,
  isPickup,
  deliveryQuote,
  shippingFeeNgn,
  order,
  ip,
  user_agent,
}) {
  const internal = {};
  if (contact.gift) {
    internal.gift = contact.gift;
    if (contact.gift.ship_to_recipient && contact.gift.recipient_address) {
      internal.ship_to = "recipient";
      internal.recipient_address = contact.gift.recipient_address;
    }
  }
  if (contact.consent) internal.consent = contact.consent;
  internal.fulfilment_type = isPickup ? "pickup" : "delivery";
  if (!isPickup && deliveryQuote && deliveryQuote.zone_id) {
    internal.delivery = {
      zone_name: deliveryQuote.zone_name,
      courier_key: deliveryQuote.courier_key,
      country_code: deliveryQuote.country_code,
      fee_ngn: shippingFeeNgn,
      fee_status: deliveryQuote.fee_status || null,
    };
  }
  if (order._preorder && order._preorder.is_preorder) {
    internal.preorder = {
      line_count: order._preorder.line_count,
      items: order._preorder.names,
    };
  }
  internal.ip = ip;
  internal.user_agent = user_agent;
  return internal;
}

// Human, fulfilment-facing customer notes (pickup flag, delivery zone, gift
// instructions, pre-order marker) — or null when there is nothing to say.
function buildCustomerNotes({ contact, isPickup, internal, order }) {
  const customerParts = [];
  if (contact.notes) customerParts.push(contact.notes);
  if (isPickup) {
    customerParts.push("PICKUP / collect in store — no delivery.");
  } else if (internal.delivery) {
    customerParts.push(
      `Delivery zone: ${internal.delivery.zone_name} (${internal.delivery.courier_key}).`,
    );
  }
  if (order._preorder && order._preorder.is_preorder) {
    customerParts.push("Contains pre-order item(s).");
  }
  if (contact.gift) {
    customerParts.push(`GIFT ORDER for ${contact.gift.recipient_name}`);
    if (contact.gift.message)
      customerParts.push(`Gift message: ${contact.gift.message}`);
    if (contact.gift.ship_to_recipient && contact.gift.recipient_address) {
      const ra = contact.gift.recipient_address;
      customerParts.push(
        `Ship to recipient: ${ra.line1}${ra.line2 ? `, ${ra.line2}` : ""}, ${ra.city}${ra.state ? `, ${ra.state}` : ""}, ${ra.country || "Nigeria"}`,
      );
    }
  }
  return customerParts.length ? customerParts.join("\n") : null;
}

// Freeze the delivery address onto the order so fulfilment ships exactly
// where the buyer typed — independent of later changes to their saved address.
function buildAddressSnapshot(deliveryAddress) {
  if (!deliveryAddress) return null;
  return {
    line1: deliveryAddress.line1,
    line2: deliveryAddress.line2,
    area: deliveryAddress.area,
    city: deliveryAddress.city,
    state: deliveryAddress.state,
    country: deliveryAddress.country,
    country_code: deliveryAddress.country_code,
    postal_code: deliveryAddress.postal_code,
    recipient_name: deliveryAddress.recipient_name,
    recipient_phone: deliveryAddress.recipient_phone,
  };
}

module.exports = {
  assertWholesaleMinimum,
  assertDeliveryAddress,
  styledUnitPrice,
  styledLineLabel,
  computeBundleDiscount,
  resolveDisplayCurrency,
  selectPaymentGateway,
  buildInternalNotes,
  buildCustomerNotes,
  buildAddressSnapshot,
};
