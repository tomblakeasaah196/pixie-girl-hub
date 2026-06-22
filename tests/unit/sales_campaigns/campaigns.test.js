"use strict";

// Mock the repo (DB) so discount-engine math can be tested in isolation.
jest.mock("../../../src/modules/sales_campaigns/campaigns.repo", () => ({
  listProducts: jest.fn().mockResolvedValue([]),
  findById: jest.fn(),
  findBySlug: jest.fn(),
}));

const repo = require("../../../src/modules/sales_campaigns/campaigns.repo");
const service = require("../../../src/modules/sales_campaigns/campaigns.service");
const discount = require("../../../src/modules/sales_campaigns/campaigns.discount.service");
const wf = require("../../../src/workflows/engine");
const {
  createSchema,
  updateSchema,
  signupSchema,
  addProductSchema,
  bundleItemSchema,
} = require("../../../src/modules/sales_campaigns/campaigns.validator");

function liveCampaign(over = {}) {
  return {
    campaign_id: "11111111-1111-1111-1111-111111111111",
    slug: "black-friday",
    status: "live",
    starts_at: new Date(Date.now() - 3600_000).toISOString(),
    ends_at: new Date(Date.now() + 3600_000).toISOString(),
    discount_type: "percentage",
    discount_value: 0.5,
    product_scope: "all",
    min_order_value_ngn: null,
    first_time_buyers_only: false,
    customer_segment_id: null,
    total_usage_limit: null,
    total_usage_count: 0,
    ...over,
  };
}

describe("resolveState", () => {
  test("before / live / ended", () => {
    const future = new Date(Date.now() + 7200_000).toISOString();
    const past = new Date(Date.now() - 7200_000).toISOString();
    expect(
      service.resolveState({
        status: "scheduled",
        starts_at: future,
        ends_at: future,
      }),
    ).toBe("before");
    expect(service.resolveState(liveCampaign())).toBe("live");
    expect(
      service.resolveState({ status: "ended", starts_at: past, ends_at: past }),
    ).toBe("ended");
  });
});

describe("workflow normaliseStages", () => {
  test("defaults to a CEO stage when none given", () => {
    const s = wf.normaliseStages({ stages: [{ order: 1 }] });
    expect(s[0].approvers[0]).toEqual({ type: "role", value: "ceo" });
  });
  test("reads the simple approver_role form", () => {
    const s = wf.normaliseStages({
      stages: [{ step: 1, approver_role: "manager" }],
    });
    expect(s[0].approvers[0]).toEqual({ type: "role", value: "manager" });
  });
});

describe("createSchema validation", () => {
  const base = {
    name: "BF",
    slug: "black-friday",
    starts_at: "2026-11-27T00:00:00Z",
    ends_at: "2026-11-30T23:59:59Z",
    discount_type: "percentage",
    discount_value: 0.2,
  };
  test("accepts a valid payload", () => {
    expect(() => createSchema.parse(base)).not.toThrow();
  });
  test("rejects ends_at <= starts_at", () => {
    expect(() =>
      createSchema.parse({ ...base, ends_at: base.starts_at }),
    ).toThrow();
  });
  test("rejects percentage > 1", () => {
    expect(() => createSchema.parse({ ...base, discount_value: 20 })).toThrow();
  });
  test("rejects a bad slug", () => {
    expect(() =>
      createSchema.parse({ ...base, slug: "Black Friday!" }),
    ).toThrow();
  });
});

describe("signupSchema", () => {
  test("requires email or phone", () => {
    expect(() => signupSchema.parse({ notify_via: "email" })).toThrow();
    expect(() => signupSchema.parse({ email: "a@b.com" })).not.toThrow();
  });
});

describe("addProductSchema (campaign builder 'Add products')", () => {
  const styledId = "22222222-2222-2222-2222-222222222222";
  const productId = "33333333-3333-3333-3333-333333333333";

  test("accepts a styled product with a null image + null prices", () => {
    // This is exactly what the picker sends for an image-less product. Before
    // the fix, image_url was .optional() (not .nullable()) so null 400'd the
    // whole batch — the silent 'nothing adds' bug.
    expect(() =>
      addProductSchema.parse({
        styled_id: styledId,
        product_id: productId,
        include_exclude: "include",
        image_url: null,
        regular_price_ngn: null,
        regular_price_usd: null,
        is_featured: false,
      }),
    ).not.toThrow();
  });

  test("accepts both-currency prices + long/short descriptions", () => {
    expect(() =>
      addProductSchema.parse({
        styled_id: styledId,
        product_id: productId,
        include_exclude: "include",
        image_url: "https://cdn.example.com/wig.jpg",
        regular_price_ngn: 425000,
        regular_price_usd: 280,
        short_description: "HD lace pixie wig",
        long_description: "A longer editorial description ".repeat(10),
      }),
    ).not.toThrow();
  });

  test("requires at least one of styled_id / product_id / category_id", () => {
    expect(() =>
      addProductSchema.parse({ include_exclude: "include" }),
    ).toThrow();
  });
});

describe("bundleItemSchema (campaign builder bundle picker)", () => {
  test("accepts styled_id + base product_id", () => {
    expect(() =>
      bundleItemSchema.parse({
        styled_id: "44444444-4444-4444-4444-444444444444",
        product_id: "55555555-5555-5555-5555-555555555555",
        quantity: 1,
      }),
    ).not.toThrow();
  });
  test("requires styled_id / product_id / variant_id", () => {
    expect(() => bundleItemSchema.parse({ quantity: 1 })).toThrow();
  });
});

describe("URL safety on landing fields", () => {
  test("rejects javascript: in ended_redirect_to", () => {
    expect(() =>
      updateSchema.parse({ ended_redirect_to: "javascript:alert(1)" }),
    ).toThrow();
  });
  test("rejects data: in landing_hero_image_url", () => {
    expect(() =>
      updateSchema.parse({
        landing_hero_image_url: "data:text/html,<script>alert(1)</script>",
      }),
    ).toThrow();
  });
  test("accepts plain https URLs", () => {
    expect(() =>
      updateSchema.parse({
        landing_hero_image_url: "https://cdn.example.com/img.jpg",
        ended_redirect_to: "https://pixiegirl.com/new-drop",
      }),
    ).not.toThrow();
  });
  test("accepts an uploaded same-origin /media path (no CDN configured)", () => {
    // The blocker behind "Invalid input" on every landing save: uploads come
    // back as "/media/..." which the old safeUrl (.url()) rejected.
    expect(() =>
      updateSchema.parse({
        landing_hero_image_url:
          "/media/campaigns/faitlynhair/00d73466/hero.jpg",
        og_image_url: "/media/campaigns/faitlynhair/00d73466/og.jpg",
      }),
    ).not.toThrow();
  });
  test("rejects protocol-relative //host (cross-origin)", () => {
    expect(() =>
      updateSchema.parse({
        landing_hero_image_url: "//evil.example.com/x.jpg",
      }),
    ).toThrow();
  });
});

describe("landing_blocks bounds", () => {
  test("rejects landing_blocks larger than the bound", () => {
    const tooMany = Array.from({ length: 41 }, () => ({ type: "hero" }));
    expect(() => updateSchema.parse({ landing_blocks: tooMany })).toThrow();
  });
  test("accepts a small set of blocks", () => {
    const blocks = [
      { type: "hero", title: "X" },
      { type: "faq", items: [{ q: "a", a: "b" }] },
    ];
    expect(() => updateSchema.parse({ landing_blocks: blocks })).not.toThrow();
  });
});

describe("discount engine", () => {
  beforeEach(() => repo.listProducts.mockResolvedValue([]));

  test("applies a percentage discount to all in-scope items", async () => {
    const res = await discount.resolveDiscount({
      brand: "pixiegirl",
      campaignRef: liveCampaign(),
      cart: {
        items: [{ product_id: "p1", unit_price_ngn: "100000.00", quantity: 2 }],
      },
    });
    expect(res.eligible).toBe(true);
    expect(res.total_discount_ngn).toBe("100000.00"); // 50% of 100k * 2
    expect(res.lines[0].discounted_unit_price_ngn).toBe("50000.00");
  });

  test("margin-floor clamp caps the discount", async () => {
    const res = await discount.resolveDiscount({
      brand: "pixiegirl",
      campaignRef: liveCampaign(),
      cart: {
        items: [{ product_id: "p1", unit_price_ngn: "100000.00", quantity: 1 }],
      },
      getMarginFloor: async () => "60000.00", // never below 60k
    });
    expect(res.clamped).toBe(true);
    expect(res.total_discount_ngn).toBe("40000.00"); // clamped from 50k to 40k
    expect(res.lines[0].discounted_unit_price_ngn).toBe("60000.00");
  });

  test("rejects when below minimum order value", async () => {
    const res = await discount.resolveDiscount({
      brand: "pixiegirl",
      campaignRef: liveCampaign({ min_order_value_ngn: "500000.00" }),
      cart: {
        items: [{ product_id: "p1", unit_price_ngn: "100000.00", quantity: 1 }],
      },
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("below_min_order_value");
  });

  test("respects excluded products", async () => {
    repo.listProducts.mockResolvedValue([
      { include_exclude: "exclude", product_id: "p1", category_id: null },
    ]);
    const res = await discount.resolveDiscount({
      brand: "pixiegirl",
      campaignRef: liveCampaign(),
      cart: {
        items: [{ product_id: "p1", unit_price_ngn: "100000.00", quantity: 1 }],
      },
    });
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("no_eligible_items");
  });
});
