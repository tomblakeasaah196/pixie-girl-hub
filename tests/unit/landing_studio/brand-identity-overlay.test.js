"use strict";

/**
 * getPublished must overlay the brand's LIVE domains from business_config
 * over whatever the published snapshot stored — the CEO changes domains in
 * Settings → Business Setup and every public page follows on the next
 * read, with no re-publish and no code change (the invariant behind the
 * thefaitlynbrand.com → faitlynhair.com move).
 */

jest.mock("sharp", () => jest.fn());
jest.mock("../../../src/modules/landing_studio/landing.repo", () => ({
  findPublished: jest.fn(),
  findByBrand: jest.fn(),
}));
jest.mock(
  "../../../src/modules/business_setup/business-config.repo",
  () => ({ findPublicIdentity: jest.fn() }),
);
jest.mock("../../../src/services/storage.service", () => ({
  put: jest.fn(),
}));
jest.mock("../../../src/services/media-compression.service", () => ({
  compressUpload: jest.fn(),
  normalizeImageInput: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));

const repo = require("../../../src/modules/landing_studio/landing.repo");
const configRepo = require("../../../src/modules/business_setup/business-config.repo");
const service = require("../../../src/modules/landing_studio/landing.service");

const publishedRow = (config) => ({
  business_key: "faitlynhair",
  is_published: true,
  published_config: config,
});

describe("landing.service.getPublished — brand identity overlay", () => {
  beforeEach(() => jest.clearAllMocks());

  test("business_config domains win over the stored snapshot", async () => {
    repo.findPublished.mockResolvedValueOnce(
      publishedRow({
        domain: "sales.retired-domain.test",
        storefront: "https://retired-domain.test",
      }),
    );
    configRepo.findPublicIdentity.mockResolvedValueOnce({
      business_key: "faitlynhair",
      sales_subdomain: "sales.faitlynhair.com",
      storefront_domain: "faitlynhair.com",
      website: null,
    });
    const out = await service.getPublished({ brand: "faitlynhair" });
    expect(out.domain).toBe("sales.faitlynhair.com");
    expect(out.storefront).toBe("https://faitlynhair.com");
  });

  test("keeps stored values when business_config has no domains", async () => {
    repo.findPublished.mockResolvedValueOnce(
      publishedRow({
        domain: "sales.kept.test",
        storefront: "https://kept.test",
      }),
    );
    configRepo.findPublicIdentity.mockResolvedValueOnce({
      business_key: "faitlynhair",
      sales_subdomain: null,
      storefront_domain: null,
      website: null,
    });
    const out = await service.getPublished({ brand: "faitlynhair" });
    expect(out.domain).toBe("sales.kept.test");
    expect(out.storefront).toBe("https://kept.test");
  });

  test("falls back to website when storefront_domain is unset", async () => {
    repo.findPublished.mockResolvedValueOnce(publishedRow({}));
    configRepo.findPublicIdentity.mockResolvedValueOnce({
      business_key: "faitlynhair",
      sales_subdomain: "sales.faitlynhair.com",
      storefront_domain: null,
      website: "faitlynhair.com/",
    });
    const out = await service.getPublished({ brand: "faitlynhair" });
    expect(out.storefront).toBe("https://faitlynhair.com");
  });

  test("overlay failure is non-fatal — stored config still serves", async () => {
    repo.findPublished.mockResolvedValueOnce(
      publishedRow({
        domain: "sales.kept.test",
        storefront: "https://kept.test",
      }),
    );
    configRepo.findPublicIdentity.mockRejectedValueOnce(new Error("db down"));
    const out = await service.getPublished({ brand: "faitlynhair" });
    expect(out.domain).toBe("sales.kept.test");
    expect(out.storefront).toBe("https://kept.test");
  });
});
