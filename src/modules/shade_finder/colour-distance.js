/**
 * Perceptual colour distance for shade matching.
 *
 * sRGB hex → CIELAB → ΔE (CIE76). CIE76 is sufficient here: we are ranking
 * ~7 curated shade families against a perceived skin/hair colour, not doing
 * print calibration. All pure functions — unit-tested without a DB.
 */

"use strict";

/** '#1B1B1B' | '1B1B1B' | '#abc' → { r, g, b } 0-255, or null if invalid. */
function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) {
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** sRGB (0-255) → CIE-XYZ (D65) → CIELAB. */
function rgbToLab({ r, g, b }) {
  // Linearise sRGB
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
  // sRGB → XYZ (D65)
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
  const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;
  // Normalise by D65 white point
  const f = (t) =>
    t > 0.008856 ? Math.cbrt(t) : t * 7.787 + 16 / 116;
  const fx = f(x / 0.95047);
  const fy = f(y / 1.0);
  const fz = f(z / 1.08883);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/** ΔE (CIE76) between two hex strings. Infinity when either is unparsable. */
function deltaE(hexA, hexB) {
  const ra = hexToRgb(hexA);
  const rb = hexToRgb(hexB);
  if (!ra || !rb) return Infinity;
  const la = rgbToLab(ra);
  const lb = rgbToLab(rb);
  return Math.sqrt(
    (la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2,
  );
}

/**
 * Rank shades by perceptual closeness to one or more target hexes.
 * Each shade: { slug, swatches: [{ hex }] }. A shade's score is the MINIMUM
 * ΔE across (targets × swatches) — "how close is its nearest colourway".
 * Returns [{ slug, delta_e }] ascending (closest first); shades with no
 * usable swatch sort last with delta_e null.
 */
function rankShadesByDistance(shades, targetHexes) {
  const targets = (targetHexes || []).filter((h) => hexToRgb(h));
  return (shades || [])
    .map((sh) => {
      let best = Infinity;
      for (const sw of sh.swatches || []) {
        for (const th of targets) {
          const d = deltaE(th, sw.hex);
          if (d < best) best = d;
        }
      }
      return {
        slug: sh.slug,
        delta_e: Number.isFinite(best) ? Math.round(best * 10) / 10 : null,
      };
    })
    .sort((a, b) => {
      if (a.delta_e === null) return 1;
      if (b.delta_e === null) return -1;
      return a.delta_e - b.delta_e;
    });
}

module.exports = { hexToRgb, rgbToLab, deltaE, rankShadesByDistance };
