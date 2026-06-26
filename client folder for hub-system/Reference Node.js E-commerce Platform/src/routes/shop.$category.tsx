import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ProductCard } from "@/components/shop/ProductCard";
import { CATEGORIES, getByCategory } from "@/lib/products";
import { ogMeta, jsonLd, collectionPageLd, itemListLd, breadcrumbLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/shop/$category")({
  loader: ({ params }) => {
    const cat = CATEGORIES.find((c) => c.slug === params.category);
    if (!cat) throw notFound();
    return { cat };
  },
  head: ({ params, loaderData }) => {
    const label = loaderData?.cat.label ?? "Shop";
    const title = `${label} Wigs — Hand-Finished in Lagos | Faitlyn Hair`;
    const description = clamp(`Shop ${label.toLowerCase()} from Faitlyn — cuticle-aligned virgin hair, HD lace, hand-finished couture pieces. Free express worldwide shipping over $2000.`, 158);
    const url = `/shop/${params.category}`;
    const items = getByCategory(params.category).map((p) => ({ name: p.name, url: `/product/${p.slug}` }));
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, type: "website" }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Shop", url: "/shop" },
          { name: label, url },
        ])),
        jsonLd(collectionPageLd({ name: title, description, url, items })),
        jsonLd(itemListLd(items)),
      ],
    };
  },
  errorComponent: () => <div className="p-20 text-center">Something went wrong.</div>,
  notFoundComponent: () => <div className="p-20 text-center">Category not found.</div>,
  component: CategoryPage,
});

function CategoryPage() {
  const { category } = Route.useParams();
  const { cat } = Route.useLoaderData();
  const products = getByCategory(category);
  return (
    <>
      <SiteHeader />
      <main className="pt-32">
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10">
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Collection</p>
          <h1 className="font-display text-5xl md:text-7xl tracking-tight mb-10">{cat.label}</h1>
          <nav className="flex flex-wrap gap-x-8 gap-y-3 border-b border-taupe/15 pb-6 mb-12 text-[0.7rem] tracking-[0.35em] uppercase">
            <Link to="/shop" className="text-taupe/70 hover:text-cream transition-colors">All</Link>
            {CATEGORIES.map((c) => (
              <Link key={c.slug} to="/shop/$category" params={{ category: c.slug }} className={c.slug === category ? "text-cream border-b border-taupe pb-1" : "text-taupe/70 hover:text-cream transition-colors"}>{c.label}</Link>
            ))}
          </nav>
          {products.length === 0 ? (
            <p className="text-muted-foreground py-20 text-center">More pieces dropping soon.</p>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-14">
              {products.map((p, i) => <ProductCard key={p.slug} product={p} index={i} />)}
            </div>
          )}
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
