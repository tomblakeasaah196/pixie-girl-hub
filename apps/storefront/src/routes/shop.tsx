import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
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
  const { data, isLoading } = useQuery({
    queryKey: ["products", initial.brand],
    queryFn: async () =>
      (unwrap(await getProducts("?page=1&page_size=24")) as ProductCard[]) ?? [],
    initialData: initial.products,
  });
  const products = data ?? [];
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
      </section>
    </main>
  );
}
