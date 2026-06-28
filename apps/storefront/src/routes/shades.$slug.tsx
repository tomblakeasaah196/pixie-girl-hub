import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getShade } from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import {
  ProductCardLink,
  Section,
  LoadingGrid,
  EmptyState,
  ErrorState,
} from "@/components/parts";

export const Route = createFileRoute("/shades/$slug")({ component: ShadePage });

function ShadePage() {
  const { slug } = Route.useParams();
  const [currency] = useCurrency();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["shade", slug],
    queryFn: () => getShade(slug),
  });

  return (
    <Section>
      {isLoading ? (
        <LoadingGrid />
      ) : isError || !data ? (
        <ErrorState onRetry={() => refetch()} />
      ) : (
        <>
          <h1 className="text-h2 font-display">{data.name}</h1>
          {data.long_description ? (
            <p className="mt-3 max-w-2xl text-body text-muted-foreground">
              {data.long_description}
            </p>
          ) : null}
          <div className="mt-10">
            {(data.products ?? []).length === 0 ? (
              <EmptyState title="No styles in this shade yet." />
            ) : (
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                {data.products.map((p) => (
                  <ProductCardLink key={p.styled_id} p={p} currency={currency} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </Section>
  );
}
