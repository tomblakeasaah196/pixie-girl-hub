import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { getServices, fmt } from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import { usePageSlots, withSlots } from "@/lib/site-config";

export const Route = createFileRoute("/services")({
  head: () => ({ meta: [{ title: "Services & Bookings — Faitlyn Hair" }] }),
  component: ServicesIndex,
});

function ServicesIndex() {
  // This route is the PARENT of /services/$slug, so it must yield to child
  // routes via <Outlet/>; it only renders the index grid on the exact path.
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const [currency] = useCurrency();
  const { data, isLoading } = useQuery({ queryKey: ["services"], queryFn: () => getServices() });
  const services = data ?? [];
  const onIndex = pathname === "/services" || pathname === "/services/";
  const s = withSlots(
    {
      eyebrow: "Services · Prestations",
      heading: "Book with the ",
      headingAccent: "maison",
      headingAfter: ".",
      body: "Installs, in-home styling sessions and virtual consults — each booked with a senior Faitlyn stylist.",
    },
    usePageSlots("services"),
  );

  if (!onIndex) return <Outlet />;

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-32 md:pt-28 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-2xl"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">{s.eyebrow}</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight text-balance">
            {s.heading}<em className="font-couture text-taupe">{s.headingAccent}</em>{s.headingAfter}
          </h1>
          <p className="mt-6 text-cream/70 leading-relaxed text-base md:text-lg">{s.body}</p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pb-32">
        {isLoading ? (
          <div className="grid gap-px bg-taupe/15 border border-taupe/15 md:grid-cols-3">
            {[0, 1, 2].map((i) => <div key={i} className="bg-ink h-72 animate-pulse" />)}
          </div>
        ) : services.length === 0 ? (
          <p className="py-24 text-center text-cream/50">No services available yet.</p>
        ) : (
          <div className="grid gap-px bg-taupe/15 border border-taupe/15 md:grid-cols-3">
            {services.map((s, i) => {
              const meta = [s.tags?.[0], s.duration_minutes ? `${s.duration_minutes} min` : null]
                .filter(Boolean)
                .join(" · ");
              return (
                <motion.div
                  key={s.service_id}
                  initial={{ opacity: 0, y: 24 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 0.7, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
                  className="bg-ink"
                >
                  <Link to="/services/$slug" params={{ slug: s.slug }} className="group flex h-full flex-col p-8 md:p-10 min-h-[300px] hover:bg-card transition-colors">
                    <p className="text-[0.6rem] tracking-[0.4em] uppercase text-rose">
                      {i === 0 ? "Featured" : "Prestation"}
                    </p>
                    <h3 className="mt-4 font-display text-2xl md:text-3xl group-hover:text-taupe transition-colors">{s.name}</h3>
                    {s.short_description ? (
                      <p className="mt-3 text-cream/65 leading-relaxed text-body-sm">{s.short_description}</p>
                    ) : null}
                    <div className="mt-auto pt-8">
                      <div className="flex items-baseline gap-2">
                        {s.price_is_from ? <span className="text-[0.62rem] tracking-[0.3em] uppercase text-cream/50">From</span> : null}
                        <span className="font-display text-2xl text-taupe">
                          {fmt(currency === "USD" ? s.base_price_usd : s.base_price_ngn, currency)}
                        </span>
                        {s.compare_at_price_ngn && currency === "NGN" ? (
                          <span className="text-sm text-cream/40 line-through">{fmt(s.compare_at_price_ngn, "NGN")}</span>
                        ) : null}
                      </div>
                      {meta ? <p className="mt-3 text-[0.58rem] tracking-[0.3em] uppercase text-cream/45">{meta}</p> : null}
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
