// @ts-nocheck
"use client";

import { useRef } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { LandingPayload } from "../types";
import { SectionHeader } from "./BundleShowcase";

export function LookbookCarousel({ payload }: { payload: LandingPayload }) {
  // Pull catalogue product images that came down with the payload.
  const tiles = (payload.products || [])
    .filter((p) => p.image_url)
    .slice(0, 12)
    .map((p) => ({ src: p.image_url!, alt: p.name || "" }));
  const trackRef = useRef<HTMLDivElement>(null);

  if (tiles.length < 3) return null;
  function scroll(dir: -1 | 1) {
    const el = trackRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (el.clientWidth * 0.8), behavior: "smooth" });
  }

  return (
    <section className="section">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader eyebrow="Lookbook" title="The way they wear it." />
        <div className="mt-10 relative">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => scroll(-1)}
            className="hidden md:grid place-items-center absolute left-0 top-1/2 -translate-y-1/2 -translate-x-3 z-10 w-10 h-10 rounded-full bg-[rgb(var(--panel)/0.85)] backdrop-blur border border-[rgb(var(--border-c)/0.1)]"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div
            ref={trackRef}
            className="no-scrollbar overflow-x-auto snap-x snap-mandatory scroll-smooth flex gap-3 -mx-6 px-6 md:mx-0 md:px-0"
          >
            {tiles.map((t, i) => (
              <div
                key={i}
                className="relative flex-shrink-0 w-[64vw] md:w-[260px] aspect-[9/16] rounded-[14px] overflow-hidden snap-start bg-[rgb(var(--panel-2))]"
              >
                <Image
                  src={t.src}
                  alt={t.alt}
                  fill
                  sizes="(min-width:768px) 260px, 64vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            aria-label="Next"
            onClick={() => scroll(1)}
            className="hidden md:grid place-items-center absolute right-0 top-1/2 -translate-y-1/2 translate-x-3 z-10 w-10 h-10 rounded-full bg-[rgb(var(--panel)/0.85)] backdrop-blur border border-[rgb(var(--border-c)/0.1)]"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
}
