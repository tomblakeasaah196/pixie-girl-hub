import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { fmt } from "@/lib/storefront";
import {
  DEFAULT_HOME,
  DEMO_BUNDLE_ITEMS,
  type BundleItem,
  type HeadContent,
} from "@/lib/home-content";

/**
 * Bundles as a single horizontal line that auto-scrolls, like a couture ribbon
 * of ensembles. The card list is duplicated once and the track slides -50% on a
 * loop (seamless because every card carries an equal right margin). Hovering
 * pauses it so a shopper can click; the global reduced-motion rule stops it too.
 */
export function BundleMarquee({
  head = DEFAULT_HOME.bundlesHead,
  items,
}: {
  head?: HeadContent;
  items?: BundleItem[];
}) {
  const bundles = items && items.length ? items : DEMO_BUNDLE_ITEMS;
  // Slower for a short list, but never a frantic loop for a long one.
  const duration = Math.max(20, bundles.length * 6);
  const track = [...bundles, ...bundles];

  return (
    <section className="py-24 md:py-36 overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex items-end justify-between mb-10 gap-8">
        <div>
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">{head.eyebrow}</p>
          <h2 className="font-display text-4xl md:text-6xl leading-[0.95] tracking-tight max-w-2xl text-balance">
            {head.heading}
            {head.headingAccent ? <em className="gold-shimmer not-italic">{head.headingAccent}</em> : null}
            {head.headingAfter}
          </h2>
        </div>
        {head.linkHref ? (
          <a href={head.linkHref} className="hidden md:block text-[0.7rem] tracking-[0.4em] uppercase text-taupe border-b border-taupe/40 pb-1 hover:text-cream hover:border-cream transition-colors whitespace-nowrap">
            {head.linkLabel ?? "All bundles →"}
          </a>
        ) : null}
      </div>

      <div className="relative">
        <div
          className="flex w-max marquee-track"
          style={{ "--marquee-duration": `${duration}s` } as CSSProperties}
        >
          {track.map((b, i) => (
            <Link
              key={`${b.slug}-${i}`}
              to="/bundles/$slug"
              params={{ slug: b.slug }}
              aria-hidden={i >= bundles.length}
              tabIndex={i >= bundles.length ? -1 : undefined}
              className="group relative block w-[240px] sm:w-[280px] shrink-0 mr-4 md:mr-5 aspect-[4/5] overflow-hidden bg-card rounded-lg"
            >
              {b.cover && (
                <img
                  src={b.cover}
                  alt={b.name}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110"
                />
              )}
              <div className="absolute inset-0 sf-image-scrim" />
              <div className="absolute bottom-0 inset-x-0 p-5">
                <h3 className="font-display text-xl text-cream leading-tight">{b.name}</h3>
              </div>
              <BundlePill
                savingsPct={b.savingsPct}
                priceNgn={b.priceNgn}
                compareAtNgn={b.compareAtNgn}
              />
            </Link>
          ))}
        </div>

        {/* Soft edge fades so cards melt in/out of the page rather than clip. */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-12 md:w-24 bg-gradient-to-r from-ink to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-12 md:w-24 bg-gradient-to-l from-ink to-transparent" />
      </div>
    </section>
  );
}

function BundlePill({
  savingsPct,
  priceNgn,
  compareAtNgn,
}: {
  savingsPct: number;
  priceNgn: number;
  compareAtNgn: number;
}) {
  const hasDiscount = savingsPct > 0;
  if (!hasDiscount && priceNgn <= 0) return null;
  return (
    <span
      className="absolute top-4 left-4 flex flex-col items-start bg-taupe/85 backdrop-blur-sm text-ink px-3 py-1.5 rounded-sm"
      style={{ animation: "bundle-pill-glow 3s ease-in-out infinite" }}
    >
      {hasDiscount && (
        <span className="text-[0.6rem] tracking-[0.4em] uppercase">Save {savingsPct}%</span>
      )}
      <span className="flex items-baseline gap-2">
        <span className="text-[0.6rem] tracking-[0.2em]">{fmt(priceNgn, "NGN")}</span>
        {compareAtNgn > priceNgn && (
          <span className="text-[0.5rem] tracking-[0.1em] text-ink/50 line-through">
            {fmt(compareAtNgn, "NGN")}
          </span>
        )}
      </span>
    </span>
  );
}
