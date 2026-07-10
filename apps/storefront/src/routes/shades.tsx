import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { getShades } from "@/lib/storefront";
import { Section, LoadingGrid, EmptyState, ErrorState } from "@/components/parts";
import { usePageSlots, withSlots } from "@/lib/site-config";

export const Route = createFileRoute("/shades")({ component: ShadesPage });

function ShadesPage() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["shades"],
    queryFn: () => getShades(),
  });
  const shades = data ?? [];
  const s = withSlots(
    {
      heading: "Shop by shade",
      body: "Find your match, then make it yours.",
      finderTitle: "Not sure which shade is yours?",
      finderBody:
        "Share one photo and Praxis, our AI stylist, will read your undertone and pick it — free, private, nothing saved.",
      finderCta: "Find my shade",
      emptyTitle: "No shades published yet.",
    },
    usePageSlots("shades"),
  );

  if (pathname !== "/shades" && pathname !== "/shades/") return <Outlet />;

  return (
    <Section>
      <h1 className="text-h2 font-display">{s.heading}</h1>
      <p className="mt-2 text-body text-muted-foreground">{s.body}</p>

      {/* Praxis Shade Finder invitation */}
      <Link
        to="/shade-finder"
        className="group mt-8 flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:bg-secondary md:p-6"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-champagne to-burgundy text-primary-foreground">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <p className="text-body font-couture">{s.finderTitle}</p>
            <p className="mt-0.5 text-body-sm text-muted-foreground">{s.finderBody}</p>
          </div>
        </div>
        <span className="hidden shrink-0 rounded-full border border-border px-4 py-2 text-body-sm transition-colors group-hover:border-foreground md:block">
          {s.finderCta}
        </span>
      </Link>

      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : shades.length === 0 ? (
          <EmptyState title={s.emptyTitle} />
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
