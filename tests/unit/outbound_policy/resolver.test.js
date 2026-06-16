"use strict";

/**
 * Unit tests for the outbound_policy channel resolver. The resolver is
 * the small but critical piece that decides whether a notification
 * goes WhatsApp (₦), email (free), or nothing at all. We mock the DB
 * so the test stays hermetic.
 */

jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));

const { query } = require("../../../src/config/database");
const repo = require("../../../src/modules/outbound_policy/outbound-policy.repo");

function mockOnce(row) {
  query.mockResolvedValueOnce({ rows: row ? [row] : [] });
}

describe("outbound_policy.resolveChannel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns email default when no policy row exists", async () => {
    mockOnce(null);
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "unknown_event",
    });
    expect(r).toEqual({
      channel: "email",
      reason: "no_policy_default_email",
    });
  });

  test("respects contact preferred_channel when policy says respect_contact_pref", async () => {
    mockOnce({
      channel_preference: "respect_contact_pref",
      fallback_channel: "email",
      block_whatsapp: false,
      is_active: true,
      preferred_channel: "instagram",
    });
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "order_shipped",
      contact_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.channel).toBe("instagram");
    expect(r.reason).toBe("contact_preference");
  });

  test("falls back when respect_contact_pref but no contact preference", async () => {
    mockOnce({
      channel_preference: "respect_contact_pref",
      fallback_channel: "email",
      block_whatsapp: false,
      is_active: true,
      preferred_channel: null,
    });
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "order_shipped",
      contact_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(r.channel).toBe("email");
    expect(r.reason).toBe("fallback_no_preference");
  });

  test("hard block: never sends WhatsApp marketing even if it's the preference", async () => {
    mockOnce({
      channel_preference: "respect_contact_pref",
      fallback_channel: "email",
      block_whatsapp: true,
      is_active: true,
      preferred_channel: "whatsapp",
    });
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "marketing_blast",
      contact_id: "c1",
    });
    expect(r.channel).toBe("email");
    expect(r.reason).toBe("whatsapp_blocked_fallback");
  });

  test("contact opted out (preferred_channel = none) always returns disabled", async () => {
    mockOnce({
      channel_preference: "whatsapp",
      fallback_channel: "email",
      block_whatsapp: false,
      is_active: true,
      preferred_channel: "none",
    });
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "payment_reminder",
      contact_id: "c1",
    });
    expect(r.channel).toBe("disabled");
    expect(r.reason).toBe("contact_do_not_contact");
  });

  test("inactive policy short-circuits to disabled", async () => {
    mockOnce({
      channel_preference: "whatsapp",
      fallback_channel: "email",
      block_whatsapp: false,
      is_active: false,
      preferred_channel: null,
    });
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "newsletter",
    });
    expect(r.channel).toBe("disabled");
    expect(r.reason).toBe("policy_inactive");
  });

  test("plain WhatsApp policy passes through when not blocked", async () => {
    mockOnce({
      channel_preference: "whatsapp",
      fallback_channel: "email",
      block_whatsapp: false,
      is_active: true,
      preferred_channel: null,
    });
    const r = await repo.resolveChannel({
      brand: "pixiegirl",
      event_key: "out_for_delivery",
    });
    expect(r.channel).toBe("whatsapp");
    expect(r.reason).toBe("policy_default");
  });
});
