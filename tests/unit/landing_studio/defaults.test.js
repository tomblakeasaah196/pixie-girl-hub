"use strict";

const {
  defaultConfig,
  withDefaults,
} = require("../../../src/modules/landing_studio/landing.defaults");

describe("landing.defaults — defaultConfig", () => {
  it("returns the Faitlyn brand defaults with a 3D logo reveal", () => {
    const d = defaultConfig("faitlynhair");
    expect(d.brandName).toBe("Faitlyn Hair");
    expect(d.reveal.threeD).toMatchObject({
      enabled: true,
      variant: "logo-static",
      brandType: "faitlynhair",
    });
  });

  it("falls back to Pixie Girl defaults (text reveal) for any other key", () => {
    const d = defaultConfig("pixiegirl");
    expect(d.brandName).toBe("Pixie Girl Global");
    expect(d.reveal.threeD.variant).toBe("text-dual");
    // Unknown brand keys default to Pixie Girl rather than throwing.
    expect(defaultConfig("unknown").brandName).toBe("Pixie Girl Global");
  });
});

describe("landing.defaults — withDefaults", () => {
  it("returns the full brand default when the stored config is null", () => {
    expect(withDefaults("faitlynhair", null)).toEqual(defaultConfig("faitlynhair"));
    expect(withDefaults("pixiegirl", undefined)).toEqual(defaultConfig("pixiegirl"));
  });

  it("injects reveal.threeD when an older published snapshot omits it", () => {
    // This is the exact shape migration 000225 seeded — no threeD block.
    const seeded = {
      reveal: { enabled: true, tagline: "Quietly extraordinary.", showScarcity: true },
    };
    const merged = withDefaults("faitlynhair", seeded);
    expect(merged.reveal.threeD).toMatchObject({
      enabled: true,
      variant: "logo-static",
    });
    // ...without clobbering the fields the snapshot did set.
    expect(merged.reveal.tagline).toBe("Quietly extraordinary.");
    expect(merged.reveal.showScarcity).toBe(true);
  });

  it("deep-merges nested objects key-by-key (theme)", () => {
    const merged = withDefaults("pixiegirl", { theme: { primary: "#000000" } });
    expect(merged.theme.primary).toBe("#000000"); // override wins
    expect(merged.theme.accent).toBe(defaultConfig("pixiegirl").theme.accent); // default kept
  });

  it("merges a partial threeD over the brand default", () => {
    const merged = withDefaults("faitlynhair", { reveal: { threeD: { rotationSpeed: 2.5 } } });
    expect(merged.reveal.threeD.rotationSpeed).toBe(2.5); // provided wins
    expect(merged.reveal.threeD.enabled).toBe(true); // default kept
    expect(merged.reveal.threeD.variant).toBe("logo-static"); // default kept
  });

  it("lets stored scalar values win over defaults", () => {
    const merged = withDefaults("pixiegirl", { brandName: "Custom House" });
    expect(merged.brandName).toBe("Custom House");
  });

  it("falls back to default arrays only when the stored array is empty/absent", () => {
    const fallback = withDefaults("pixiegirl", { socials: [] });
    expect(fallback.socials.length).toBeGreaterThan(0);

    const provided = withDefaults("pixiegirl", {
      socials: [{ platform: "x", href: "https://x.com/h" }],
    });
    expect(provided.socials).toHaveLength(1);
  });
});
