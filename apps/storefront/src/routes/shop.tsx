import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { getProducts, unwrap, priceFor, type ProductCard } from "@/lib/storefront";
import { ssrProducts } from "@/lib/server";
import { useCurrency } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";

export const Route = createFileRoute("/shop")({
  head: () => ({ meta: [{ title: "Shop the Catalogue — Faitlyn Hair" }] }),
  loader: async () => ssrProducts({ data: { pageSize: 24 } }),
  component: Shop,
});

function Shop() {
  const initial = Route.useLoaderData();
  const [currency] = useCurrency();
  const [page, setPage] = useState(1);
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["products", initial.brand, page],
    queryFn: async () =>
      (unwrap(await getProducts(`?page=${page}&page_size=24`)) as ProductCard[]) ?? [],
    initialData: page === 1 ? initial.products : undefined,
    placeholderData: keepPreviousData,
  });
  const products = data ?? [];
  const hasNext = products.length >= 24;

  // Scroll to top on catalogue page change (after the new page renders; not on
  // first mount). Runs in an effect so it fires regardless of async fetch timing.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [page]);

  const goto = (p: number) => setPage(Math.max(1, p));
  const s = withSlots(
    {
      eyebrow: "The Catalogue",
      heading: "Shop the ",
      headingAccent: "maison",
      headingAfter: ".",
      body: "Every silhouette, live from the Lagos atelier — hand-finished and shade-matched.",
    },
    usePageSlots("shop"),
  );

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-32 md:pt-28 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">{s.eyebrow}</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight">
            {s.heading}<em className="font-couture text-taupe">{s.headingAccent}</em>{s.headingAfter}
          </h1>
          <p className="mt-6 text-cream/70 leading-relaxed text-base md:text-lg">{s.body}</p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pb-32">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse bg-card" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="py-24 text-center text-cream/50">No products are available right now.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-6">
            {products.map((p, i) => (
              <motion.div
                key={p.styled_id}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.6, delay: (i % 4) * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link to="/product/$slug" params={{ slug: p.slug }} className="group block">
                  <div className="aspect-[3/4] overflow-hidden bg-card">
                    {p.cover_image_url ? (
                      <img src={p.cover_image_url} alt={p.name} loading="lazy" className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105" />
                    ) : null}
                  </div>
                  <h3 className="mt-4 font-display text-lg group-hover:text-taupe transition-colors">{p.name}</h3>
                  <p className="mt-1 text-body-sm text-taupe">{priceFor(p, currency)}</p>
                </Link>
              </motion.div>
            ))}
          </div>
        )}

        {products.length > 0 ? (
          <div className="mt-16 flex items-center justify-center gap-6">
            <button
              disabled={page === 1 || isFetching}
              onClick={() => goto(page - 1)}
              className="border border-taupe/40 px-6 py-3 text-[0.65rem] tracking-[0.35em] uppercase text-taupe transition-colors hover:bg-taupe/10 disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-[0.65rem] tracking-[0.35em] uppercase text-cream/60">
              Page {page}
            </span>
            <button
              disabled={!hasNext || isFetching}
              onClick={() => goto(page + 1)}
              className="border border-taupe/40 px-6 py-3 text-[0.65rem] tracking-[0.35em] uppercase text-taupe transition-colors hover:bg-taupe/10 disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
