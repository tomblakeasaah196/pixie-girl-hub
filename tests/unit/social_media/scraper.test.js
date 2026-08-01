"use strict";

jest.mock("../../../src/services/apify.service", () => ({
  buildActorInput: jest.fn(() => ({})),
  runActorSync: jest.fn(),
}));

const apify = require("../../../src/services/apify.service");
const {
  extractMetrics,
  pluck,
  itemErrorOf,
  scrapeAccount,
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
// Migration 000360's TikTok schema: the actor returns VIDEO items with the
// channel totals nested under authorMeta, so "likes" must only ever match
// heart/heartCount — never the video's own diggCount.
const TIKTOK_SCHEMA = [
  { key: "followers", label: "Followers", type: "count", aliases: ["fans", "followerCount", "followers"] },
  { key: "likes", label: "Likes", type: "count", aliases: ["heart", "heartCount"] },
  { key: "videos", label: "Videos", type: "count", aliases: ["video", "videoCount", "awemeCount"] },
  { key: "verified", label: "Verified", type: "bool", aliases: ["verified", "isVerified"] },
  { key: "bio_link", label: "Bio link", type: "text", aliases: ["bioLink", "bio_link"] },
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

  test("TikTok video item: channel totals from authorMeta, never the video's diggCount", () => {
    // Real clockworks/tiktok-profile-scraper shape: item = one video,
    // channel stats nested in authorMeta. The "27 likes" bug was diggCount
    // (this video's likes) winning over authorMeta.heart (channel total).
    const videoItem = {
      id: "728233…",
      text: "Why should I patronize you?",
      diggCount: 27,
      shareCount: 3,
      playCount: 332,
      commentCount: 4,
      authorMeta: {
        name: "faitlynhair_",
        fans: 713,
        heart: 3971,
        video: 57,
        verified: false,
        signature: "THE BEST PIXIE WIGS SPECIALIST",
        avatar: "https://cdn.tiktok/avatar.jpg",
      },
    };
    const out = extractMetrics(videoItem, TIKTOK_SCHEMA);
    expect(out.metrics.likes).toBe(3971); // NOT 27
    expect(out.metrics.followers).toBe(713);
    expect(out.metrics.videos).toBe(57);
    expect(out.metrics.verified).toBe(false);
    expect(out.follower_count).toBe(713);
    expect(out.bio).toBe("THE BEST PIXIE WIGS SPECIALIST");
    expect(out.avatar_url).toBe("https://cdn.tiktok/avatar.jpg");
  });
});

describe("social-scraper itemErrorOf", () => {
  test.each([
    [{ error: "not_found" }, "not_found"],
    [{ error: true, errorDescription: "Private profile" }, "Private profile"],
    [{ error: true }, "Actor reported an unspecified error for this profile"],
    [{ requestErrorMessages: ["blocked by Instagram"] }, "blocked by Instagram"],
  ])("detects %j", (item, expected) => {
    expect(itemErrorOf(item)).toBe(expected);
  });

  test("clean profile items are not errors", () => {
    expect(itemErrorOf({ followersCount: 85000, error: false })).toBeNull();
  });
});

describe("social-scraper scrapeAccount — soft failures never record bogus ok", () => {
  const platform = {
    display_name: "Instagram",
    apify_actor_id: "apify/instagram-profile-scraper",
    apify_input_template: { usernames: ["{{handle}}"] },
    metrics_schema: IG_SCHEMA,
  };
  const account = { handle: "faitlynhair", profile_url: null };

  test("an actor error record becomes a scrape error (old code recorded ok + wiped metrics)", async () => {
    apify.runActorSync.mockResolvedValueOnce([
      { error: "no_items", errorDescription: "Empty or private profile" },
    ]);
    const res = await scrapeAccount({ account, platform, apiKey: "k" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no_items");
  });

  test("a record matching none of the schema errors and names the returned fields", async () => {
    apify.runActorSync.mockResolvedValueOnce([{ username: "faitlynhair", inputUrl: "…" }]);
    const res = await scrapeAccount({ account, platform, apiKey: "k" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("username, inputUrl");
  });

  test("a good record still succeeds", async () => {
    apify.runActorSync.mockResolvedValueOnce([{ followersCount: 85000, verified: true }]);
    const res = await scrapeAccount({ account, platform, apiKey: "k" });
    expect(res.ok).toBe(true);
    expect(res.follower_count).toBe(85000);
  });
});
