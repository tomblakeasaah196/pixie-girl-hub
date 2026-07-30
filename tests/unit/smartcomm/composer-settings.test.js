"use strict";

/**
 * Composer settings — the editable per-brand stock messages (Online
 * welcome form, WhatsApp handoff, our address, our working hours) plus the
 * WhatsApp share number. Verifies default fallbacks, the "is custom"
 * flags, the number/address falling back to the brand's Business-Setup
 * values, the seeded working hours, and empty-string → null normalisation
 * on save.
 */

jest.mock("../../../src/modules/smartcomm/smartcomm.repo", () => ({
  getComposerSettings: jest.fn(),
  upsertComposerSettings: jest.fn(async () => ({})),
  getBrandContact: jest.fn(async () => ({ phone: null, address: null })),
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
  test("returns code defaults + Business-Setup phone/address when no row exists", async () => {
    repo.getComposerSettings.mockResolvedValueOnce(null);
    repo.getBrandContact.mockResolvedValueOnce({
      phone: "+2348010000000",
      address: "12 Adeola Odeku St, Victoria Island, Lagos",
    });

    const s = await service.getComposerSettings({ brand: "faitlynhair" });

    expect(s.onboarding_template).toContain("{link}");
    expect(s.whatsapp_handoff_template).toContain("{number}");
    expect(s.address_template).toContain("{address}");
    expect(s.hours_template).toContain("{hours}");
    expect(s.whatsapp_share_number).toBe("+2348010000000");
    // The address is seeded from Settings → Business Setup, never invented.
    expect(s.address_share_text).toBe(
      "12 Adeola Odeku St, Victoria Island, Lagos",
    );
    // business_config has no hours column — this is the seeded first answer.
    expect(s.hours_share_text).toBe("Monday to Saturday, 9:00 AM – 8:00 PM");
    expect(s.onboarding_is_custom).toBe(false);
    expect(s.whatsapp_is_custom).toBe(false);
    expect(s.whatsapp_number_is_custom).toBe(false);
    expect(s.address_is_custom).toBe(false);
    expect(s.address_text_is_custom).toBe(false);
    expect(s.hours_is_custom).toBe(false);
    expect(s.hours_text_is_custom).toBe(false);
  });

  test("prefers the saved templates + explicit number and flags them custom", async () => {
    repo.getComposerSettings.mockResolvedValueOnce({
      onboarding_template: "Hey love, form here 👉 {link}",
      whatsapp_handoff_template: "Ping us on WA: {number}",
      whatsapp_share_number: "+2349099999999",
    });
    repo.getBrandContact.mockResolvedValueOnce({
      phone: "+2348010000000",
      address: null,
    });

    const s = await service.getComposerSettings({ brand: "faitlynhair" });

    expect(s.onboarding_template).toBe("Hey love, form here 👉 {link}");
    expect(s.whatsapp_share_number).toBe("+2349099999999");
    expect(s.onboarding_is_custom).toBe(true);
    expect(s.whatsapp_is_custom).toBe(true);
    expect(s.whatsapp_number_is_custom).toBe(true);
  });

  test("prefers the saved address + hours wording and flags them custom", async () => {
    repo.getComposerSettings.mockResolvedValueOnce({
      address_template: "We're at {address} — see you soon!",
      address_share_text: "Shop 4, Ikeja City Mall, Lagos",
      hours_template: "Open {hours} 🕘",
      hours_share_text: "Monday to Friday, 10:00 AM – 6:00 PM",
    });
    repo.getBrandContact.mockResolvedValueOnce({
      phone: null,
      // The saved override wins over the Business-Setup address.
      address: "12 Adeola Odeku St, Victoria Island, Lagos",
    });

    const s = await service.getComposerSettings({ brand: "pixiegirl" });

    expect(s.address_template).toBe("We're at {address} — see you soon!");
    expect(s.address_share_text).toBe("Shop 4, Ikeja City Mall, Lagos");
    expect(s.hours_template).toBe("Open {hours} 🕘");
    expect(s.hours_share_text).toBe("Monday to Friday, 10:00 AM – 6:00 PM");
    expect(s.address_is_custom).toBe(true);
    expect(s.address_text_is_custom).toBe(true);
    expect(s.hours_is_custom).toBe(true);
    expect(s.hours_text_is_custom).toBe(true);
  });

  test("number/address are null (not a default) when nothing is set anywhere", async () => {
    repo.getComposerSettings.mockResolvedValueOnce(null);
    repo.getBrandContact.mockResolvedValueOnce({ phone: null, address: null });

    const s = await service.getComposerSettings({ brand: "pixiegirl" });
    expect(s.whatsapp_share_number).toBeNull();
    // The composer tells the operator to fill Business Setup in rather than
    // inserting a message with a hole where the address should be.
    expect(s.address_share_text).toBeNull();
  });
});

describe("updateComposerSettings", () => {
  test("passes edited templates through and re-reads the resolved settings", async () => {
    repo.getComposerSettings.mockResolvedValue({
      onboarding_template: "New wording {link}",
      whatsapp_handoff_template: null,
      whatsapp_share_number: null,
    });
    repo.getBrandContact.mockResolvedValue({
      phone: "+2348010000000",
      address: null,
    });

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

  test("saves an edited address / hours wording as the new default", async () => {
    repo.getComposerSettings.mockResolvedValue(null);
    repo.getBrandContact.mockResolvedValue({ phone: null, address: null });

    await service.updateComposerSettings({
      brand: "pixiegirl",
      user: { user_id: "u1" },
      request_id: "r1",
      input: {
        address_template: "Find us at {address} 📍",
        hours_share_text: "Monday to Saturday, 9:00 AM – 7:00 PM",
      },
    });

    expect(repo.upsertComposerSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: {
          address_template: "Find us at {address} 📍",
          hours_share_text: "Monday to Saturday, 9:00 AM – 7:00 PM",
        },
      }),
    );
  });

  test("normalises an empty string to null (clears the override)", async () => {
    repo.getComposerSettings.mockResolvedValue(null);
    repo.getBrandContact.mockResolvedValue({ phone: null, address: null });

    await service.updateComposerSettings({
      brand: "faitlynhair",
      user: { user_id: "u1" },
      request_id: "r1",
      input: { whatsapp_handoff_template: "   ", hours_template: "" },
    });

    expect(repo.upsertComposerSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: { whatsapp_handoff_template: null, hours_template: null },
      }),
    );
  });
});
