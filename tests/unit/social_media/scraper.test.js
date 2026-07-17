"use strict";

const {
  extractMetrics,
  pluck,
} = require("../../../src/services/social-scraper.service");

// Metric schemas mirror what migration 000355 seeds for each platform, so this
// asserts the seeded aliases actually match the shapes those Apify actors return.
const X_SCHEMA = [
  { key: "followers", label: "Followers", aliases: ["followers", "followersCount", "followers_count"] },
  { key: "following", label: "Following", aliases: ["following", "followingCount", "friendsCount"] },
];
const GBP_SCHEMA = [
  { key: "rating", label: "Rating", aliases: ["totalScore", "rating", "averageRating"] },
  { key: "reviews", label: "Reviews", aliases: ["reviewsCount", "reviews_count", "userRatingCount"] },
];

describe("social-scraper extractMetrics", () => {
  test("apidojo Twitter/X item — followers, following, bio, profilePicture", () => {
    const item = {
      userName: "faitlynhair",
      followers: 12750,
      following: 318,
      description: "Most Realistic Pixie Wigs",
      profilePicture: "https://pbs.twimg.com/pfp.jpg",
    };
    const out = extractMetrics(item, X_SCHEMA);
    expect(out.metrics).toEqual({ followers: 12750, following: 318 });
    expect(out.follower_count).toBe(12750);
    expect(out.bio).toBe("Most Realistic Pixie Wigs");
    // profilePicture was added to AVATAR_ALIASES specifically for this shape
    expect(out.avatar_url).toBe("https://pbs.twimg.com/pfp.jpg");
  });

  test("Google Business item — rating/reviews, no follower_count (supports_bio=false)", () => {
    const item = { title: "Faitlynhair", totalScore: 4.8, reviewsCount: 263 };
    const out = extractMetrics(item, GBP_SCHEMA);
    expect(out.metrics).toEqual({ rating: 5, reviews: 263 }); // toCount rounds 4.8 -> 5
    expect(out.follower_count).toBeNull();
  });

  test("pluck reaches one nested level (e.g. authorStats)", () => {
    const item = { authorStats: { followerCount: 999 } };
    expect(pluck(item, ["followerCount"])).toBe(999);
  });
});
