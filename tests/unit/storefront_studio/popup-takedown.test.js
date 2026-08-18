"use strict";

/**
 * A popup an operator has "deactivated" must actually leave the website.
 *
 * The bug this guards: `is_active` lives on the DRAFT row, so switching the
 * Active toggle off and saving never changed what the public /site endpoint
 * served — the published row kept serving the popup, with no way to pull it
 * short of deleting the popup outright. `unpublishPopup` archives the
 * published row, which is what actually takes it off the site.
 */

jest.mock("sharp", () => jest.fn());
jest.mock("../../../src/modules/storefront_studio/studio.repo");
jest.mock("../../../src/config/database", () => ({
  transaction: (fn) => fn({}),
  query: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/services/storage.service", () => ({ put: jest.fn() }));
jest.mock("../../../src/services/media-compression.service", () => ({
  compressUpload: jest.fn(),
  normalizeImageInput: jest.fn(),
}));

const repo = require("../../../src/modules/storefront_studio/studio.repo");
const { audit } = require("../../../src/middleware/audit");
const service = require("../../../src/modules/storefront_studio/studio.service");

const user = { user_id: "u-1" };
const args = {
  brand: "faitlynhair",
  user,
  request_id: "req-1",
  popup_key: "newsletter",
};

describe("studio.service.unpublishPopup", () => {
  beforeEach(() => jest.clearAllMocks());

  test("archives the published row so the site stops serving it", async () => {
    repo.unpublishPopup.mockResolvedValue({
      popup_id: "p-1",
      popup_key: "newsletter",
      status: "archived",
    });

    const out = await service.unpublishPopup(args);

    expect(repo.unpublishPopup).toHaveBeenCalledWith({
      client: {},
      brand: "faitlynhair",
      popup_key: "newsletter",
    });
    expect(out.status).toBe("archived");
  });

  test("writes an audit entry naming the popup", async () => {
    repo.unpublishPopup.mockResolvedValue({
      popup_id: "p-1",
      popup_key: "newsletter",
    });

    await service.unpublishPopup(args);

    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action_key: "studio.popup.unpublish",
        target_type: "storefront_popup",
        target_id: "p-1",
        business: "faitlynhair",
        after: { popup_key: "newsletter" },
      }),
    );
  });

  test("404s when nothing is live for that key (never silently succeeds)", async () => {
    repo.unpublishPopup.mockResolvedValue(null);

    await expect(service.unpublishPopup(args)).rejects.toThrow(
      /Published popup/i,
    );
  });

  test("leaves the draft alone — take down is not delete", async () => {
    repo.unpublishPopup.mockResolvedValue({ popup_id: "p-1" });

    await service.unpublishPopup(args);

    expect(repo.deletePopup).not.toHaveBeenCalled();
  });
});
