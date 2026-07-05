"use strict";

/**
 * Boot-time GEMINI_BASE_URL guard. A .env override with a plausible-but-wrong
 * host (e.g. gemini.api.google.com) makes every Gemini call die with
 * getaddrinfo ENOTFOUND before it leaves the server — an invisible, uniform
 * 503 across every AI feature. checkConfigAtBoot must catch that and log
 * loudly (error), without ever throwing.
 *
 * The real `config` is a Proxy that validates the ENTIRE environment on first
 * access (and process.exit(1)s on a missing var), so we mock env + logger to
 * exercise the guard in isolation, mirroring how other unit tests mock
 * config/database.
 */

const mockConfig = { GEMINI_API_KEY: "test-key", GEMINI_BASE_URL: "" };
jest.mock("../../../src/config/env", () => ({
  config: mockConfig,
  validateEnv: jest.fn(),
}));
jest.mock("../../../src/config/logger", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const { logger } = require("../../../src/config/logger");
const gemini = require("../../../src/services/gemini.service");

beforeEach(() => {
  jest.clearAllMocks();
  mockConfig.GEMINI_API_KEY = "test-key";
  mockConfig.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
});

describe("gemini checkConfigAtBoot", () => {
  test("stays quiet on the correct Google host", () => {
    mockConfig.GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
    expect(() => gemini.checkConfigAtBoot()).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test("logs an error for the classic wrong host (gemini.api.google.com)", () => {
    mockConfig.GEMINI_BASE_URL = "https://gemini.api.google.com";
    gemini.checkConfigAtBoot();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toMatchObject({ host: "gemini.api.google.com" });
  });

  test("logs an error when GEMINI_BASE_URL isn't a valid URL", () => {
    mockConfig.GEMINI_BASE_URL = "not-a-url";
    gemini.checkConfigAtBoot();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("warns (not errors) when no API key is configured", () => {
    mockConfig.GEMINI_API_KEY = "";
    mockConfig.GEMINI_BASE_URL = "https://gemini.api.google.com";
    gemini.checkConfigAtBoot();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test("never throws, whatever the value", () => {
    for (const v of ["", "https://example.com", "ftp://x", "generativelanguage.googleapis.com"]) {
      mockConfig.GEMINI_BASE_URL = v;
      expect(() => gemini.checkConfigAtBoot()).not.toThrow();
    }
  });
});
