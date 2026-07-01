import useEmblaCarousel from "embla-carousel-react";
import { Price } from "@/components/site/Price";
import {
  DEFAULT_HOME,
  DEMO_SIGNATURE,
  type SignatureItem,
  type HeadContent,
} from "@/lib/home-content";

/**
 * Signature product carousel. `items` come live from the Hub (/products) with
 * their cover images + dual-currency prices; falls back to the ported demo set.
 */
export function SignatureCarousel({
  head = DEFAULT_HOME.signatureHead,
  items,
}: {
  head?: HeadContent;
  items?: SignatureItem[];
}) {
  const products = items && items.length ? items : DEMO_SIGNATURE;
  const [ref, embla] = useEmblaCarousel({ loop: true, align: "start", dragFree: true });
  return (
    <section className="py-28 md:py-40 overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex items-end justify-between mb-10">
        <div>
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">{head.eyebrow}</p>
          <h2 className="font-display text-4xl md:text-6xl">
            {head.heading}
            {head.headingAccent ? <em className="font-couture text-taupe">{head.headingAccent}</em> : null}
          </h2>
        </div>
        <div className="hidden md:flex gap-3">
          <button onClick={() => embla?.scrollPrev()} className="w-12 h-12 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors">←</button>
          <button onClick={() => embla?.scrollNext()} className="w-12 h-12 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors">→</button>
        </div>
      </div>
      <div ref={ref} className="overflow-hidden">
        <div className="flex gap-5 pl-6 lg:pl-10">
          {products.map((p) => (
            <a
              key={p.slug}
              href={`/product/${p.slug}`}
              className="group flex-[0_0_75%] sm:flex-[0_0_45%] lg:flex-[0_0_28%] relative aspect-[3/4] overflow-hidden bg-card"
            >
              {p.image ? (
                <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-ink/90 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-6">
                {p.category ? <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">{p.category}</p> : null}
                <h3 className="font-display text-2xl mt-2 text-cream">{p.name}</h3>
                <Price usd={Number(p.priceUsd) || 0} ngnOverride={Number(p.priceNgn) || 0} className="text-xs text-taupe mt-1 block" />
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
