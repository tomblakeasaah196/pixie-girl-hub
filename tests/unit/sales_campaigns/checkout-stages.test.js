"use strict";

/**
 * Public checkout pure stages (sales_campaigns/checkout.stages.js) — the
 * guards, pricing maths and metadata builders extracted from checkout().
 */

const { money } = require("../../../src/utils/money");
const stages = require("../../../src/modules/sales_campaigns/checkout.stages");

describe("assertWholesaleMinimum", () => {
  const campaign = { bulk_tiers: [{ min_qty: 10 }, { min_qty: 5 }] };

  it("blocks a raw-wig cart below the LOWEST bulk tier", () => {
    expect(() =>
      stages.assertWholesaleMinimum(campaign, [
        { unstyled: true, quantity: 2 },
        { unstyled: true, quantity: 1 },
      ]),
    ).toThrow("minimum of 5");
  });

  it("counts raw wigs ACROSS styles (mixing reaches the minimum)", () => {
    expect(() =>
      stages.assertWholesaleMinimum(campaign, [
        { unstyled: true, quantity: 3 },
        { unstyled: true, quantity: 2 },
      ]),
    ).not.toThrow();
  });

  it("ignores styled lines and carts with no raw wigs", () => {
    expect(() =>
      stages.assertWholesaleMinimum(campaign, [{ quantity: 1 }]),
    ).not.toThrow();
  });

  it("no-ops when the campaign has no bulk tiers", () => {
    expect(() =>
      stages.assertWholesaleMinimum({}, [{ unstyled: true, quantity: 1 }]),
    ).not.toThrow();
  });
});

describe("assertDeliveryAddress", () => {
  it("requires line1 + city for delivery", () => {
    expect(() =>
      stages.assertDeliveryAddress({
        fulfilment_type: "delivery",
        contact: { address: { line1: "1 Fake St" } },
      }),
    ).toThrow("delivery address");
  });

  it("lets pickup through addressless", () => {
    expect(() =>
      stages.assertDeliveryAddress({ fulfilment_type: "pickup", contact: {} }),
    ).not.toThrow();
  });
});

describe("styledUnitPrice / styledLineLabel", () => {
  const sv = {
    retail_price_ngn: "50000",
    price_override_ngn: null,
    colour_premium: "2000",
    size_premium: "3000",
    lace_premium: "1000",
    colour_name: "Jet Black",
    size_label: "M",
    lace_code: "13x4",
  };

  it("styled = anchor + colour + size + lace premiums", () => {
    expect(stages.styledUnitPrice(sv, false).toFixed(2)).toBe("56000.00");
  });

  it("override wins when set", () => {
    expect(
      stages.styledUnitPrice({ ...sv, price_override_ngn: "49999" }, false)
        .toFixed(2),
    ).toBe("49999.00");
  });

  it("unstyled = anchor only, no premiums, override ignored", () => {
    expect(
      stages.styledUnitPrice({ ...sv, price_override_ngn: "49999" }, true)
        .toFixed(2),
    ).toBe("50000.00");
  });

  it("labels styled vs unstyled lines", () => {
    expect(stages.styledLineLabel(sv, false)).toBe("Jet Black · M · 13x4");
    expect(stages.styledLineLabel(sv, true)).toBe("Jet Black · M · Unstyled");
  });
});

describe("computeBundleDiscount", () => {
  const components = [
    { unit_price_ngn: "40000", quantity: 2 },
    { unit_price_ngn: "20000", quantity: 1 },
  ]; // sum-of-parts = 100,000

  it("discounts down to the campaign bundle price", () => {
    const r = stages.computeBundleDiscount({
      components,
      campaignBundlePrice: "85000",
    });
    expect(r.sumOfParts.toFixed(2)).toBe("100000.00");
    expect(r.effectivePrice.toFixed(2)).toBe("85000.00");
    expect(r.discountPerBundle.toFixed(2)).toBe("15000.00");
  });

  it("never marks a bundle UP above sum-of-parts", () => {
    const r = stages.computeBundleDiscount({
      components,
      campaignBundlePrice: "120000",
    });
    expect(r.effectivePrice.toFixed(2)).toBe("100000.00");
    expect(r.discountPerBundle.toFixed(2)).toBe("0.00");
  });

  it("no campaign price → sum-of-parts, zero discount", () => {
    const r = stages.computeBundleDiscount({
      components,
      campaignBundlePrice: null,
    });
    expect(r.discountPerBundle.toFixed(2)).toBe("0.00");
  });
});

describe("resolveDisplayCurrency", () => {
  const campaign = { ngn_per_usd_rate: "1500" };

  it("USD converts NGN total → whole dollars, ceil, at the campaign rate", () => {
    const r = stages.resolveDisplayCurrency({
      display_currency: "usd",
      campaign,
      total_ngn: "100001",
    });
    expect(r.displayCurrency).toBe("USD");
    expect(r.displayTotal).toBe("67.00"); // ceil(100001/1500 = 66.667)
    expect(r.fxRateUsed).toBe(1500);
  });

  it("NGN keeps the defaults (null total, null rate)", () => {
    const r = stages.resolveDisplayCurrency({
      display_currency: undefined,
      campaign,
      total_ngn: "100000",
    });
    expect(r.displayCurrency).toBe("NGN");
    expect(r.displayTotal).toBeNull();
    expect(r.fxRateUsed).toBeNull();
  });

  it("USD without a campaign rate records nothing", () => {
    const r = stages.resolveDisplayCurrency({
      display_currency: "USD",
      campaign: {},
      total_ngn: "100000",
    });
    expect(r.displayTotal).toBeNull();
    expect(r.fxRateUsed).toBeNull();
  });
});

describe("selectPaymentGateway", () => {
  it("honours the buyer's pick when the campaign allows it", () => {
    expect(
      stages.selectPaymentGateway({
        checkoutCurrency: "NGN",
        requestedGateway: "nomba",
        campaign: { allowed_payment_gateways: ["paystack", "nomba"] },
      }),
    ).toBe("nomba");
  });

  it("falls back to the campaign's first enabled rail", () => {
    expect(
      stages.selectPaymentGateway({
        checkoutCurrency: "NGN",
        requestedGateway: "stripe",
        campaign: { allowed_payment_gateways: ["paystack"] },
      }),
    ).toBe("paystack");
  });

  it("USD forces nomba — and throws when the campaign disabled it", () => {
    expect(
      stages.selectPaymentGateway({
        checkoutCurrency: "USD",
        requestedGateway: "paystack",
        campaign: {},
      }),
    ).toBe("nomba");
    expect(() =>
      stages.selectPaymentGateway({
        checkoutCurrency: "USD",
        requestedGateway: null,
        campaign: { allowed_payment_gateways: ["paystack"] },
      }),
    ).toThrow("USD payment is not available");
  });
});

describe("metadata builders", () => {
  const gift = {
    recipient_name: "Ada",
    message: "Enjoy!",
    ship_to_recipient: true,
    recipient_address: { line1: "2 Palm Ave", city: "Ikeja", state: "Lagos" },
  };
  const deliveryQuote = {
    zone_id: "z1",
    zone_name: "Lagos Mainland",
    courier_key: "gig",
    country_code: "NG",
    fee_status: "ok",
  };
  const order = { _preorder: { is_preorder: true, line_count: 1, names: ["Wig A"] } };

  it("assembles internal notes: gift, consent, fulfilment, delivery, preorder, origin", () => {
    const internal = stages.buildInternalNotes({
      contact: { gift, consent: { marketing: true } },
      isPickup: false,
      deliveryQuote,
      shippingFeeNgn: 3500,
      order,
      ip: "1.2.3.4",
      user_agent: "UA",
    });
    expect(internal.ship_to).toBe("recipient");
    expect(internal.fulfilment_type).toBe("delivery");
    expect(internal.delivery.fee_ngn).toBe(3500);
    expect(internal.preorder.items).toEqual(["Wig A"]);
    expect(internal.ip).toBe("1.2.3.4");
  });

  it("builds the human customer notes with zone, preorder and gift lines", () => {
    const internal = stages.buildInternalNotes({
      contact: { gift },
      isPickup: false,
      deliveryQuote,
      shippingFeeNgn: 3500,
      order,
      ip: null,
      user_agent: null,
    });
    const notes = stages.buildCustomerNotes({
      contact: { notes: "Call on arrival", gift },
      isPickup: false,
      internal,
      order,
    });
    expect(notes).toContain("Call on arrival");
    expect(notes).toContain("Delivery zone: Lagos Mainland (gig).");
    expect(notes).toContain("Contains pre-order item(s).");
    expect(notes).toContain("GIFT ORDER for Ada");
    expect(notes).toContain("Ship to recipient: 2 Palm Ave, Ikeja, Lagos, Nigeria");
  });

  it("pickup notes carry the pickup flag; empty input → null", () => {
    const notes = stages.buildCustomerNotes({
      contact: {},
      isPickup: true,
      internal: {},
      order: {},
    });
    expect(notes).toBe("PICKUP / collect in store — no delivery.");
    expect(
      stages.buildCustomerNotes({ contact: {}, isPickup: false, internal: {}, order: {} }),
    ).toBeNull();
  });

  it("address snapshot projects exactly the shipping fields, null-safe", () => {
    expect(stages.buildAddressSnapshot(null)).toBeNull();
    const snap = stages.buildAddressSnapshot({
      address_id: "a1",
      line1: "1 Fake St",
      city: "Lagos",
      country: "Nigeria",
      recipient_name: "Ada",
      is_default: true,
    });
    expect(snap.line1).toBe("1 Fake St");
    expect(snap.address_id).toBeUndefined(); // not part of the snapshot
    expect(snap.is_default).toBeUndefined();
  });
});

// The service must still export computeBundleDiscount (existing tests import it).
it("campaigns.public.service re-exports computeBundleDiscount", () => {
  jest.mock("../../../src/config/database", () => ({
    query: jest.fn(),
    ex: (c) => c,
    transaction: jest.fn(),
  }));
  const svc = require("../../../src/modules/sales_campaigns/campaigns.public.service");
  const r = svc.computeBundleDiscount({
    components: [{ unit_price_ngn: "10", quantity: 1 }],
    campaignBundlePrice: "8",
  });
  expect(r.discountPerBundle.toFixed(2)).toBe("2.00");
  expect(money(r.effectivePrice).toFixed(2)).toBe("8.00");
});
