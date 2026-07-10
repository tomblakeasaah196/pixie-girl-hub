"use strict";

/**
 * Unit tests for the smartcomm order-capture link generator.
 * Hermetic — we mock the env config + audit middleware so we can
 * verify the JWT shape and the validation guards.
 */

jest.mock("../../../src/config/env", () => ({
  config: {
    JWT_SECRET: "test-secret-must-be-at-least-32-chars-long-XYZ",
    // Order links mint on the hub domain (where /order/capture is served),
    // not the brand storefront domain.
    ADMIN_BASE_URL: "https://pixiegirl.test",
  },
}));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
// Links persist to shared.smartcomm_order_links (single-use lifecycle +
// activity panel); hermetic tests fake the row.
jest.mock(
  "../../../src/modules/smartcomm/smartcomm.order-links.repo",
  () => ({
    createOrderLink: jest.fn(async ({ link }) => ({
      link_id: "44444444-4444-4444-4444-444444444444",
      mode: link.mode || "capture",
      ...link,
    })),
  }),
);

const jwt = require("jsonwebtoken");
const orderCapture = require("../../../src/modules/smartcomm/smartcomm.order-capture");

const baseArgs = {
  brand: "pixiegirl",
  user: { user_id: "11111111-1111-1111-1111-111111111111" },
  request_id: "req-test",
};

const validItems = [
  {
    product_id: "22222222-2222-2222-2222-222222222222",
    qty: 2,
    note: "Pink ribbon if possible",
  },
];

describe("smartcomm order-capture", () => {
  // Owner decision (2026-07): contact is optional — no-contact links show
  // the inline welcome-form block at checkout and back-fill the contact.
  test("createCaptureLink works without a contact_id", async () => {
    const r = await orderCapture.createCaptureLink({
      ...baseArgs,
      input: { items: validItems },
    });
    const decoded = jwt.verify(
      r.token,
      "test-secret-must-be-at-least-32-chars-long-XYZ",
      { issuer: "smartcomm", audience: "order-capture" },
    );
    expect(decoded.contact_id).toBeUndefined();
    expect(decoded.link_id).toBe("44444444-4444-4444-4444-444444444444");
  });

  test("createCaptureLink rejects when items empty", async () => {
    await expect(
      orderCapture.createCaptureLink({
        ...baseArgs,
        input: {
          contact_id: "33333333-3333-3333-3333-333333333333",
          items: [],
        },
      }),
    ).rejects.toMatchObject({ code: "ITEMS_REQUIRED" });
  });

  test("createCaptureLink rejects items with bad qty", async () => {
    await expect(
      orderCapture.createCaptureLink({
        ...baseArgs,
        input: {
          contact_id: "33333333-3333-3333-3333-333333333333",
          items: [
            { product_id: "22222222-2222-2222-2222-222222222222", qty: 0 },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
  });

  test("createCaptureLink returns a verifiable signed URL", async () => {
    const r = await orderCapture.createCaptureLink({
      ...baseArgs,
      input: {
        contact_id: "33333333-3333-3333-3333-333333333333",
        items: validItems,
        sales_channel: "instagram",
      },
    });
    expect(r.url).toMatch(/^https:\/\/pixiegirl\.test\/order\/capture\//);
    expect(typeof r.expires_at).toBe("string");

    const decoded = jwt.verify(
      r.token,
      "test-secret-must-be-at-least-32-chars-long-XYZ",
      {
        issuer: "smartcomm",
        audience: "order-capture",
      },
    );
    expect(decoded.contact_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(decoded.brand).toBe("pixiegirl");
    expect(decoded.sales_channel).toBe("instagram");
    expect(decoded.items).toHaveLength(1);
    expect(decoded.items[0].product_id).toBe(
      "22222222-2222-2222-2222-222222222222",
    );
    expect(decoded.items[0].qty).toBe(2);
    expect(decoded.staffer_user_id).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });

  test("verifyCaptureToken rejects tampered tokens", () => {
    const bad = jwt.sign(
      { foo: "bar" },
      "different-secret-also-long-enough-XYZ",
      {
        issuer: "smartcomm",
        audience: "order-capture",
      },
    );
    expect(() => orderCapture.verifyCaptureToken(bad)).toThrow();
  });

  test("verifyCaptureToken raises CAPTURE_EXPIRED on expired tokens", () => {
    const expired = jwt.sign(
      { contact_id: "x", brand: "pixiegirl", items: [] },
      "test-secret-must-be-at-least-32-chars-long-XYZ",
      {
        issuer: "smartcomm",
        audience: "order-capture",
        expiresIn: -10, // already expired
      },
    );
    expect(() => orderCapture.verifyCaptureToken(expired)).toThrow(
      expect.objectContaining({ code: "CAPTURE_EXPIRED" }),
    );
  });
});
