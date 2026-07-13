"use strict";

/**
 * storage.toAbsoluteMediaUrl — turns a stored-media reference (bare key,
 * relative `/media/...` path, or already-absolute URL) into an absolute
 * URL that an external provider (Instagram DM media) can fetch. Regression
 * for the catalogue-share bug: a relative cdn_url was handed to Meta,
 * which can't resolve it, so every catalogue image bounced with
 * "Upload failed — code 100 — subcode 2018007".
 */

// Mutable config the storage service reads at call time.
const mockCfg = { ADMIN_BASE_URL: undefined, CDN_BASE_URL: undefined };
jest.mock("../../../src/config/env", () => ({ config: mockCfg }));

const storage = require("../../../src/services/storage.service");

beforeEach(() => {
  mockCfg.ADMIN_BASE_URL = undefined;
  mockCfg.CDN_BASE_URL = undefined;
});

describe("toAbsoluteMediaUrl", () => {
  test("relative /media/ path becomes absolute via ADMIN_BASE_URL", () => {
    mockCfg.ADMIN_BASE_URL = "https://hub.pixiegirlglobal.com";
    expect(
      storage.toAbsoluteMediaUrl(
        "/media/storefront/faitlynhair/369d26075d869e813c2c9f6a.webp",
      ),
    ).toBe(
      "https://hub.pixiegirlglobal.com/media/storefront/faitlynhair/369d26075d869e813c2c9f6a.webp",
    );
  });

  test("an already-absolute URL passes through unchanged", () => {
    mockCfg.ADMIN_BASE_URL = "https://hub.pixiegirlglobal.com";
    const url = "https://cdn.example.com/x/y.jpg";
    expect(storage.toAbsoluteMediaUrl(url)).toBe(url);
  });

  test("a bare storage key resolves against the base", () => {
    mockCfg.ADMIN_BASE_URL = "https://hub.pixiegirlglobal.com";
    expect(storage.toAbsoluteMediaUrl("storefront/x.webp")).toBe(
      "https://hub.pixiegirlglobal.com/media/storefront/x.webp",
    );
  });

  test("CDN_BASE_URL wins when configured", () => {
    mockCfg.CDN_BASE_URL = "https://cdn.pixie.com";
    mockCfg.ADMIN_BASE_URL = "https://hub.pixiegirlglobal.com";
    expect(storage.toAbsoluteMediaUrl("/media/a/b.webp")).toBe(
      "https://cdn.pixie.com/a/b.webp",
    );
  });

  test("trailing slash on the base doesn't double up", () => {
    mockCfg.ADMIN_BASE_URL = "https://hub.pixiegirlglobal.com/";
    expect(storage.toAbsoluteMediaUrl("/media/a.webp")).toBe(
      "https://hub.pixiegirlglobal.com/media/a.webp",
    );
  });

  test("with no base configured, the original value is returned (no worse than before)", () => {
    expect(storage.toAbsoluteMediaUrl("/media/a.webp")).toBe("/media/a.webp");
  });

  test("null / empty input is passed through", () => {
    expect(storage.toAbsoluteMediaUrl(null)).toBeNull();
    expect(storage.toAbsoluteMediaUrl("")).toBe("");
  });
});
