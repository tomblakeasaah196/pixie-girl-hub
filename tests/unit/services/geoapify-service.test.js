"use strict";

/**
 * Unit tests for the Geoapify service — the ONE server-side integration behind
 * HR clock-in labels + the office-location picker (search / static map).
 *
 * Focus: the best-effort contract (geocoders NEVER throw — a slow/down Geoapify
 * must not break clock-in or a form), correct Geoapify param mapping, and the
 * staticMap clamps/guards. axios is mocked so nothing hits the network.
 */

jest.mock("axios", () => ({ get: jest.fn() }));
jest.mock("../../../src/config/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));
// The key now resolves DB-first (shared.geoapify_settings), env-fallback
// second — see geoapify.service.js's getApiKey(). These tests exercise the
// env-fallback path, so the DB side always resolves null.
jest.mock("../../../src/modules/geoapify_settings/geoapify-settings.service", () => ({
  resolveActiveApiKey: jest.fn().mockResolvedValue(null),
}));

const axios = require("axios");
const geoapify = require("../../../src/services/geoapify.service");

const KEY = "test-geoapify-key";

beforeEach(() => {
  jest.clearAllMocks();
  geoapify.invalidateKeyCache();
  process.env.GEOAPIFY_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.GEOAPIFY_API_KEY;
});

describe("isConfigured", () => {
  it("reflects the presence of the key", async () => {
    await expect(geoapify.isConfigured()).resolves.toBe(true);
    geoapify.invalidateKeyCache();
    delete process.env.GEOAPIFY_API_KEY;
    await expect(geoapify.isConfigured()).resolves.toBe(false);
  });
});

describe("reverseGeocode", () => {
  it("returns the formatted address (format=json shape)", async () => {
    axios.get.mockResolvedValue({ data: { results: [{ formatted: "15 Adeola Odeku, Lagos" }] } });
    await expect(geoapify.reverseGeocode(6.43, 3.42)).resolves.toBe("15 Adeola Odeku, Lagos");
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toContain("/geocode/reverse");
    expect(opts.params).toMatchObject({ lat: 6.43, lon: 3.42, apiKey: KEY });
  });

  it("returns null without a key (and does not call out)", async () => {
    delete process.env.GEOAPIFY_API_KEY;
    await expect(geoapify.reverseGeocode(6.43, 3.42)).resolves.toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("returns null for invalid coordinates", async () => {
    await expect(geoapify.reverseGeocode(null, 3.42)).resolves.toBeNull();
    await expect(geoapify.reverseGeocode("nope", 3.42)).resolves.toBeNull();
    await expect(geoapify.reverseGeocode(120, 3.42)).resolves.toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("never throws — swallows upstream errors and returns null", async () => {
    axios.get.mockRejectedValue(new Error("ETIMEDOUT"));
    await expect(geoapify.reverseGeocode(6.43, 3.42)).resolves.toBeNull();
  });
});

describe("autocomplete", () => {
  it("maps results (lat/lon → lat/lng) and drops invalid rows", async () => {
    axios.get.mockResolvedValue({
      data: {
        results: [
          { formatted: "A", lat: 6.5, lon: 3.4, place_id: "p1", city: "Lagos", country: "Nigeria" },
          { formatted: "B", lat: "nan", lon: 3.4 }, // dropped — bad lat
        ],
      },
    });
    const out = await geoapify.autocomplete("adeola", { lat: 6.5, lng: 3.4 });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ formatted: "A", lat: 6.5, lng: 3.4, place_id: "p1" });
  });

  it("biases by proximity to the supplied coordinates (lon,lat order)", async () => {
    axios.get.mockResolvedValue({ data: { results: [] } });
    await geoapify.autocomplete("victoria island", { lat: 6.4281, lng: 3.4219 });
    const [, opts] = axios.get.mock.calls[0];
    expect(opts.params.bias).toBe("proximity:3.4219,6.4281");
    expect(opts.params.text).toBe("victoria island");
  });

  it("returns [] for a too-short query without calling out", async () => {
    await expect(geoapify.autocomplete("a")).resolves.toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("returns [] without a key", async () => {
    delete process.env.GEOAPIFY_API_KEY;
    await expect(geoapify.autocomplete("lekki")).resolves.toEqual([]);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it("never throws — returns [] on upstream error", async () => {
    axios.get.mockRejectedValue(new Error("boom"));
    await expect(geoapify.autocomplete("lekki")).resolves.toEqual([]);
  });
});

describe("staticMap", () => {
  it("returns image bytes + content type on success", async () => {
    const bytes = Buffer.from([1, 2, 3, 4]);
    axios.get.mockResolvedValue({ data: bytes, headers: { "content-type": "image/png" } });
    const out = await geoapify.staticMap({ lat: 6.5, lng: 3.4, zoom: 16, width: 600, height: 300 });
    expect(Buffer.isBuffer(out.buffer)).toBe(true);
    expect(out.contentType).toBe("image/png");
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toContain("/staticmap");
    expect(opts.responseType).toBe("arraybuffer");
    expect(opts.params).toMatchObject({ center: "lonlat:3.4,6.5", zoom: 16, apiKey: KEY });
  });

  it("clamps width, height and zoom to safe bounds", async () => {
    axios.get.mockResolvedValue({ data: Buffer.from([0]), headers: {} });
    await geoapify.staticMap({ lat: 6.5, lng: 3.4, zoom: 99, width: 9000, height: 9000 });
    const [, opts] = axios.get.mock.calls[0];
    expect(opts.params.zoom).toBe(20);
    expect(opts.params.width).toBe(1000);
    expect(opts.params.height).toBe(800);
  });

  it("throws a tagged error (not a silent null) when unconfigured", async () => {
    delete process.env.GEOAPIFY_API_KEY;
    await expect(geoapify.staticMap({ lat: 6.5, lng: 3.4 })).rejects.toMatchObject({
      code: "GEOAPIFY_NOT_CONFIGURED",
    });
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe("testConnection", () => {
  it("resolves ok with a sample address on a valid key", async () => {
    axios.get.mockResolvedValue({ data: { results: [{ formatted: "Lagos, Nigeria" }] } });
    await expect(geoapify.testConnection({ apiKey: KEY })).resolves.toMatchObject({
      ok: true,
      sample_address: "Lagos, Nigeria",
    });
  });

  it("rejects with a clear message on an invalid key (401)", async () => {
    axios.get.mockRejectedValue({ response: { status: 401, data: {} } });
    await expect(geoapify.testConnection({ apiKey: "bad-key" })).rejects.toMatchObject({
      message: "Invalid Geoapify API key",
    });
  });

  it("rejects when no key is supplied, without calling out", async () => {
    await expect(geoapify.testConnection({ apiKey: "" })).rejects.toMatchObject({
      code: "NO_TOKEN",
    });
    expect(axios.get).not.toHaveBeenCalled();
  });
});
