import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { listServices, type ServiceCard as ServiceCardT } from "@/lib/services.functions";
import { ogMeta, jsonLd, breadcrumbLd, itemListLd, clamp } from "@/lib/seo";
import { useCurrency } from "@/lib/currency";

export const Route = createFileRoute("/services")({
  head: () => {
    const title = "Services & Bookings — Faitlyn Studio Lagos";
    const description = clamp("Book a Faitlyn install, in-home styling, or virtual consultation. Senior stylists, Lagos studio, worldwide virtual.", 158);
    const url = "/services";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(breadcrumbLd([{ name: "Home", url: "/" }, { name: "Services", url }])),
      ],
    };
  },
  component: ServicesPage,
});

function ServicesPage() {
  const fetcher = useServerFn(listServices);
  const { data: services = [] } = useQuery({
    queryKey: ["services", "list"],
    queryFn: () => fetcher({}),
  });

  return (
    <>
      <SiteHeader />
      <main className="pt-32 pb-24">
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10">
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Services · prestations</p>
          <h1 className="font-display text-5xl md:text-7xl tracking-tight mb-3">Book with the maison.</h1>
          <p className="text-cream/70 max-w-2xl mb-16">
            Installs, in-home styling sessions and virtual consults — each booked with a senior Faitlyn stylist.
          </p>

          {services.length === 0 ? (
            <p className="text-cream/60 py-20 text-center">No services published yet — please check back soon.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-taupe/15 border border-taupe/15">
              {services.map((s) => <ServiceCard key={s.id} service={s} />)}
            </div>
          )}

          {services.length > 0 && (
            <script
              type="application/ld+json"
              // ItemList JSON-LD for the catalogue
              dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd(services.map((s) => ({ name: s.name, url: `/services/${s.slug}` })))) }}
            />
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

function ServiceCard({ service }: { service: ServiceCardT }) {
  const { format } = useCurrency();
  const priceLabel =
    service.price_ngn != null
      ? `${service.price_is_from ? "From " : ""}${format(service.price_ngn / 1650, { ngnOverride: service.price_ngn })}`
      : "Price on request";
  const compare =
    service.compare_at_price_ngn != null
      ? format(service.compare_at_price_ngn / 1650, { ngnOverride: service.compare_at_price_ngn })
      : null;

  return (
    <Link
      to="/services/$slug"
      params={{ slug: service.slug }}
      className="bg-ink p-7 flex flex-col min-h-[280px] group hover:bg-card transition-colors"
    >
      {service.is_featured && (
        <span className="text-[0.55rem] tracking-[0.4em] uppercase text-rose mb-3">Featured</span>
      )}
      <h2 className="text-h5 text-cream">{service.name}</h2>
      <p className="text-body-sm text-cream/65 mt-2 flex-1">{service.short_description}</p>
      <div className="mt-5 flex items-baseline gap-3">
        <span className="text-taupe font-display text-lg">{priceLabel}</span>
        {compare && <span className="text-cream/40 text-sm line-through">{compare}</span>}
      </div>
      <div className="mt-3 flex items-center gap-3 text-[0.6rem] tracking-[0.3em] uppercase text-cream/55">
        <span>{service.location_type === "studio" ? "In studio" : service.location_type === "home" ? "At your home" : "Virtual"}</span>
        {service.duration_minutes ? <span>· {service.duration_minutes} min</span> : null}
      </div>
    </Link>
  );
}
