import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getProducts, unwrap, type ProductCard } from "@/lib/storefront";
import { ssrProducts } from "@/lib/server";
import { useCurrency } from "@/lib/useStore";
import {
  ProductCardLink,
  Section,
  LoadingGrid,
  EmptyState,
  ErrorState,
} from "@/components/parts";

export const Route = createFileRoute("/shop")({
  loader: async () => ssrProducts({ data: { pageSize: 24 } }),
  component: Shop,
});

function Shop() {
  const initial = Route.useLoaderData();
  const [currency] = useCurrency();
  const { data, isError, isLoading, refetch } = useQuery({
    queryKey: ["products", initial.brand],
    queryFn: async () =>
      (unwrap(await getProducts("?page=1&page_size=24")) as ProductCard[]) ?? [],
    initialData: initial.products,
  });
  const products = data ?? [];

  return (
    <Section>
      <h1 className="text-h2 font-display">Shop</h1>
      <p className="mt-2 text-body text-muted-foreground">
        Every style, live from the atelier.
      </p>
      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : products.length === 0 ? (
          <EmptyState title="No products are available right now." />
        ) : (
          <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
            {products.map((p) => (
              <ProductCardLink key={p.styled_id} p={p} currency={currency} />
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}
