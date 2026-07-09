"use strict";

/**
 * Boot-time Gemini config guard. A .env / AI Control endpoint with a
 * plausible-but-wrong host (e.g. gemini.api.google.com — the exact typo
 * that caused the Jul 2026 storefront outage) makes every Gemini call
 * die with getaddrinfo ENOTFOUND before it leaves the server.
 *
 * checkConfigAtBoot must catch that and log loudly (error), without
 * ever throwing. It's now async because vendor resolution reads the DB
 * first — but any exception in the resolver is caught internally.
 */

const mockConfig = {
  GEMINI_API_KEY: "test-key",
  GEMINI_BASE_URL: "https://generativelanguage.googleapis.com",
  GEMINI_MODEL: "gemini-2.5-flash",
};
jest.mock("../../../src/config/env", () => ({
  config: mockConfig,
  validateEnv: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
// Simulate no AI Control row so the resolver falls back to env.
jest.mock("../../../src/modules/ai_governance/governance.service", () => ({
  getVendorConfig: jest.fn().mockResolvedValue(null),
}));

const { logger } = require("../../../src/config/logger");
const gemini = require("../../../src/services/gemini.service");

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.GEMINI_API_KEY = "test-key";
  mockConfig.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
});

describe("gemini checkConfigAtBoot (post-Jul-2026 outage guard)", () => {
  test("logs INFO on the correct Google host", async () => {
    await gemini.checkConfigAtBoot();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  test("logs an error for the classic wrong host (gemini.api.google.com)", async () => {
    mockConfig.GEMINI_BASE_URL = "https://gemini.api.google.com/v1";
    await gemini.checkConfigAtBoot();
    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      host: "gemini.api.google.com",
    });
  });

  test("logs an error when the endpoint URL isn't a valid URL", async () => {
    mockConfig.GEMINI_BASE_URL = "not-a-url";
    // Zod normally validates URLs — but AI Control rows are free-form
    // for self-hosted vendors, so the guard still handles bad values.
    await gemini.checkConfigAtBoot();
    expect(logger.error).toHaveBeenCalled();
  });

  test("warns (not errors) when no API key is configured anywhere", async () => {
    mockConfig.GEMINI_API_KEY = "";
    await gemini.checkConfigAtBoot();
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("never throws, whatever the value", async () => {
    for (const v of [
      "",
      "https://example.com",
      "ftp://x",
      "generativelanguage.googleapis.com",
    ]) {
      mockConfig.GEMINI_BASE_URL = v;
      await expect(gemini.checkConfigAtBoot()).resolves.toBeUndefined();
    }
  });
});

describe("gemini.resolveVendor (Q1: AI Control primary, .env fallback)", () => {
  const governance = require("../../../src/modules/ai_governance/governance.service");

  test("returns the AI Control row when present", async () => {
    governance.getVendorConfig.mockResolvedValueOnce({
      vendor: "gemini",
      api_key: "db-key",
      endpoint_url: "https://generativelanguage.googleapis.com",
      default_model: "gemini-2.5-flash-lite",
      cost_per_1k_input_tokens: 0.075,
      cost_per_1k_output_tokens: 0.3,
    });
    const v = await gemini.resolveVendor();
    expect(v).toMatchObject({
      source: "db",
      api_key: "db-key",
      default_model: "gemini-2.5-flash-lite",
    });
  });

  test("falls back to .env when no active AI Control row", async () => {
    governance.getVendorConfig.mockResolvedValueOnce(null);
    const v = await gemini.resolveVendor();
    expect(v).toMatchObject({
      source: "env",
      api_key: "test-key",
      endpoint_url: "https://generativelanguage.googleapis.com",
    });
  });

  test("returns null when neither source has a key", async () => {
    mockConfig.GEMINI_API_KEY = "";
    governance.getVendorConfig.mockResolvedValueOnce(null);
    const v = await gemini.resolveVendor();
    expect(v).toBeNull();
  });

  test("falls back to .env when the DB lookup crashes (never takes AI down)", async () => {
    governance.getVendorConfig.mockRejectedValueOnce(
      new Error("encryption key rotated"),
    );
    const v = await gemini.resolveVendor();
    expect(v).toMatchObject({ source: "env", api_key: "test-key" });
  });
});
