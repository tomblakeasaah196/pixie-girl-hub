"use strict";

/**
 * Unit tests for the smartcomm order-link minter (the short `/o/<slug>`
 * shared-catalogue checkout link). Hermetic — the DB repo, item resolver,
 * brand-URL helper and audit are mocked, so we verify the mint contract:
 * validation guards, item normalisation, mode, and the returned slug URL.
 */

jest.mock("../../../src/config/database", () => ({ query: jest.fn() }));
jest.mock("../../../src/middleware/audit", () => ({
  audit: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../../src/utils/brand-urls", () => ({
  orderLinkUrl: jest.fn(async (brand, slug) => `https://${brand}.test/o/${slug}`),
}));
jest.mock(
  "../../../src/modules/smartcomm/smartcomm.order-links.repo",
  () => ({
    createOrderLink: jest.fn(async ({ link }) => ({
      link_id: "44444444-4444-4444-4444-444444444444",
      public_slug: "Ab3xK9mP2q_z",
      mode: link.mode || "shop",
      ...link,
    })),
  }),
);
jest.mock(
  "../../../src/modules/smartcomm/smartcomm.order-links.resolvers",
  () => ({
    // Default: every item resolves to a sellable line (no warnings).
    resolveItems: jest.fn(async (_brand, items) =>
      items.map((it) => ({
        kind:
          it.kind || (it.styled_id ? "styled" : it.service_id ? "service" : "base"),
        ref_id:
          it.product_id || it.styled_id || it.bundle_id || it.service_id || null,
        name: "Test item",
        price_ngn: it.price_ngn || "1000",
        styled_variant_id: it.styled_variant_id || null,
        lines: [{ variant_id: "11111111-1111-1111-1111-111111111111", quantity: it.qty }],
      })),
    ),
  }),
);

const orderLinks = require("../../../src/modules/smartcomm/smartcomm.order-links.service");
const repo = require("../../../src/modules/smartcomm/smartcomm.order-links.repo");
const resolvers = require("../../../src/modules/smartcomm/smartcomm.order-links.resolvers");

const baseArgs = {
  brand: "faitlynhair",
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

describe("smartcomm order-link minter", () => {
  beforeEach(() => jest.clearAllMocks());

  test("createLink returns a short slug URL (no contact needed)", async () => {
    const r = await orderLinks.createLink({
      ...baseArgs,
      input: { items: validItems },
    });
    expect(r.slug).toBe("Ab3xK9mP2q_z");
    expect(r.url).toBe("https://faitlynhair.test/o/Ab3xK9mP2q_z");
    expect(r.link_id).toBe("44444444-4444-4444-4444-444444444444");
    // The link is under Instagram's 1,000-char DM cap by a mile.
    expect(r.url.length).toBeLessThan(80);
    // Always the shared-catalogue mini-shop now (Capture retired).
    expect(repo.createOrderLink.mock.calls[0][0].link.mode).toBe("shop");
  });

  test("createLink rejects when items empty", async () => {
    await expect(
      orderLinks.createLink({ ...baseArgs, input: { items: [] } }),
    ).rejects.toMatchObject({ code: "ITEMS_REQUIRED" });
  });

  test("createLink rejects items with bad qty", async () => {
    await expect(
      orderLinks.createLink({
        ...baseArgs,
        input: {
          items: [{ product_id: "22222222-2222-2222-2222-222222222222", qty: 0 }],
        },
      }),
    ).rejects.toMatchObject({ code: "ITEM_INVALID" });
  });

  test("createLink normalises a staff-picked styled variant onto the row", async () => {
    await orderLinks.createLink({
      ...baseArgs,
      input: {
        items: [
          {
            kind: "styled",
            styled_id: "55555555-5555-5555-5555-555555555555",
            qty: 1,
            price_ngn: "435000",
            styled_variant_id: "66666666-6666-6666-6666-666666666666",
            size_code: "M",
            lace_code: "6X6",
            colour_id: "77777777-7777-7777-7777-777777777777",
            spec: "Medium · 6×6 Frontal · Spicy Copper",
          },
        ],
      },
    });
    const persisted = repo.createOrderLink.mock.calls[0][0].link.items[0];
    expect(persisted.kind).toBe("styled");
    expect(persisted.styled_id).toBe("55555555-5555-5555-5555-555555555555");
    expect(persisted.styled_variant_id).toBe(
      "66666666-6666-6666-6666-666666666666",
    );
    expect(persisted.size_code).toBe("M");
    expect(persisted.lace_code).toBe("6X6");
    expect(persisted.price_ngn).toBe("435000");
  });

  test("createLink surfaces a warning for an item that can't be sold", async () => {
    resolvers.resolveItems.mockImplementationOnce(async () => [
      {
        kind: "base",
        ref_id: "22222222-2222-2222-2222-222222222222",
        name: "Sold-out wig",
        unresolved_reason: "Product has no active variant to sell",
        lines: [], // unresolvable
      },
    ]);
    const r = await orderLinks.createLink({
      ...baseArgs,
      input: { items: validItems },
    });
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].reason).toMatch(/no active variant/i);
  });
});

describe("order-link slug", () => {
  test("generateSlug is short + URL-safe (base64url)", () => {
    const real = jest.requireActual(
      "../../../src/modules/smartcomm/smartcomm.order-links.repo",
    );
    const slug = real.generateSlug();
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(slug.length).toBeLessThanOrEqual(16);
    // Two mints never collide in practice.
    expect(real.generateSlug()).not.toBe(slug);
  });
});
