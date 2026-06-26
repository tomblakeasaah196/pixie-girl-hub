import { Link } from "@tanstack/react-router";
import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import { Price } from "@/components/site/Price";
import {
  BUNDLES,
  bundleCompareAtUsd,
  bundleCompareAtNgn,
  bundleSavingsPct,
  getBundleProducts,
} from "@/lib/bundles";

export function BentoGrid() {
  const bundles = BUNDLES.slice(0, 4);
  return (
    <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-40">
      <div className="flex items-end justify-between mb-14 gap-8">
        <div>
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Shop the edit · ensembles</p>
          <h2 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight max-w-2xl text-balance">
            Curated <em className="gold-shimmer not-italic">bundles</em>. Better together.
          </h2>
        </div>
        <Link to="/bundles" className="hidden md:block text-[0.7rem] tracking-[0.4em] uppercase text-taupe border-b border-taupe/40 pb-1 hover:text-cream hover:border-cream transition-colors whitespace-nowrap">
          All bundles →
        </Link>
      </div>
      <RevealGroup className="grid md:grid-cols-2 gap-4">
        {bundles.map((b) => {
          const members = getBundleProducts(b);
          const cover = b.image ?? members[0]?.images[0];
          return (
            <RevealItem key={b.slug}>
              <Link
                to="/bundles/$slug"
                params={{ slug: b.slug }}
                className="group relative block w-full h-[420px] md:h-[520px] overflow-hidden bg-card"
              >
                {cover && (
                  <img
                    src={cover}
                    alt={b.name}
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover transition-transform duration-[1400ms] ease-out group-hover:scale-110"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
                <span className="absolute top-5 left-5 bg-rose text-ink text-[0.6rem] tracking-[0.4em] uppercase px-3 py-1.5">
                  Save {bundleSavingsPct(b)}%
                </span>
                <div className="absolute inset-x-0 bottom-0 p-6 md:p-8">
                  <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-2">
                    {members.length}-piece bundle
                  </p>
                  <h3 className="font-display text-3xl md:text-4xl text-cream leading-tight">{b.name}</h3>
                  <div className="mt-3 flex items-baseline gap-3">
                    <Price usd={b.priceUsd} ngnOverride={b.priceNgn} className="text-xl font-display text-taupe" />
                    <Price
                      usd={bundleCompareAtUsd(b)}
                      ngnOverride={bundleCompareAtNgn(b)}
                      className="text-sm text-cream/40 line-through"
                    />
                    <span className="ml-auto text-[0.6rem] tracking-[0.4em] uppercase text-taupe opacity-0 group-hover:opacity-100 translate-x-[-8px] group-hover:translate-x-0 transition-all duration-500">
                      See bundle →
                    </span>
                  </div>
                </div>
              </Link>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </section>
  );
}
