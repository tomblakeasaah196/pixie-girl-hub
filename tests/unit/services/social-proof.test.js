"use strict";

/**
 * Social proof service (social-proof.service.js) — the pure parts only:
 * platform detection from a pasted URL, and the soft handle-match check.
 * fetchOEmbed itself makes real HTTP calls and is exercised in integration
 * tests / manually, not here.
 */

const {
  detectPlatform,
  matchesRegisteredHandle,
} = require("../../../src/services/social-proof.service");

describe("detectPlatform", () => {
  test("recognises all four supported platforms", () => {
    expect(detectPlatform("https://www.instagram.com/reel/abc123/")).toBe(
      "instagram",
    );
    expect(
      detectPlatform("https://www.facebook.com/PixieGirlGlobal/posts/123"),
    ).toBe("facebook");
    expect(detectPlatform("https://fb.watch/abc123/")).toBe("facebook");
    expect(
      detectPlatform("https://www.tiktok.com/@pixiegirlglobal/video/123"),
    ).toBe("tiktok");
    expect(detectPlatform("https://www.youtube.com/watch?v=abc123")).toBe(
      "youtube",
    );
    expect(detectPlatform("https://youtu.be/abc123")).toBe("youtube");
  });

  test("returns null for an unsupported host or a malformed URL", () => {
    expect(detectPlatform("https://twitter.com/pixiegirl/status/1")).toBeNull();
    expect(detectPlatform("not a url")).toBeNull();
  });
});

describe("matchesRegisteredHandle", () => {
  const accounts = [{ handle: "pixiegirlglobal" }, { handle: "FaitlynHair" }];

  test("matches case-insensitively", () => {
    expect(matchesRegisteredHandle("PixieGirlGlobal", accounts)).toBe(true);
    expect(matchesRegisteredHandle("faitlynhair", accounts)).toBe(true);
  });

  test("false for a handle that isn't registered", () => {
    expect(matchesRegisteredHandle("someone_else", accounts)).toBe(false);
  });

  test("nothing to compare against -> treated as a match (nothing to flag)", () => {
    expect(matchesRegisteredHandle("anyone", [])).toBe(true);
    expect(matchesRegisteredHandle(null, accounts)).toBe(true);
  });
});
