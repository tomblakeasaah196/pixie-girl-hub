import useEmblaCarousel from "embla-carousel-react";
import { PRODUCTS } from "@/lib/products";
import { Link } from "@tanstack/react-router";

export function SignatureCarousel() {
  const [ref, embla] = useEmblaCarousel({ loop: true, align: "start", dragFree: true });
  return (
    <section className="py-28 md:py-40 overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 flex items-end justify-between mb-10">
        <div>
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Signature collection</p>
          <h2 className="font-display text-4xl md:text-6xl">The house edit</h2>
        </div>
        <div className="hidden md:flex gap-3">
          <button onClick={() => embla?.scrollPrev()} className="w-12 h-12 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors">←</button>
          <button onClick={() => embla?.scrollNext()} className="w-12 h-12 border border-taupe/40 text-taupe hover:bg-taupe hover:text-ink transition-colors">→</button>
        </div>
      </div>
      <div ref={ref} className="overflow-hidden">
        <div className="flex gap-5 pl-6 lg:pl-10">
          {PRODUCTS.map((p) => (
            <Link
              key={p.slug}
              to="/product/$slug"
              params={{ slug: p.slug }}
              className="group flex-[0_0_75%] sm:flex-[0_0_45%] lg:flex-[0_0_28%] relative aspect-[3/4] overflow-hidden bg-card"
            >
              <img src={p.images[0]} alt={p.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/90 to-transparent" />
              <div className="absolute bottom-0 inset-x-0 p-6">
                <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">{p.category}</p>
                <h3 className="font-display text-2xl mt-2">{p.name}</h3>
                <p className="text-xs text-taupe mt-1">${p.price}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
