"use strict";

/**
 * URL helpers behind the Instagram link-button fallback: extraction of
 * URLs from a message body, stripping them back out of the prose, and
 * picking a ≤20-char button title Meta will accept.
 */

const {
  extractUrls,
  stripUrls,
  buttonTitleForUrl,
} = require("../../../src/utils/urls");

describe("extractUrls", () => {
  test("finds a single https URL in prose", () => {
    expect(
      extractUrls("Styling tips here: https://youtu.be/abc123 enjoy!"),
    ).toEqual(["https://youtu.be/abc123"]);
  });

  test("strips trailing sentence punctuation glued onto the URL", () => {
    expect(extractUrls("Watch https://youtu.be/abc123.")).toEqual([
      "https://youtu.be/abc123",
    ]);
    expect(extractUrls("(see https://example.com/page)")).toEqual([
      "https://example.com/page",
    ]);
  });

  test("keeps multiple URLs in order and de-duplicates", () => {
    const urls = extractUrls(
      "One https://a.example/x two https://b.example/y again https://a.example/x",
    );
    expect(urls).toEqual(["https://a.example/x", "https://b.example/y"]);
  });

  test("returns [] for text without links / empty input", () => {
    expect(extractUrls("no links here")).toEqual([]);
    expect(extractUrls("")).toEqual([]);
    expect(extractUrls(null)).toEqual([]);
  });

  test("survives the real onboarding-form message", () => {
    const body =
      "Welcome 🌹 Could you fill in this quick form (60 sec):\n\n" +
      "https://hub.pixiegirlglobal.com/welcome/faitlynhair/qFe_SS7rW9_kxjL9Q";
    expect(extractUrls(body)).toEqual([
      "https://hub.pixiegirlglobal.com/welcome/faitlynhair/qFe_SS7rW9_kxjL9Q",
    ]);
  });
});

describe("stripUrls", () => {
  test("removes the URL and tidies leftover whitespace", () => {
    const text = "Watch this:\n\nhttps://youtu.be/abc123\n\nLet me know!";
    expect(stripUrls(text, ["https://youtu.be/abc123"])).toBe(
      "Watch this:\n\nLet me know!",
    );
  });

  test("leaves text without the URL untouched", () => {
    expect(stripUrls("hello there", [])).toBe("hello there");
  });
});

describe("buttonTitleForUrl", () => {
  test("labels YouTube links", () => {
    expect(buttonTitleForUrl("https://youtu.be/abc")).toBe("Watch on YouTube");
    expect(buttonTitleForUrl("https://www.youtube.com/watch?v=x")).toBe(
      "Watch on YouTube",
    );
  });

  test("labels the hub's own link surfaces by path", () => {
    expect(
      buttonTitleForUrl("https://hub.pixiegirlglobal.com/welcome/faitlynhair/tok"),
    ).toBe("Open the form");
    expect(
      buttonTitleForUrl("https://hub.pixiegirlglobal.com/order/capture/tok"),
    ).toBe("Order here");
    expect(buttonTitleForUrl("https://pixiegirlglobal.com/pay/tok")).toBe(
      "Pay here",
    );
  });

  test("falls back to the hostname, capped at Meta's 20 chars", () => {
    const title = buttonTitleForUrl(
      "https://a-very-long-subdomain.example-domain.com/x",
    );
    expect(title.length).toBeLessThanOrEqual(20);
  });

  test("never throws on malformed input", () => {
    expect(buttonTitleForUrl("not a url")).toBe("Open link");
  });
});
