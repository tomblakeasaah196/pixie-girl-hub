import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getServices, fmt } from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import { Section, LoadingGrid, EmptyState, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/services")({
  component: ServicesIndex,
});

function ServicesIndex() {
  const [currency] = useCurrency();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["services"],
    queryFn: () => getServices(),
  });
  const services = data ?? [];

  return (
    <Section>
      <h1 className="text-h2 font-display">Services</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Book a stylist for installs, styling and care.
      </p>
      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : services.length === 0 ? (
          <EmptyState title="No services available yet." />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {services.map((s) => (
              <Link
                key={s.service_id}
                to="/services/$slug"
                params={{ slug: s.slug }}
                className="group block overflow-hidden rounded-lg border border-border"
              >
                <div className="aspect-video overflow-hidden bg-secondary">
                  {s.cover_image_url ? (
                    <img
                      src={s.cover_image_url}
                      alt={s.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="p-4">
                  <h3 className="text-h6 font-display">{s.name}</h3>
                  {s.short_description ? (
                    <p className="mt-1 text-body-sm text-muted-foreground line-clamp-2">
                      {s.short_description}
                    </p>
                  ) : null}
                  <p className="mt-2 text-body-sm font-mono">
                    {s.price_is_from ? "From " : ""}
                    {fmt(
                      currency === "USD" ? s.base_price_usd : s.base_price_ngn,
                      currency,
                    )}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
