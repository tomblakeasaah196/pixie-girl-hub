import { Link } from "@tanstack/react-router";
import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import { fmt } from "@/lib/storefront";
import {
  DEFAULT_HOME,
  DEMO_BUNDLE_ITEMS,
  type BundleItem,
  type HeadContent,
} from "@/lib/home-content";

/**
 * Bundles ensemble grid. `items` come live from the Hub (/bundles); falls back
 * to the ported demo bundles so the look is identical before the catalogue is
 * seeded. Bundles are NGN-only on the backend (no USD column).
 */
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
              className="group relative block w-full h-[420px] md:h-[520px] overflow-hidden bg-card"
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
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
              {b.savingsPct > 0 ? (
                <span className="absolute top-5 left-5 bg-rose text-ink text-[0.6rem] tracking-[0.4em] uppercase px-3 py-1.5">
                  Save {b.savingsPct}%
                </span>
              ) : null}
              <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
                <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-2">
                  {b.members}-piece bundle
                </p>
                <h3 className="font-display text-3xl md:text-4xl text-cream leading-tight">{b.name}</h3>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="text-xl font-display text-taupe">{fmt(b.priceNgn, "NGN")}</span>
                  {b.compareAtNgn > b.priceNgn ? (
                    <span className="text-sm text-cream/40 line-through">{fmt(b.compareAtNgn, "NGN")}</span>
                  ) : null}
                  <span className="ml-auto text-[0.6rem] tracking-[0.4em] uppercase text-taupe opacity-0 group-hover:opacity-100 translate-x-[-8px] group-hover:translate-x-0 transition-all duration-500">
                    See bundle →
                  </span>
                </div>
              </div>
            </Link>
          </RevealItem>
        ))}
      </RevealGroup>
    </section>
  );
}
