// @ts-nocheck
"use client";

import Image from "next/image";
import { Instagram } from "lucide-react";
import type { LandingPayload } from "../types";
import { SectionHeader } from "./BundleShowcase";

interface UgcItem {
  src: string;
  alt?: string;
  caption?: string;
  handle?: string;
  href?: string;
}

export function UgcCarousel({ payload }: { payload: LandingPayload }) {
  const block = (payload.blocks || []).find((b) => b.key === "ugc_carousel");
  const items = (block?.props?.items as UgcItem[]) || [];
  if (!items.length) return null;
  return (
    <section className="section">
      <div className="mx-auto max-w-[1180px]">
        <SectionHeader
          eyebrow="From the community"
          title="They wore it. Their words."
        />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-10">
          {items.slice(0, 8).map((it, i) => (
            <a
              key={i}
              href={it.href || "#"}
              target={it.href ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="relative aspect-square rounded-[14px] overflow-hidden block group"
            >
              {it.src && (
                <Image
                  src={it.src}
                  alt={it.alt || ""}
                  fill
                  sizes="(min-width:768px) 25vw, 50vw"
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                />
              )}
              {it.handle && (
                <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-[rgb(0_0_0/0.55)] backdrop-blur text-[rgb(var(--text))]">
                  <Instagram className="w-3 h-3" /> @{it.handle}
                </div>
              )}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
