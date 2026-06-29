"use strict";

/**
 * Quiet-hours + frequency-cap suppression (§6.23). Pure time logic is tested
 * directly; checkEmail is tested with the ledger count mocked.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));

const { query } = require("../../../src/config/database");
const suppression = require("../../../src/modules/retention/strategy.suppression");

const at = (iso) => new Date(iso);

describe("strategy.suppression quiet hours", () => {
  const settings = suppression.resolveSettings(null); // defaults: 21→8 Lagos

  test("isQuietHours flags the night window (Africa/Lagos = UTC+1)", () => {
    // 23:00 UTC == 00:00 Lagos → quiet.
    expect(suppression.isQuietHours(settings, at("2026-06-29T23:00:00Z"))).toBe(true);
    // 12:00 UTC == 13:00 Lagos → not quiet.
    expect(suppression.isQuietHours(settings, at("2026-06-29T12:00:00Z"))).toBe(false);
  });

  test("nextActiveTime moves out of the quiet window", () => {
    const t = suppression.nextActiveTime(settings, at("2026-06-29T23:00:00Z"));
    expect(suppression.isQuietHours(settings, t)).toBe(false);
  });
});

describe("strategy.suppression.checkEmail", () => {
  const daytime = at("2026-06-29T12:00:00Z"); // 13:00 Lagos

  test("sends when under the cap during active hours", async () => {
    query.mockResolvedValueOnce({ rows: [{ c: 1 }] });
    const d = await suppression.checkEmail({
      brand: "pixiegirl",
      contact_id: "c1",
      businessConfig: null,
      now: daytime,
    });
    expect(d.action).toBe("send");
  });

  test("suppresses when the cap is reached", async () => {
    query.mockResolvedValueOnce({ rows: [{ c: 3 }] });
    const d = await suppression.checkEmail({
      brand: "pixiegirl",
      contact_id: "c1",
      businessConfig: null,
      now: daytime,
    });
    expect(d.action).toBe("suppress");
  });

  test("defers during quiet hours without hitting the ledger", async () => {
    const d = await suppression.checkEmail({
      brand: "pixiegirl",
      contact_id: "c1",
      businessConfig: null,
      now: at("2026-06-29T23:00:00Z"),
    });
    expect(d.action).toBe("defer");
    expect(d.defer_until).toBeInstanceOf(Date);
  });

  test("owner overrides merge over defaults", () => {
    const s = suppression.resolveSettings({ retention_settings: { max_emails_per_window: 1 } });
    expect(s.max_emails_per_window).toBe(1);
    expect(s.window_days).toBe(suppression.DEFAULTS.window_days);
  });
});
