"use strict";

/**
 * GET /api/public/brand/:brandKey — the DB-backed public identity feed the
 * public apps read instead of hardcoding brand domains or mailboxes.
 */

jest.mock("../../../src/modules/business_setup/business-setup.repo", () => ({}));
jest.mock(
  "../../../src/modules/business_setup/business-config.repo",
  () => ({ findPublicIdentity: jest.fn() }),
);
jest.mock("../../../src/modules/business_setup/business-setup.events", () => ({}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(),
}));

const configRepo = require("../../../src/modules/business_setup/business-config.repo");
const service = require("../../../src/modules/business_setup/business-setup.service");

describe("business-setup.service.getPublicBrandIdentity", () => {
  beforeEach(() => jest.clearAllMocks());

  test("returns normalised, display-safe identity from business_config", async () => {
    configRepo.findPublicIdentity.mockResolvedValueOnce({
      business_key: "faitlynhair",
      display_name: "Faitlyn Hair",
      website: "faitlynhair.com/",
      storefront_domain: null,
      sales_subdomain: "sales.faitlynhair.com",
      support_email: "support@faitlynhair.com",
      support_email_display_name: "Faitlyn Care",
      accent_colour: "#7f703d",
      logo_path: null,
    });
    const out = await service.getPublicBrandIdentity({ brand: "faitlynhair" });
    expect(out).toEqual({
      key: "faitlynhair",
      name: "Faitlyn Hair",
      website: "https://faitlynhair.com",
      // storefront_url falls back to the website when no dedicated
      // storefront domain is configured.
      storefront_url: "https://faitlynhair.com",
      sales_host: "sales.faitlynhair.com",
      support_email: "support@faitlynhair.com",
      support_email_display_name: "Faitlyn Care",
      accent_colour: "#7f703d",
      logo_url: null,
    });
  });

  test("prefers storefront_domain over website for storefront_url", async () => {
    configRepo.findPublicIdentity.mockResolvedValueOnce({
      business_key: "pixiegirl",
      display_name: "Pixie Girl",
      website: "https://pixiegirlglobal.com",
      storefront_domain: "shop.pixiegirlglobal.com",
      sales_subdomain: null,
      support_email: null,
      support_email_display_name: null,
      accent_colour: null,
      logo_path: null,
    });
    const out = await service.getPublicBrandIdentity({ brand: "pixiegirl" });
    expect(out.storefront_url).toBe("https://shop.pixiegirlglobal.com");
    expect(out.sales_host).toBeNull();
    expect(out.support_email).toBeNull();
  });

  test("404s (NotFoundError) for an unknown/inactive brand", async () => {
    configRepo.findPublicIdentity.mockResolvedValueOnce(null);
    await expect(
      service.getPublicBrandIdentity({ brand: "nope" }),
    ).rejects.toMatchObject({ http_status: 404 });
  });
});
