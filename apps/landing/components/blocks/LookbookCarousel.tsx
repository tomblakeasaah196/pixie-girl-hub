"use client";

import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import type { LandingPayload } from "@/lib/types";
import { CreatorModal } from "../creator/CreatorModal";

/**
 * Aspect ratios by original tile index create organic height variation across
 * the 3 columns (tiles are distributed as i%3: 0→left, 1→center, 2→right).
 *
 * Col-left   (0,3,6,9): medium → tall → medium → medium
 * Col-center (1,4,7):   tall   → medium → tall
 * Col-right  (2,5,8):   square → portrait → medium
 *
 * This stagger matches the reference masonry layout without needing CSS columns
 * or a JS masonry library — pure flexbox columns + forced aspect ratios.
 */
const ASPECT: string[] = [
  "aspect-[3/4]", // 0  col-left   first
  "aspect-[2/3]", // 1  col-center first  (taller)
  "aspect-[1/1]", // 2  col-right  first  (square)
  "aspect-[3/5]", // 3  col-left   second (tallest in this col)
  "aspect-[4/5]", // 4  col-center second
  "aspect-[4/5]", // 5  col-right  second
  "aspect-[4/5]", // 6  col-left   third
  "aspect-[2/3]", // 7  col-center third  (tall again)
  "aspect-[3/4]", // 8  col-right  third
  "aspect-[4/5]", // 9  col-left   fourth (overflow)
];

export function LookbookCarousel({ payload }: { payload: LandingPayload }) {
  const [creatorOpen, setCreatorOpen] = useState(false);

  const block = (payload.blocks || []).find((b) => b.key === "lookbook_carousel");
  const bp = (block?.props as Record<string, unknown>) || {};
  const eyebrow = (bp.eyebrow as string) || "Lookbook";
  const title = (bp.title as string) || "The way they wear it.";
  const ctaLabel = (bp.cta_label as string) || "Become a Creator";
  const ctaEnabled = bp.cta_enabled !== false;

  // Block-level curated images take priority; fall back to product catalogue images.
  const blockImages = Array.isArray(bp.images)
    ? (bp.images as string[]).filter(Boolean).map((src) => ({ src, alt: "" }))
    : [];
  const catalogueTiles = (payload.products || [])
    .filter((p) => p.image_url)
    .slice(0, 12)
    .map((p) => ({ src: p.image_url!, alt: p.name || "" }));
  const tiles = blockImages.length >= 3 ? blockImages : catalogueTiles;

  if (tiles.length < 3) return null;

  // Split tiles across 3 columns by index mod 3 to preserve the ASPECT pattern.
  const cols = [0, 1, 2].map((col) =>
    tiles.map((t, i) => ({ t, i })).filter(({ i }) => i % 3 === col),
  );

  return (
    <>
      {/* Cream island — intentional contrast break from the dark landing page */}
      <section className="py-16 md:py-24" style={{ background: "#F5EDE8" }}>
        <div className="mx-auto max-w-[1180px] px-4 md:px-6">

          {/* Section header — dark text on cream */}
          <div className="mb-10 text-center md:mb-14">
            <p
              className="mb-3 text-[10px] font-bold uppercase tracking-[0.35em]"
              style={{ color: "#9A7060" }}
            >
              {eyebrow}
            </p>
            <h2
              className="text-[clamp(2rem,4vw,3rem)] font-display leading-[1.1] tracking-[-0.015em]"
              style={{ color: "#1C0E0A", fontFamily: "var(--font-display)" }}
            >
              {title}
            </h2>
          </div>

          {/* 3-column masonry grid */}
          <div className="grid grid-cols-3 gap-2 md:gap-3">
            {cols.map((col, ci) => (
              <div key={ci} className="flex flex-col gap-2 md:gap-3">
                {col.map(({ t, i }) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 18 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: "-50px" }}
                    transition={{
                      delay: (ci * 0.08) + (Math.floor(i / 3) * 0.06),
                      duration: 0.55,
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                    className={`group relative overflow-hidden rounded-xl md:rounded-[14px] ${ASPECT[i] ?? "aspect-[4/5]"}`}
                    style={{ boxShadow: "0 2px 14px rgb(0 0 0 / 0.09)" }}
                  >
                    <Image
                      src={t.src}
                      alt={t.alt}
                      fill
                      sizes="(min-width: 1180px) 380px, 33vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  </motion.div>
                ))}
              </div>
            ))}
          </div>

          {/* Creator CTA */}
          {ctaEnabled && (
            <motion.div
              className="mt-12 flex justify-center md:mt-16"
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <button
                type="button"
                onClick={() => setCreatorOpen(true)}
                className="cta-sheen inline-flex items-center gap-2.5 rounded-[14px] px-10 py-[14px] text-[15px] font-semibold text-white shadow-[0_6px_24px_rgb(0_0_0/0.22)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgb(0_0_0/0.28)]"
                style={{ background: "rgb(var(--accent-deep))" }}
              >
                <span aria-hidden="true">✦</span>
                {ctaLabel}
                <span aria-hidden="true">✦</span>
              </button>
            </motion.div>
          )}
        </div>
      </section>

      <CreatorModal
        open={creatorOpen}
        onClose={() => setCreatorOpen(false)}
        payload={payload}
      />
    </>
  );
}
