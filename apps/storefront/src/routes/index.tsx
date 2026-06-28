import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { clientBrand } from "@/lib/brand";
import { getProducts, unwrap, type ProductCard } from "@/lib/storefront";
import { ssrHome } from "@/lib/server";
import { useCurrency } from "@/lib/useStore";
import { ProductCardLink, Section } from "@/components/parts";
import { PageTemplate, hasSections, type StudioPage } from "@/components/templates";

/**
 * Home. Renders the published Studio 'home' page (template_key + slots) when one
 * exists; otherwise falls back to the built-in hero + new-in grid. Brand + prices
 * from the Hub.
 */
export const Route = createFileRoute("/")({
  loader: async () => ssrHome(),
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  const [currency] = useCurrency();
  const { data } = useQuery({
    queryKey: ["home-products", initial.brand],
    queryFn: async () =>
      (unwrap(await getProducts("?page=1&page_size=8")) as ProductCard[]) ?? [],
    initialData: initial.products,
  });
  const products = data ?? [];
  const page = initial.page as StudioPage | null;

  // Studio-published home → render from its template/sections.
  if (hasSections(page)) {
    return <PageTemplate page={page!} products={products} currency={currency} />;
  }

  // Default built-in home.
  const brandName =
    clientBrand() === "faitlynhair" ? "Faitlyn Hair" : "Pixie Girl";
  return (
    <main>
      <section className="mx-auto max-w-6xl px-4 py-20 md:px-6 md:py-28">
        <p className="text-caption">{brandName}</p>
        <h1 className="mt-4 text-h1 font-display">
          Luxury wigs, <span className="font-couture">deliberately</span> yours.
        </h1>
        <p className="mt-6 max-w-xl text-body-lg text-muted-foreground">
          Hand-finished styles, shade-matched and shipped worldwide. Browse the
          atelier and make it yours.
        </p>
        <div className="mt-8 flex gap-3">
          <Link to="/shop" className="rounded-full bg-primary px-7 py-3 text-body text-primary-foreground">
            Shop all
          </Link>
          <Link to="/shades" className="rounded-full border border-border px-7 py-3 text-body hover:bg-secondary">
            Shop by shade
          </Link>
        </div>
      </section>

      {products.length > 0 ? (
        <Section>
          <div className="flex items-end justify-between">
            <h2 className="text-h3 font-display">New in</h2>
            <Link to="/shop" className="text-body-sm text-muted-foreground hover:text-foreground">
              View all
            </Link>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-6 md:grid-cols-4">
            {products.map((p) => (
              <ProductCardLink key={p.styled_id} p={p} currency={currency} />
            ))}
          </div>
        </Section>
      ) : null}
    </main>
  );
}
