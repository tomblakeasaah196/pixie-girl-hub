import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getShades } from "@/lib/storefront";
import { Section, LoadingGrid, EmptyState, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/shades")({ component: ShadesPage });

function ShadesPage() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["shades"],
    queryFn: () => getShades(),
  });
  const shades = data ?? [];

  if (pathname !== "/shades" && pathname !== "/shades/") return <Outlet />;

  return (
    <Section>
      <h1 className="text-h2 font-display">Shop by shade</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Find your match, then make it yours.
      </p>
      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : shades.length === 0 ? (
          <EmptyState title="No shades published yet." />
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {shades.map((s) => (
              <Link key={s.shade_id} to="/shades/$slug" params={{ slug: s.slug }} className="group block">
                <div className="aspect-[3/4] overflow-hidden rounded-md bg-secondary">
                  {s.cover_image_url ? (
                    <img src={s.cover_image_url} alt={s.name} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : null}
                </div>
                <h3 className="mt-3 text-body font-display">{s.name}</h3>
                {s.product_count != null ? (
                  <p className="text-body-sm text-muted-foreground">{s.product_count} styles</p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
