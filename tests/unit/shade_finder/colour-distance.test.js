"use strict";

const {
  hexToRgb,
  rgbToLab,
  deltaE,
  rankShadesByDistance,
} = require("../../../src/modules/shade_finder/colour-distance");

describe("shade finder colour distance", () => {
  test("hexToRgb parses 6-digit, 3-digit, and bare hex", () => {
    expect(hexToRgb("#1B1B1B")).toEqual({ r: 27, g: 27, b: 27 });
    expect(hexToRgb("1B1B1B")).toEqual({ r: 27, g: 27, b: 27 });
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  test("hexToRgb rejects garbage", () => {
    expect(hexToRgb("not-a-hex")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull();
    expect(hexToRgb(null)).toBeNull();
  });

  test("rgbToLab hits reference white and black", () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(100, 0);
    expect(white.a).toBeCloseTo(0, 0);
    const black = rgbToLab({ r: 0, g: 0, b: 0 });
    expect(black.L).toBeCloseTo(0, 0);
  });

  test("deltaE: identical colours are 0, black/white are far apart", () => {
    expect(deltaE("#690909", "#690909")).toBe(0);
    expect(deltaE("#000000", "#ffffff")).toBeGreaterThan(90);
  });

  test("deltaE is Infinity on unparsable input", () => {
    expect(deltaE("nope", "#000000")).toBe(Infinity);
  });

  test("perceptually close browns beat distant blondes", () => {
    // Deep brown skin hex vs a near-brown swatch and a platinum swatch.
    const nearBrown = deltaE("#5a3a26", "#4d3220");
    const platinum = deltaE("#5a3a26", "#e8d8b0");
    expect(nearBrown).toBeLessThan(platinum);
  });

  test("rankShadesByDistance orders by nearest swatch", () => {
    const shades = [
      { slug: "icy", swatches: [{ hex: "#e8e6e1" }, { hex: "#cfd4d8" }] },
      { slug: "espresso", swatches: [{ hex: "#2a1a12" }, { hex: "#3c2415" }] },
      { slug: "plum", swatches: [{ hex: "#4a1f33" }] },
    ];
    const ranked = rankShadesByDistance(shades, ["#31201a"]); // deep warm brown
    expect(ranked[0].slug).toBe("espresso");
    expect(ranked.map((r) => r.slug)).toContain("icy");
    expect(ranked[0].delta_e).toBeLessThan(ranked[2].delta_e);
  });

  test("shades without usable swatches sort last with null distance", () => {
    const shades = [
      { slug: "mystery", swatches: [] },
      { slug: "espresso", swatches: [{ hex: "#2a1a12" }] },
    ];
    const ranked = rankShadesByDistance(shades, ["#31201a"]);
    expect(ranked[0].slug).toBe("espresso");
    expect(ranked[1]).toEqual({ slug: "mystery", delta_e: null });
  });
});
