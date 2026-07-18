"use strict";

/**
 * Unit tests for the link-preview (unfurl) service — the OG/Twitter metadata
 * fetch behind the messaging module's WhatsApp-style link cards.
 *
 * Focus: the SSRF address guard (the headline risk, since this fetches an
 * arbitrary user-supplied URL), URL validation, HTML metadata extraction, and
 * the best-effort contract (a failed/blocked unfurl resolves to { ok:false },
 * never throws — the UI just keeps the plain clickable link). axios + redis are
 * mocked so nothing hits the network or a live cache.
 */

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockStore = new Map();
jest.mock("../../../src/config/redis", () => ({
  getClient: () => ({
    get: jest.fn(async (k) => (mockStore.has(k) ? mockStore.get(k) : null)),
    set: jest.fn(async (k, v) => {
      mockStore.set(k, v);
      return "OK";
    }),
  }),
}));

const axios = require("axios");
const svc = require("../../../src/services/link-preview.service");

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
});

describe("isBlockedAddress (SSRF guard)", () => {
  it("blocks private / loopback / link-local / reserved v4", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
    ]) {
      expect(svc.isBlockedAddress(ip)).toBe(true);
    }
  });

  it("allows normal public v4", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"]) {
      expect(svc.isBlockedAddress(ip)).toBe(false);
    }
  });

  it("blocks loopback / link-local / unique-local v6 and mapped v4", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12::34", "::ffff:127.0.0.1"]) {
      expect(svc.isBlockedAddress(ip)).toBe(true);
    }
    expect(svc.isBlockedAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks anything that isn't a literal IP", () => {
    expect(svc.isBlockedAddress("not-an-ip")).toBe(true);
    expect(svc.isBlockedAddress("")).toBe(true);
  });
});

describe("parseUrl", () => {
  it("rejects empty, malformed, and non-http schemes", () => {
    expect(() => svc.parseUrl("")).toThrow();
    expect(() => svc.parseUrl("not a url")).toThrow();
    expect(() => svc.parseUrl("file:///etc/passwd")).toThrow();
    expect(() => svc.parseUrl("javascript:alert(1)")).toThrow();
  });

  it("accepts http/https", () => {
    expect(svc.parseUrl("https://example.com/x").hostname).toBe("example.com");
    expect(svc.parseUrl("http://faitlynhair.com").protocol).toBe("http:");
  });
});

describe("parseHtml", () => {
  it("extracts OG tags and absolutises image/favicon", () => {
    const html = `
      <head>
        <title>Fallback Title</title>
        <meta property="og:title" content="Black Friday Sale" />
        <meta property="og:description" content="Up to 50% off wigs &amp; bundles" />
        <meta property="og:image" content="/img/banner.jpg" />
        <meta property="og:site_name" content="Faitlynhair" />
        <link rel="icon" href="/favicon.png" />
      </head>`;
    const p = svc.parseHtml(html, "https://faitlynhair.com/sale/black-friday-sale");
    expect(p.title).toBe("Black Friday Sale");
    expect(p.description).toBe("Up to 50% off wigs & bundles");
    expect(p.image).toBe("https://faitlynhair.com/img/banner.jpg");
    expect(p.site_name).toBe("Faitlynhair");
    expect(p.favicon).toBe("https://faitlynhair.com/favicon.png");
  });

  it("falls back to <title> and twitter tags, defaults site_name to host", () => {
    const html = `<title>Just a title</title>
      <meta name="twitter:description" content="hello" />`;
    const p = svc.parseHtml(html, "https://www.example.com/page");
    expect(p.title).toBe("Just a title");
    expect(p.description).toBe("hello");
    expect(p.site_name).toBe("example.com");
    expect(p.image).toBeNull();
  });
});

describe("getLinkPreview", () => {
  it("returns ok:true with a preview on a good HTML page and caches it", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      data: Buffer.from(
        `<head><meta property="og:title" content="Hi"><meta property="og:image" content="https://x.test/a.png"></head>`,
      ),
      request: { res: { responseUrl: "https://x.test/page" } },
    });

    const r1 = await svc.getLinkPreview("https://x.test/page");
    expect(r1.ok).toBe(true);
    expect(r1.preview.title).toBe("Hi");
    expect(r1.preview.image).toBe("https://x.test/a.png");
    expect(axios.get).toHaveBeenCalledTimes(1);

    // Second call is served from the mocked cache — no second fetch.
    const r2 = await svc.getLinkPreview("https://x.test/page");
    expect(r2.ok).toBe(true);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it("resolves ok:false (never throws) when the fetch fails", async () => {
    axios.get.mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await svc.getLinkPreview("https://x.test/down");
    expect(r).toEqual({ ok: false });
  });

  it("resolves ok:false when the page carries no usable metadata", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: { "content-type": "text/html" },
      data: Buffer.from("<head></head>"),
      request: { res: { responseUrl: "https://x.test/empty" } },
    });
    const r = await svc.getLinkPreview("https://x.test/empty");
    expect(r.ok).toBe(false);
  });

  it("treats a direct image URL as its own preview", async () => {
    axios.get.mockResolvedValue({
      status: 200,
      headers: { "content-type": "image/png" },
      data: Buffer.from(""),
      request: { res: { responseUrl: "https://x.test/photo.png" } },
    });
    const r = await svc.getLinkPreview("https://x.test/photo.png");
    expect(r.ok).toBe(true);
    expect(r.preview.image).toBe("https://x.test/photo.png");
    expect(r.preview.type).toBe("image");
  });

  it("throws on a malformed URL (client error, not a silent miss)", async () => {
    await expect(svc.getLinkPreview("nonsense")).rejects.toThrow();
  });
});
