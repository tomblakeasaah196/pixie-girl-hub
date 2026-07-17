"use strict";

const {
  extractMetrics,
  pluck,
} = require("../../../src/services/social-scraper.service");

// Schemas mirror what migration 000356 seeds, so this asserts the seeded
// aliases + types actually match the shapes those Apify actors return.
const IG_SCHEMA = [
  { key: "followers", label: "Followers", type: "count", aliases: ["followersCount", "followers"] },
  { key: "following", label: "Following", type: "count", aliases: ["followsCount", "following"] },
  { key: "posts", label: "Posts", type: "count", aliases: ["postsCount", "posts"] },
  { key: "verified", label: "Verified", type: "bool", aliases: ["verified", "isVerified"] },
  { key: "full_name", label: "Name", type: "text", aliases: ["fullName", "name"] },
];
const GBP_SCHEMA = [
  { key: "rating", label: "Rating", type: "decimal", aliases: ["totalScore", "rating"] },
  { key: "reviews", label: "Reviews", type: "count", aliases: ["reviewsCount"] },
  { key: "category", label: "Category", type: "text", aliases: ["categoryName", "category"] },
  { key: "closed", label: "Closed", type: "bool", aliases: ["permanentlyClosed", "closed"] },
];
const LINKEDIN_SCHEMA = [
  { key: "followers", label: "Followers", type: "count", aliases: ["followersCount"] },
  { key: "specialties", label: "Specialties", type: "text", aliases: ["specialties"] },
];

describe("social-scraper extractMetrics — typed specs", () => {
  test("Instagram: counts + verified badge + name text, follower_count from count", () => {
    const item = {
      username: "faitlynhair",
      fullName: "Faitlyn Hair",
      followersCount: 85000,
      followsCount: 392,
      postsCount: 128,
      verified: true,
      biography: "Most Realistic Pixie Wigs",
      profilePicture: "https://cdn/pfp.jpg",
    };
    const out = extractMetrics(item, IG_SCHEMA);
    expect(out.metrics).toEqual({
      followers: 85000,
      following: 392,
      posts: 128,
      verified: true,
      full_name: "Faitlyn Hair",
    });
    expect(out.follower_count).toBe(85000); // only the count-type "followers"
    expect(out.bio).toBe("Most Realistic Pixie Wigs");
    expect(out.avatar_url).toBe("https://cdn/pfp.jpg");
  });

  test("Google Business: decimal rating keeps 4.8 (not rounded), false bool retained", () => {
    const item = {
      title: "Faitlynhair",
      totalScore: 4.8,
      reviewsCount: 263,
      categoryName: "Beauty supply store",
      permanentlyClosed: false,
    };
    const out = extractMetrics(item, GBP_SCHEMA);
    expect(out.metrics).toEqual({
      rating: 4.8,
      reviews: 263,
      category: "Beauty supply store",
      closed: false,
    });
    expect(out.follower_count).toBeNull(); // no count-type followers/subscribers
  });

  test("bool coercion from a string word, and text joins arrays", () => {
    expect(extractMetrics({ verified: "true" }, IG_SCHEMA).metrics.verified).toBe(true);
    expect(
      extractMetrics({ specialties: ["Wigs", "HD Lace", "Frontals"] }, LINKEDIN_SCHEMA)
        .metrics.specialties,
    ).toBe("Wigs, HD Lace, Frontals");
  });

  test("untyped spec still behaves as a count (back-compat)", () => {
    const out = extractMetrics({ followers: 50 }, [
      { key: "followers", label: "Followers", aliases: ["followers"] },
    ]);
    expect(out.metrics.followers).toBe(50);
    expect(out.follower_count).toBe(50);
  });

  test("pluck reaches one nested level (e.g. authorStats)", () => {
    expect(pluck({ authorStats: { followerCount: 999 } }, ["followerCount"])).toBe(999);
  });
});
