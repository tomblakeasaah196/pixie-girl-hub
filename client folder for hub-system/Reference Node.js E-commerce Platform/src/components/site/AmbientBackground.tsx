import { useMemo } from "react";
import heroModel from "@/assets/hero-model.webp.asset.json";

/**
 * Subtle full-page background:
 * - The hero image, almost buried under an ink overlay (~92% opacity).
 * - A second cinematic gradient layer to deepen blacks.
 * - Sparse sparkle stars, randomised positions, gentle twinkle.
 * Fixed-position so it bleeds through every section.
 */
export function AmbientBackground() {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 22 }).map((_, i) => ({
        id: i,
        top: Math.random() * 100,
        left: Math.random() * 100,
        size: 0.8 + Math.random() * 1.6,
        delay: Math.random() * 10,
        duration: 6 + Math.random() * 8,
        hue: Math.random() > 0.85 ? "rose" : "taupe",
      })),
    [],
  );


  return (
    <div aria-hidden className="fixed inset-0 -z-10 pointer-events-none overflow-hidden bg-ink">
      {/* Buried hero image */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-[0.08]"
        style={{
          backgroundImage: `url(${heroModel.url})`,
          filter: "saturate(0.5) contrast(1.05)",
        }}
      />
      {/* Heavy brand-tinted overlay */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, color-mix(in oklch, var(--burgundy) 14%, transparent) 0%, transparent 55%), radial-gradient(ellipse at 75% 85%, color-mix(in oklch, var(--taupe) 8%, transparent) 0%, transparent 60%), linear-gradient(180deg, color-mix(in oklch, var(--ink) 96%, transparent) 0%, var(--ink) 100%)",
        }}
      />
      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, color-mix(in oklch, var(--ink) 70%, transparent) 100%)",
        }}
      />
      {/* Sparkles */}
      {sparkles.map((s) => (
        <span
          key={s.id}
          className="absolute rounded-full"
          style={{
            top: `${s.top}%`,
            left: `${s.left}%`,
            width: `${s.size}px`,
            height: `${s.size}px`,
            opacity: 0.22,
            background:
              s.hue === "rose"
                ? "color-mix(in oklch, var(--rose) 60%, white)"
                : "color-mix(in oklch, var(--taupe) 70%, white)",
            boxShadow: `0 0 ${s.size * 2.5}px ${
              s.hue === "rose" ? "color-mix(in oklch, var(--rose) 40%, transparent)" : "color-mix(in oklch, var(--taupe) 40%, transparent)"
            }`,
            animation: `sparkle ${s.duration}s ease-in-out ${s.delay}s infinite`,
          }}
        />
      ))}

    </div>
  );
}
