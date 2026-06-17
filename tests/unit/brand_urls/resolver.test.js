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

  test("welcomeUrl uses the brand storefront domain + slug", async () => {
    mockBrand({ storefront_domain: "pixiegirlglobal.com" });
    const url = await brandUrls.welcomeUrl("pixiegirl", "tok123");
    expect(url).toBe("https://pixiegirlglobal.com/welcome/pixiegirl/tok123");
  });

  test("orderCaptureUrl uses the /order/capture/ path", async () => {
    mockBrand({ storefront_domain: "thefaitlynbrand.com" });
    const url = await brandUrls.orderCaptureUrl("faitlynhair", "jwt-abc");
    expect(url).toBe("https://thefaitlynbrand.com/order/capture/jwt-abc");
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
