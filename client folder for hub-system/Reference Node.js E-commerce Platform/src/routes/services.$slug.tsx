import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { getService, type ServiceDetail } from "@/lib/services.functions";
import { BookingDrawer } from "@/components/services/BookingDrawer";
import { useCurrency } from "@/lib/currency";
import { ogMeta, jsonLd, breadcrumbLd, serviceLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/services/$slug")({
  loader: async ({ params }) => {
    // Loader runs SSR; call the public server fn directly.
    const service = await getService({ data: { slug: params.slug } });
    if (!service) throw notFound();
    return { service };
  },
  head: ({ params, loaderData }) => {
    const s = loaderData?.service;
    if (!s) return { meta: [{ title: "Service — Faitlyn Hair" }] };
    const url = `/services/${params.slug}`;
    const title = clamp(s.meta_title ?? `${s.name} — Book with Faitlyn`, 70);
    const description = clamp(s.meta_description ?? s.short_description ?? s.long_description ?? "", 158);
    const image = s.thumbnail_url ?? s.gallery_urls[0];
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, image: image ?? undefined }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Services", url: "/services" },
          { name: s.name, url },
        ])),
        jsonLd(serviceLd({ name: s.name, description, url, image: image ?? undefined, priceNgn: s.price_ngn })),
      ],
    };
  },
  errorComponent: () => <div className="p-20 text-center">Something went wrong.</div>,
  notFoundComponent: () => <div className="p-20 text-center">Service not found.</div>,
  component: ServiceDetailPage,
});

function ServiceDetailPage() {
  const { service: initial } = Route.useLoaderData();
  const fetcher = useServerFn(getService);
  const { data: service = initial } = useQuery({
    queryKey: ["service", initial.slug],
    queryFn: () => fetcher({ data: { slug: initial.slug } }) as Promise<ServiceDetail>,
    initialData: initial,
  });
  const { format } = useCurrency();
  const [open, setOpen] = useState(false);

  if (!service) return null;

  const priceLabel =
    service.price_ngn != null
      ? `${service.price_is_from ? "From " : ""}${format(service.price_ngn / 1650, { ngnOverride: service.price_ngn })}`
      : "Price on request";
  const compare =
    service.compare_at_price_ngn != null
      ? format(service.compare_at_price_ngn / 1650, { ngnOverride: service.compare_at_price_ngn })
      : null;

  const locationLabel =
    service.location_type === "studio" ? "In our Lagos studio"
    : service.location_type === "home" ? "At your home (Lagos)"
    : "Live video consultation";

  return (
    <>
      <SiteHeader />
      <main className="pt-32 pb-24">
        <section className="mx-auto max-w-[1200px] px-6 lg:px-10">
          <Link to="/services" className="text-[0.65rem] tracking-[0.4em] uppercase text-taupe hover:text-cream">← All services</Link>

          <div className="grid md:grid-cols-[1fr_1.1fr] gap-12 mt-8 items-start">
            <div className="aspect-[4/5] bg-card relative overflow-hidden border border-taupe/15">
              {(service.thumbnail_url ?? service.gallery_urls[0]) && (
                <img
                  src={service.thumbnail_url ?? service.gallery_urls[0]}
                  alt={service.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
            </div>

            <div>
              <p className="text-[0.65rem] tracking-[0.5em] uppercase text-taupe">{locationLabel}</p>
              <h1 className="font-display text-5xl md:text-6xl leading-[1.05] mt-3">{service.name}</h1>
              {service.short_description && <p className="text-cream/75 mt-4 text-lg">{service.short_description}</p>}

              <div className="mt-7 flex items-baseline gap-4">
                <span className="text-3xl font-display text-taupe">{priceLabel}</span>
                {compare && <span className="text-cream/40 line-through">{compare}</span>}
              </div>

              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                {service.duration_minutes != null && (
                  <>
                    <dt className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">Duration</dt>
                    <dd className="text-cream/80">{service.duration_minutes} minutes</dd>
                  </>
                )}
                {service.required_stylist_tier && (
                  <>
                    <dt className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">Stylist</dt>
                    <dd className="text-cream/80 capitalize">{service.required_stylist_tier}</dd>
                  </>
                )}
                {service.deposit_required && (
                  <>
                    <dt className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">Deposit</dt>
                    <dd className="text-cream/80">
                      {service.deposit_pct
                        ? `${service.deposit_pct}% to confirm`
                        : service.deposit_amount_ngn
                          ? `${format(service.deposit_amount_ngn / 1650, { ngnOverride: service.deposit_amount_ngn })} to confirm`
                          : "Required"}
                    </dd>
                  </>
                )}
              </dl>

              {service.is_bookable ? (
                <button
                  onClick={() => setOpen(true)}
                  className="mt-10 w-full py-5 bg-taupe text-ink text-[0.7rem] tracking-[0.5em] uppercase hover:bg-cream transition-colors"
                >
                  Book this service →
                </button>
              ) : (
                <p className="mt-10 text-cream/70 text-sm">Bookings paused for this service. <Link to="/contact" className="text-rose border-b border-rose/50">Contact us</Link>.</p>
              )}
            </div>
          </div>

          {service.long_description && (
            <div className="mt-20 max-w-3xl">
              <h2 className="text-h3 mb-6">About this service</h2>
              <p className="text-body-lg text-cream/75 whitespace-pre-line">{service.long_description}</p>
            </div>
          )}

          {service.cancellation_policy && (
            <div className="mt-16 max-w-3xl border-l-2 border-rose/60 pl-6">
              <p className="text-caption text-rose mb-2">Cancellation policy</p>
              <p className="text-body text-cream/75">{service.cancellation_policy}</p>
            </div>
          )}
        </section>
      </main>
      <SiteFooter />

      <BookingDrawer open={open} onClose={() => setOpen(false)} service={service} />
    </>
  );
}
