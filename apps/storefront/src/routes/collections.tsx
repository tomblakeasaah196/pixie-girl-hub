import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getCollections } from "@/lib/storefront";
import { Section, LoadingGrid, EmptyState, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/collections")({
  component: CollectionsIndex,
});

function CollectionsIndex() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: () => getCollections(),
  });
  const collections = data ?? [];

  if (pathname !== "/collections" && pathname !== "/collections/") return <Outlet />;

  return (
    <Section>
      <h1 className="text-h2 font-display">Collections</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Edits and stories, grouped.
      </p>
      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : collections.length === 0 ? (
          <EmptyState title="No collections yet." />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {collections.map((c) => (
              <Link
                key={c.collection_id}
                to="/collections/$slug"
                params={{ slug: c.slug }}
                className="group block overflow-hidden rounded-lg border border-border"
              >
                <div className="aspect-video overflow-hidden bg-secondary">
                  {c.display_image_url ? (
                    <img
                      src={c.display_image_url}
                      alt={c.name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : null}
                </div>
                <div className="p-4">
                  <h3 className="text-h6 font-display">{c.name}</h3>
                  {c.description ? (
                    <p className="mt-1 text-body-sm text-muted-foreground line-clamp-2">
                      {c.description}
                    </p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
