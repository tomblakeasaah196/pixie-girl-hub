"use strict";

const { isStaticAssetPath } = require("../../../src/utils/spa-fallback");

// A base64url JWT (header.payload.signature). The signature alphabet is
// A-Za-z0-9-_; ~26% of real signatures contain NO '-' or '_' and the old
// SPA fallback 404'd exactly those links.
const jwt = (sig) =>
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMiLCJsaW5rX2lkIjoieHl6In0.${sig}`;

describe("isStaticAssetPath — SPA fallback routing decision", () => {
  describe("token-in-path public routes must ALWAYS serve the SPA", () => {
    // The two shapes that matter: a signature WITH a base64url special
    // char, and one WITHOUT (all-alphanumeric) — the latter is what the
    // old regex mistook for a `.<ext>` file and 404'd.
    const sigs = {
      "pure-alnum signature (the 26% that used to 404)":
        "abc123DEF456ghi789JKL012mno345PQR678stu901VWX",
      "signature ending in a real-looking ext-length run":
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOpng",
      "signature with an underscore": "wU0lKQpnM2MkYrprtfJu98YLaniBkyUSZyhDnCboH_w",
      "signature with a dash": "wU0lKQpnM2MkYrprtfJu98YLaniBkyUSZyhDnCboH-x",
    };
    for (const [label, sig] of Object.entries(sigs)) {
      test(`/order/capture — ${label}`, () => {
        expect(isStaticAssetPath(`/order/capture/${jwt(sig)}`)).toBe(false);
      });
    }

    test("all sibling token routes (welcome/sign/offer) are unaffected too", () => {
      const badSig = "abc123DEF456ghi789JKL012mno345PQR678stu901VWX";
      expect(isStaticAssetPath(`/welcome/faitlynhair/${jwt(badSig)}`)).toBe(
        false,
      );
      expect(isStaticAssetPath(`/sign/${jwt(badSig)}`)).toBe(false);
      expect(isStaticAssetPath(`/offer/${jwt(badSig)}`)).toBe(false);
      expect(isStaticAssetPath("/verify/ABC123DEF456")).toBe(false);
    });
  });

  describe("plain SPA routes serve the shell", () => {
    for (const p of [
      "/",
      "/smartcomm",
      "/sales/orders/1234",
      "/settings/appearance",
      "/order/capture", // no token yet
    ]) {
      test(p, () => expect(isStaticAssetPath(p)).toBe(false));
    }
  });

  describe("real static-asset requests still fall through to 404", () => {
    for (const p of [
      "/assets/index-a1b2c3d4.js",
      "/assets/vendor-9f8e7d.css",
      "/assets/logo-abc.svg",
      "/favicon.ico",
      "/manifest.webmanifest",
      "/sw.js",
      "/robots.txt",
      "/apple-touch-icon.png",
      "/fonts/Inter.woff2",
    ]) {
      test(p, () => expect(isStaticAssetPath(p)).toBe(true));
    }
  });

  describe("guards", () => {
    test("non-string / empty input is not an asset", () => {
      expect(isStaticAssetPath("")).toBe(false);
      expect(isStaticAssetPath(undefined)).toBe(false);
      expect(isStaticAssetPath(null)).toBe(false);
    });
    test("a dot in a NON-final segment never counts as an extension", () => {
      // e.g. a JWT header segment carries a dot boundary but the filename
      // decision only looks at the final segment.
      expect(isStaticAssetPath("/order/capture/a.b.plaintextsegment")).toBe(
        false,
      );
    });
  });
});
