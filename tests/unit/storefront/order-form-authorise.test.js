"use strict";

// The public order form (/api/public/order-form) is written by the shopper's
// browser, so storefront.authoriseOrderForm matches every posted line against
// the live order link. These cases cover the paths the PGlite suite can't
// easily seed: a styled line landing on a size-adjacent sibling (rewig donor)
// must map back to its link line, while anything outside the base family, or a
// Care SKU, is refused.

const FAMILY = {
  "var-a": { variant_id: "var-a", base_family_id: "fam-1", catalogue_role: "base" },
  "var-b": { variant_id: "var-b", base_family_id: "fam-1", catalogue_role: "base" },
  "var-x": { variant_id: "var-x", base_family_id: "fam-2", catalogue_role: "base" },
  "var-care": { variant_id: "var-care", base_family_id: null, catalogue_role: "retail" },
};

jest.mock("../../../src/config/database", () => ({
  transaction: jest.fn(),
  query: jest.fn(async (_sql, params) => ({
    rows: (params && params[0] ? params[0] : []).map((id) => FAMILY[id]).filter(Boolean),
  })),
}));
let mockLink;
jest.mock("../../../src/modules/smartcomm/smartcomm.order-links.repo", () => ({
  getBySlug: jest.fn(async () => mockLink),
}));
let mockResolved;
jest.mock("../../../src/modules/smartcomm/smartcomm.order-links.resolvers", () => ({
  resolveItems: jest.fn(async () => mockResolved),
  resolveServiceItem: jest.fn(async (_b, it) => ({
    kind: "service", service_id: it.service_id, price_ngn: "15000", unresolved_reason: null,
  })),
}));
jest.mock("../../../src/modules/sales/sales.repo", () => ({
  findByIdempotencyKey: jest.fn(async () => null),
}));

const { authoriseOrderForm } = require("../../../src/modules/storefront/storefront.service");

const run = (items, extra = {}) =>
  authoriseOrderForm({
    brand: "pixiegirl",
    input: { order_link_slug: "abc123", ...extra },
    productItems: items,
    serviceBookings: extra.service_bookings || [],
  });

beforeEach(() => {
  mockLink = { link_id: "l1", business: "pixiegirl", status: "active", items: [{}] };
  mockResolved = [
    { kind: "styled", qty: 1, price_ngn: "250000", lines: [{ variant_id: "var-a", quantity: 1 }] },
    { kind: "retail", qty: 2, lines: [{ variant_id: "var-care", quantity: 2 }] },
  ];
});

test("a styled line's size-adjacent sibling maps back to its link line", async () => {
  const r = await run([{ variant_id: "var-b", quantity: 1 }]);
  expect(r.substitutions.get("var-b")).toBe("var-a");
});

test("a variant outside the base family, or any unlisted Care SKU, is refused", async () => {
  await expect(run([{ variant_id: "var-x", quantity: 1 }])).rejects.toMatchObject({
    code: "ORDER_ITEM_NOT_IN_LINK",
  });
  mockResolved = [{ kind: "styled", qty: 1, lines: [{ variant_id: "var-a", quantity: 1 }] }];
  await expect(run([{ variant_id: "var-care", quantity: 1 }])).rejects.toMatchObject({
    code: "ORDER_ITEM_NOT_IN_LINK",
  });
});

test("quantities are capped per link item (100 × the line's per-unit quantity)", async () => {
  await expect(run([{ variant_id: "var-care", quantity: 100 }])).resolves.toBeTruthy();
  await expect(run([{ variant_id: "var-care", quantity: 101 }])).rejects.toMatchObject({
    code: "ORDER_QTY_EXCEEDED",
  });
});

test("an ordered link only accepts an idempotent replay of its own order", async () => {
  const salesRepo = require("../../../src/modules/sales/sales.repo");
  mockLink = { ...mockLink, status: "ordered", order_id: "ord-1" };
  await expect(run([{ variant_id: "var-a", quantity: 1 }])).rejects.toMatchObject({
    code: "LINK_ALREADY_USED",
  });
  salesRepo.findByIdempotencyKey.mockResolvedValueOnce("ord-1");
  const r = await run([{ variant_id: "var-a", quantity: 1 }], { client_idempotency_key: "k1" });
  expect(r.replay).toBe(true);
});

test("no link: product lines are refused; a service booking takes the catalogue price", async () => {
  await expect(
    authoriseOrderForm({
      brand: "pixiegirl", input: {}, productItems: [{ variant_id: "var-a", quantity: 1 }], serviceBookings: [],
    }),
  ).rejects.toMatchObject({ code: "ORDER_LINK_REQUIRED" });
  const r = await authoriseOrderForm({
    brand: "pixiegirl", input: {}, productItems: [],
    serviceBookings: [{ service_id: "svc-1", qty: 1, price_ngn: "1" }],
  });
  expect(r.bookings[0].price_ngn).toBe("15000");
});
