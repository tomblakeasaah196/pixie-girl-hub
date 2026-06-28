import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getContentPost } from "@/lib/storefront";
import { Section, ErrorState } from "@/components/parts";

export const Route = createFileRoute("/journal/$slug")({
  component: JournalPost,
});

function JournalPost() {
  const { slug } = Route.useParams();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["journal", slug],
    queryFn: () => getContentPost("journal", slug),
  });

  if (isLoading)
    return (
      <Section>
        <p className="text-body text-muted-foreground">Loading…</p>
      </Section>
    );
  if (isError || !data)
    return (
      <Section>
        <ErrorState onRetry={() => refetch()} />
      </Section>
    );

  return (
    <Section className="max-w-2xl">
      <h1 className="text-h2 font-display">{data.title}</h1>
      {data.cover_image_url ? (
        <div className="mt-6 aspect-video overflow-hidden rounded-md bg-secondary">
          <img src={data.cover_image_url} alt={data.title} className="h-full w-full object-cover" />
        </div>
      ) : null}
      {data.body_html ? (
        <div
          className="prose mt-8 max-w-none text-body text-foreground"
          dangerouslySetInnerHTML={{ __html: data.body_html }}
        />
      ) : data.body_md ? (
        <p className="mt-8 whitespace-pre-wrap text-body text-foreground">{data.body_md}</p>
      ) : null}
    </Section>
  );
}
