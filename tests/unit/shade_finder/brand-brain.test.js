"use strict";

const {
  composeBrandContext,
  resolveReferences,
  _internal,
} = require("../../../src/modules/shade_finder/brand-brain");

/** A representative brain pack, as buildBrain would assemble it. */
function fakeBrain() {
  return {
    identity: {
      name: "Pixie Girl Global",
      support_email: "care@pixiegirl.com",
      phone: "+2348000000000",
      address: "12 Admiralty Way, Lekki, Lagos",
      website: "pixiegirlglobal.com",
      mission: "Luxury hair for every shade of you.",
      payment_providers: ["paystack", "bank_transfer"],
    },
    services: [
      {
        slug: "silk-press",
        name: "Silk Press",
        about: "Steam-smoothed finish",
        price_ngn: "25000",
        price_is_from: true,
        duration_minutes: 90,
        location_type: "in_studio",
        deposit_required: true,
        deposit_pct: 50,
        whats_included: "Wash, treatment, press",
        aftercare: "No water for 48h",
      },
    ],
    bundles: [
      {
        code: "BND-GLAM",
        name: "Glam Starter Set",
        about: "Wig + care kit",
        price_ngn: "180000",
        pricing_model: "fixed",
        discount_value: null,
        components: ["Silk Bob", "Care Kit"],
      },
    ],
    collections: [
      { slug: "bridal", name: "Bridal Edit", about: "For the aisle" },
    ],
    faqs: [
      {
        slug: "how-long-delivery",
        category: "shipping",
        question: "How long does delivery take?",
        answer: "Lagos 1-2 days, nationwide 3-5 days.",
      },
      {
        slug: "can-i-return",
        category: "returns",
        question: "Can I return a wig?",
        answer: "Unworn units within 7 days.",
      },
    ],
    guides: [
      { slug: "wash-day", title: "Wash-day ritual", summary: "Low suds, cool water." },
    ],
    journal: [
      { slug: "summer-looks", type: "journal", title: "Summer looks", summary: "Bright season." },
      { slug: "press-feature", type: "press", title: "Vogue feature", summary: "" },
    ],
    policies: [],
  };
}

describe("brand brain — composeBrandContext", () => {
  test("identity capsule and coverage index are always present", () => {
    const { block, refs } = composeBrandContext({
      brain: fakeBrain(),
      text: "hello!",
    });
    expect(block).toContain("Pixie Girl Global");
    expect(block).toContain("care@pixiegirl.com");
    expect(block).toContain("KNOWLEDGE COVERS");
    // Static pages are always referencable, even on a plain greeting.
    expect(refs.has("page:contact")).toBe(true);
    expect(refs.has("policy:returns")).toBe(true);
  });

  test("a shipping question pulls the shipping FAQ and policy refs", () => {
    const { block, refs } = composeBrandContext({
      brain: fakeBrain(),
      text: "how long does delivery take to Abuja?",
    });
    expect(block).toContain("Lagos 1-2 days");
    expect(block).toContain("policy:shipping");
    expect(refs.has("policy:shipping")).toBe(true);
    // Unrelated sections stay out of the prompt.
    expect(block).not.toContain("Silk Press");
  });

  test("a services question grounds on live services with refs", () => {
    const { block, refs } = composeBrandContext({
      brain: fakeBrain(),
      text: "can I book an install appointment?",
    });
    expect(block).toContain("Silk Press");
    expect(block).toContain("deposit 50%");
    expect(refs.get("service:silk-press")).toEqual({
      label: "Silk Press",
      href: "/services/silk-press",
      kind: "service",
    });
  });

  test("care questions surface guides and care FAQs", () => {
    const { block } = composeBrandContext({
      brain: fakeBrain(),
      text: "how do I wash my wig so it lasts?",
    });
    expect(block).toContain("Wash-day ritual");
  });

  test("journal refs only exist for posts with a public page", () => {
    const { refs } = composeBrandContext({
      brain: fakeBrain(),
      text: "what's new in your latest collection?",
    });
    expect(refs.has("journal:summer-looks")).toBe(true);
    expect(refs.has("journal:press-feature")).toBe(false);
  });

  test("a matched topic with no published content declares the gap", () => {
    const brain = { ...fakeBrain(), faqs: [], guides: [] };
    const { block } = composeBrandContext({
      brain,
      text: "how do I maintain the curls?",
    });
    expect(block).toContain("NO PUBLISHED DETAIL");
    expect(block).toContain("NEVER guess");
  });

  test("a null brain still yields a usable pages-only context", () => {
    const { block, refs } = composeBrandContext({ brain: null, text: "hi" });
    expect(block).toContain("KNOWLEDGE COVERS");
    expect(refs.size).toBe(_internal.STATIC_PAGES.length);
  });

  test("the block respects the overall character budget", () => {
    const brain = fakeBrain();
    brain.services = Array.from({ length: 80 }, (_, i) => ({
      ...brain.services[0],
      slug: `svc-${i}`,
      name: `Service ${i} ${"x".repeat(160)}`,
    }));
    const { block } = composeBrandContext({
      brain,
      text: "book a service and a bundle deal for delivery",
    });
    expect(block.length).toBeLessThanOrEqual(7000);
  });
});

describe("brand brain — resolveReferences", () => {
  const refs = new Map([
    ["page:contact", { label: "Contact us", href: "/contact", kind: "page" }],
    ["service:silk-press", { label: "Silk Press", href: "/services/silk-press", kind: "service" }],
    ["policy:returns", { label: "Returns & refunds", href: "/policies/returns", kind: "policy" }],
    ["page:shop", { label: "Shop all styles", href: "/shop", kind: "page" }],
  ]);

  test("hydrates known keys, drops unknown and duplicate ones, caps at 3", () => {
    const out = resolveReferences({
      keys: [
        "service:silk-press",
        "service:silk-press",
        "faq:invented-by-model",
        "page:contact",
        "policy:returns",
        "page:shop",
      ],
      refs,
    });
    expect(out).toHaveLength(3);
    expect(out.map((r) => r.key)).toEqual([
      "service:silk-press",
      "page:contact",
      "policy:returns",
    ]);
    expect(out[0].href).toBe("/services/silk-press");
  });

  test("tolerates a missing/garbage keys payload", () => {
    expect(resolveReferences({ keys: undefined, refs })).toEqual([]);
    expect(resolveReferences({ keys: "nope", refs })).toEqual([]);
  });
});

describe("brand brain — identityFrom", () => {
  test("payment provider keys survive; junk does not crash", () => {
    const id = _internal.identityFrom({
      display_name: "Faitlyn",
      support_email: null,
      email: "hello@faitlyn.com",
      payment_methods: { paystack: { enabled: true }, opay: {} },
    });
    expect(id.support_email).toBe("hello@faitlyn.com");
    expect(id.payment_providers).toEqual(["paystack", "opay"]);
    expect(_internal.identityFrom(null)).toBeNull();
  });
});
