"use strict";

const {
  slugify,
  uniqueSlug,
  readingTimeMinutes,
  buildPostFields,
} = require("../../../src/modules/storefront_studio/content-helpers");

describe("content-helpers — slugify", () => {
  test("lowercases, hyphenates and strips punctuation", () => {
    expect(slugify("Wash day, done right!")).toBe("wash-day-done-right");
    expect(slugify("How long does delivery take?")).toBe(
      "how-long-does-delivery-take",
    );
  });
  test("drops apostrophes rather than hyphenating them", () => {
    expect(slugify("Your wig's best friend")).toBe("your-wigs-best-friend");
  });
  test("folds accents and trims stray hyphens", () => {
    expect(slugify("  Crème & Coëxist  ")).toBe("creme-coexist");
    expect(slugify("—leading and trailing—")).toBe("leading-and-trailing");
  });
  test("empty-ish input yields an empty string", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify(null)).toBe("");
  });
});

describe("content-helpers — uniqueSlug", () => {
  test("returns the base slug when free", async () => {
    const s = await uniqueSlug("Shipping Policy", async () => false);
    expect(s).toBe("shipping-policy");
  });
  test("suffixes -2, -3 on collisions", async () => {
    const taken = new Set(["returns", "returns-2"]);
    const s = await uniqueSlug("Returns", async (c) => taken.has(c));
    expect(s).toBe("returns-3");
  });
  test("falls back to a safe root when the title is unsluggable", async () => {
    const s = await uniqueSlug("!!!", async () => false);
    expect(s).toBe("post");
  });
});

describe("content-helpers — readingTimeMinutes", () => {
  test("counts words at 200 wpm, minimum 1", () => {
    expect(readingTimeMinutes("hello world")).toBe(1);
    expect(readingTimeMinutes(Array(201).fill("w").join(" "))).toBe(2);
    expect(readingTimeMinutes("", null)).toBe(1);
  });
});

describe("content-helpers — buildPostFields", () => {
  test("an article derives SEO + reading time and leaves faq fields null", () => {
    const f = buildPostFields({
      post_type: "guide",
      title: "Wash day, done right",
      excerpt: "Keep it soft and shiny.",
      body: "Gentle wash steps.",
      is_featured: true,
      display_order: 3,
    });
    expect(f.faq_category).toBeNull();
    expect(f.faq_question).toBeNull();
    expect(f.meta_title).toBe("Wash day, done right");
    expect(f.meta_description).toBe("Keep it soft and shiny.");
    expect(f.is_featured).toBe(true);
    expect(f.display_order).toBe(3);
    expect(f.reading_time_minutes).toBe(1);
  });

  test("an FAQ mirrors the question into the title and defaults the category", () => {
    const f = buildPostFields({
      post_type: "faq",
      title: "",
      faq_question: "How long does delivery take?",
      body: "Lagos 1-2 days.",
    });
    expect(f.title).toBe("How long does delivery take?");
    expect(f.faq_question).toBe("How long does delivery take?");
    expect(f.faq_category).toBe("general");
    // meta_description falls back to the answer when there's no excerpt.
    expect(f.meta_description).toBe("Lagos 1-2 days.");
  });

  test("a blank body/excerpt still yields a share-ready meta_description from the title", () => {
    const f = buildPostFields({ post_type: "policy", title: "Shipping Policy" });
    expect(f.meta_description).toBe("Shipping Policy");
    expect(f.title).toBe("Shipping Policy");
  });

  test("over-long meta_description is clamped with an ellipsis", () => {
    const long = "x".repeat(400);
    const f = buildPostFields({ post_type: "journal", title: "T", excerpt: long });
    expect(f.meta_description.length).toBeLessThanOrEqual(300);
    expect(f.meta_description.endsWith("…")).toBe(true);
  });
});
