import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { getProducts, unwrap, type ProductCard } from "@/lib/storefront";
import { useCurrency } from "@/lib/useStore";
import {
  ProductCardLink,
  Section,
  LoadingGrid,
  EmptyState,
  ErrorState,
} from "@/components/parts";

export const Route = createFileRoute("/shop/$category")({
  component: CategoryPage,
});

function CategoryPage() {
  const { category } = Route.useParams();
  const [currency] = useCurrency();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["products", "category", category],
    queryFn: async () =>
      (unwrap(
        await getProducts(
          `?category=${encodeURIComponent(category)}&page=1&page_size=24`,
        ),
      ) as ProductCard[]) ?? [],
  });
  const products = data ?? [];
  const title = category.replace(/-/g, " ");

  return (
    <Section>
      <p className="text-caption">Shop</p>
      <h1 className="mt-2 text-h2 font-display capitalize">{title}</h1>
      <div className="mt-10">
        {isLoading ? (
          <LoadingGrid />
        ) : isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : products.length === 0 ? (
          <EmptyState title="Nothing in this category yet." />
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
