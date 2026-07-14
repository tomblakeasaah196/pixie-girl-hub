"use strict";

/**
 * Brand URL resolver tests — the single decision point for every
 * customer-facing link the system mints.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));
jest.mock("../../../src/config/env", () => ({
  config: {
    STOREFRONT_BASE_URL: "https://storefront.fallback.test",
    ADMIN_BASE_URL: "https://admin.fallback.test",
  },
}));

const { query } = require("../../../src/config/database");
const brandUrls = require("../../../src/utils/brand-urls");

function mockBrand(row) {
  query.mockResolvedValueOnce({ rows: row ? [row] : [] });
}

describe("brand-urls.publicBaseUrl", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    brandUrls.invalidate();
  });

  test("uses business_config.storefront_domain when set", async () => {
    mockBrand({ storefront_domain: "pixiegirlglobal.com" });
    const url = await brandUrls.publicBaseUrl("pixiegirl");
    expect(url).toBe("https://pixiegirlglobal.com");
  });

  test("preserves https:// when included", async () => {
    mockBrand({ storefront_domain: "https://thefaitlynbrand.com" });
    const url = await brandUrls.publicBaseUrl("faitlynhair");
    expect(url).toBe("https://thefaitlynbrand.com");
  });

  test("strips trailing slashes", async () => {
    mockBrand({ storefront_domain: "https://pixiegirlglobal.com/" });
    const url = await brandUrls.publicBaseUrl("pixiegirl");
    expect(url).toBe("https://pixiegirlglobal.com");
  });

  test("falls back to STOREFRONT_BASE_URL when storefront_domain unset", async () => {
    mockBrand({ storefront_domain: null });
    const url = await brandUrls.publicBaseUrl("pixiegirl");
    expect(url).toBe("https://storefront.fallback.test");
  });

  test("falls back when business_config row missing", async () => {
    mockBrand(null);
    const url = await brandUrls.publicBaseUrl("pixiegirl");
    expect(url).toBe("https://storefront.fallback.test");
  });
});

describe("brand-urls helpers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    brandUrls.invalidate();
  });

  // The /welcome onboarding form is a route of the Hub app, so its link
  // mints on the hub (admin) domain — NOT storefront_domain. No DB call.
  test("welcomeUrl mints on the hub domain + brand slug", async () => {
    const url = await brandUrls.welcomeUrl("pixiegirl", "tok123");
    expect(url).toBe("https://admin.fallback.test/welcome/pixiegirl/tok123");
    expect(query).not.toHaveBeenCalled();
  });

  // Order links, by contrast, ride the BRAND's own customer-facing domain
  // (owner decision 2026-07) so a Faitlyn shopper never sees a Pixie URL —
  // the deploy serves the checkout bundle on that host. Short `/o/<slug>`.
  test("orderLinkUrl mints on the brand storefront domain with /o/", async () => {
    mockBrand({ storefront_domain: "faitlynhair.com" });
    const url = await brandUrls.orderLinkUrl("faitlynhair", "Ab3xK9mP2q");
    expect(url).toBe("https://faitlynhair.com/o/Ab3xK9mP2q");
  });

  test("orderLinkUrl falls back to the hub base when no brand domain", async () => {
    mockBrand({ storefront_domain: null });
    const url = await brandUrls.orderLinkUrl("faitlynhair", "Ab3xK9mP2q");
    // publicBaseUrl → STOREFRONT_BASE_URL fallback (still a real base).
    expect(url).toBe("https://storefront.fallback.test/o/Ab3xK9mP2q");
  });

  test("payLinkUrl matches legacy /pay/{token} shape", async () => {
    mockBrand({ storefront_domain: "pixiegirlglobal.com" });
    const url = await brandUrls.payLinkUrl("pixiegirl", "abc");
    expect(url).toBe("https://pixiegirlglobal.com/pay/abc");
  });

  test("supportContact returns email + display name", async () => {
    mockBrand({
      support_email: "support@pixiegirlglobal.com",
      support_email_display_name: "Pixie Girl Support",
    });
    const s = await brandUrls.supportContact("pixiegirl");
    expect(s).toEqual({
      email: "support@pixiegirlglobal.com",
      display_name: "Pixie Girl Support",
    });
  });

  test("caches the lookup", async () => {
    mockBrand({ storefront_domain: "pixiegirlglobal.com" });
    await brandUrls.publicBaseUrl("pixiegirl");
    await brandUrls.publicBaseUrl("pixiegirl");
    await brandUrls.welcomeUrl("pixiegirl", "x");
    // Only one DB call thanks to the cache.
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("invalidate flushes the cache for a brand", async () => {
    mockBrand({ storefront_domain: "old.test" });
    expect(await brandUrls.publicBaseUrl("pixiegirl")).toBe("https://old.test");
    brandUrls.invalidate("pixiegirl");
    mockBrand({ storefront_domain: "new.test" });
    expect(await brandUrls.publicBaseUrl("pixiegirl")).toBe("https://new.test");
  });
});
