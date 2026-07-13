import { Link } from "@tanstack/react-router";
import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import { fmt } from "@/lib/storefront";
import {
  DEFAULT_HOME,
  DEMO_BUNDLE_ITEMS,
  type BundleItem,
  type HeadContent,
} from "@/lib/home-content";

export function BentoGrid({
  head = DEFAULT_HOME.bundlesHead,
  items,
}: {
  head?: HeadContent;
  items?: BundleItem[];
}) {
  const bundles = (items && items.length ? items : DEMO_BUNDLE_ITEMS).slice(0, 4);
  return (
    <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-40">
      <div className="flex items-end justify-between mb-14 gap-8">
        <div>
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">{head.eyebrow}</p>
          <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-2xl text-balance">
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
      <RevealGroup className="grid md:grid-cols-2 gap-4">
        {bundles.map((b) => (
          <RevealItem key={b.slug}>
            <Link
              to="/bundles/$slug"
              params={{ slug: b.slug }}
              className="group relative block w-full aspect-[4/5] overflow-hidden bg-card rounded-lg"
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
              <BundlePill
                savingsPct={b.savingsPct}
                priceNgn={b.priceNgn}
                compareAtNgn={b.compareAtNgn}
              />
            </Link>
          </RevealItem>
        ))}
      </RevealGroup>
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
      className="absolute top-5 left-5 flex flex-col items-start bg-taupe/85 backdrop-blur-sm text-ink px-3 py-1.5 rounded-sm"
      style={{ animation: "bundle-pill-glow 3s ease-in-out infinite" }}
    >
      {hasDiscount && (
        <span className="text-[0.6rem] tracking-[0.4em] uppercase">
          Save {savingsPct}%
        </span>
      )}
      <span className="flex items-baseline gap-2">
        <span className="text-[0.6rem] tracking-[0.2em]">
          {fmt(priceNgn, "NGN")}
        </span>
        {compareAtNgn > priceNgn && (
          <span className="text-[0.5rem] tracking-[0.1em] text-ink/50 line-through">
            {fmt(compareAtNgn, "NGN")}
          </span>
        )}
      </span>
    </span>
  );
}
