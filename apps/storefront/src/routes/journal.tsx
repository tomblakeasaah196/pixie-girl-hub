import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getContentList } from "@/lib/storefront";
import { Section, EmptyState, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/journal")({ component: Journal });

function Journal() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["journal"],
    queryFn: () => getContentList("journal"),
  });
  const posts = data ?? [];

  return (
    <Section>
      <h1 className="text-h2 font-display">Journal</h1>
      <p className="mt-2 text-body text-muted-foreground">Notes, edits and how-tos.</p>
      <div className="mt-10">
        {isLoading ? (
          <p className="text-body text-muted-foreground">Loading...</p>
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : posts.length === 0 ? (
          <EmptyState title="No journal entries yet." />
        ) : (
          <div className="grid gap-8 md:grid-cols-2">
            {posts.map((p) => (
              <Link key={p.slug} to="/journal/$slug" params={{ slug: p.slug }} className="group block">
                {p.cover_image_url ? (
                  <div className="aspect-video overflow-hidden rounded-md bg-secondary">
                    <img src={p.cover_image_url} alt={p.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                  </div>
                ) : null}
                <h3 className="mt-3 text-h5 font-display">{p.title}</h3>
                {p.excerpt ? (
                  <p className="mt-1 text-body-sm text-muted-foreground line-clamp-2">{p.excerpt}</p>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
