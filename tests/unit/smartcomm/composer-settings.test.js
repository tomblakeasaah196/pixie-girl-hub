"use strict";

/**
 * Composer settings — the editable per-brand stock messages (Online
 * welcome form + WhatsApp handoff) and the WhatsApp share number.
 * Verifies default fallbacks, the "is custom" flags, the number falling
 * back to the brand's Business-Setup phone, and empty-string → null
 * normalisation on save.
 */

jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  getComposerSettings: jest.fn(),
  upsertComposerSettings: jest.fn(async () => ({})),
  getBrandPhone: jest.fn(),
}));
jest.mock("../../../src/modules/smartcomm/smartcomm.events", () => ({
  emit: jest.fn(),
  on: jest.fn(),
}));
jest.mock("../../../src/jobs/queue-producer", () => ({
  enqueue: jest.fn(),
}));
jest.mock("../../../src/middleware/audit", () => ({ audit: jest.fn() }));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async () => ({ rows: [] })),
  ex: jest.fn(),
}));

const repo = require("../../../src/modules/smartcomm/smartcomm.repo");
const service = require("../../../src/modules/smartcomm/smartcomm.service");

beforeEach(() => jest.clearAllMocks());

describe("getComposerSettings", () => {
  test("returns code defaults + Business-Setup phone when no row exists", async () => {
    repo.getComposerSettings.mockResolvedValueOnce(null);
    repo.getBrandPhone.mockResolvedValueOnce("+2348010000000");

    const s = await service.getComposerSettings({ brand: "faitlynhair" });

    expect(s.onboarding_template).toContain("{link}");
    expect(s.whatsapp_handoff_template).toContain("{number}");
    expect(s.whatsapp_share_number).toBe("+2348010000000");
    expect(s.onboarding_is_custom).toBe(false);
    expect(s.whatsapp_is_custom).toBe(false);
    expect(s.whatsapp_number_is_custom).toBe(false);
  });

  test("prefers the saved templates + explicit number and flags them custom", async () => {
    repo.getComposerSettings.mockResolvedValueOnce({
      onboarding_template: "Hey love, form here 👉 {link}",
      whatsapp_handoff_template: "Ping us on WA: {number}",
      whatsapp_share_number: "+2349099999999",
    });
    repo.getBrandPhone.mockResolvedValueOnce("+2348010000000");

    const s = await service.getComposerSettings({ brand: "faitlynhair" });

    expect(s.onboarding_template).toBe("Hey love, form here 👉 {link}");
    expect(s.whatsapp_share_number).toBe("+2349099999999");
    expect(s.onboarding_is_custom).toBe(true);
    expect(s.whatsapp_is_custom).toBe(true);
    expect(s.whatsapp_number_is_custom).toBe(true);
  });

  test("number is null (not a default template) when neither override nor phone is set", async () => {
    repo.getComposerSettings.mockResolvedValueOnce(null);
    repo.getBrandPhone.mockResolvedValueOnce(null);

    const s = await service.getComposerSettings({ brand: "pixiegirl" });
    expect(s.whatsapp_share_number).toBeNull();
  });
});

describe("updateComposerSettings", () => {
  test("passes edited templates through and re-reads the resolved settings", async () => {
    repo.getComposerSettings.mockResolvedValue({
      onboarding_template: "New wording {link}",
      whatsapp_handoff_template: null,
      whatsapp_share_number: null,
    });
    repo.getBrandPhone.mockResolvedValue("+2348010000000");

    await service.updateComposerSettings({
      brand: "faitlynhair",
      user: { user_id: "u1" },
      request_id: "r1",
      input: { onboarding_template: "New wording {link}" },
    });

    expect(repo.upsertComposerSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        brand: "faitlynhair",
        user_id: "u1",
        patch: { onboarding_template: "New wording {link}" },
      }),
    );
  });

  test("normalises an empty string to null (clears the override)", async () => {
    repo.getComposerSettings.mockResolvedValue(null);
    repo.getBrandPhone.mockResolvedValue(null);

    await service.updateComposerSettings({
      brand: "faitlynhair",
      user: { user_id: "u1" },
      request_id: "r1",
      input: { whatsapp_handoff_template: "   " },
    });

    expect(repo.upsertComposerSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { whatsapp_handoff_template: null },
      }),
    );
  });
});
