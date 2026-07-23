"use strict";

// Walk-in QR delivery-address search (2026-07-23 session): the public
// Walk-in form's address box used to depend on Google Places, which
// silently degrades to a dead text input when no Maps key is configured.
// It now proxies the same server-side Geoapify integration the
// customer-onboarding form and HR's office-location picker use.

jest.mock("../../../src/modules/storefront/storefront.repo", () => ({
  findContactByEmailOrPhone: jest.fn(),
  createContact: jest.fn(),
}));
jest.mock("../../../src/shared/contacts/contacts.repo", () => ({
  addAddress: jest.fn(),
}));
jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(async (fn) => fn({})),
}));
jest.mock("../../../src/services/welcome-email", () => ({
  sendWelcomeEmail: jest.fn(),
}));
jest.mock("../../../src/services/geoapify.service", () => ({
  autocomplete: jest.fn(),
}));

const geoapify = require("../../../src/services/geoapify.service");
const service = require("../../../src/modules/storefront/walkin.service");

describe("walkin.service.searchAddress", () => {
  test("delegates to Geoapify with a Lagos proximity bias", async () => {
    geoapify.autocomplete.mockResolvedValue([
      { formatted: "12 Admiralty Way, Lekki", lat: 6.4, lng: 3.5 },
    ]);
    const results = await service.searchAddress({
      brand: "faitlynhair",
      text: "Admiralty",
    });
    expect(geoapify.autocomplete).toHaveBeenCalledWith("Admiralty", {
      lat: 6.5244,
      lng: 3.3792,
    });
    expect(results).toEqual([
      { formatted: "12 Admiralty Way, Lekki", lat: 6.4, lng: 3.5 },
    ]);
  });

  test("rejects an unknown brand without calling Geoapify", async () => {
    await expect(
      service.searchAddress({ brand: "not-a-brand", text: "Lekki" }),
    ).rejects.toThrow();
    expect(geoapify.autocomplete).not.toHaveBeenCalled();
  });
});
