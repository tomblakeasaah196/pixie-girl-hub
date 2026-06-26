import { createFileRoute, Link } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { ProductCard } from "@/components/shop/ProductCard";
import { PRODUCTS, CATEGORIES } from "@/lib/products";
import { SHADES } from "@/lib/site-content";
import { ogMeta, jsonLd, collectionPageLd, itemListLd, breadcrumbLd, clamp } from "@/lib/seo";

const shopSearchSchema = z.object({
  shade: fallback(z.string().optional(), undefined),
});

/** Build the canonical/og description for a shade-filter URL. */
function shadeMeta(shadeSlug?: string) {
  if (!shadeSlug) {
    return {
      title: "Shop the Catalogue — Pixies, Bobs, Curls | Faitlyn Hair",
      description: "Explore every Faitlyn silhouette — hand-finished pixies, bobs, curls and bone-straight. Free express worldwide shipping over $2000.",
      url: "/shop",
    };
  }
  const shade = SHADES.find((s) => s.slug === shadeSlug);
  if (!shade) {
    return {
      title: "Shop — Faitlyn Hair",
      description: "Explore the Faitlyn catalogue.",
      url: "/shop",
    };
  }
  return {
    title: `${shade.name} Wigs — Pixies, Bobs & Curls in ${shade.name} | Faitlyn`,
    description: clamp(
      `Shop ${shade.name} luxury wigs from Faitlyn — hand-finished pixies, bobs, curls and bone-straight in the ${shade.name} shade. Cuticle-aligned virgin hair, HD lace, ready to wear.`,
      158,
    ),
    url: `/shop?shade=${shade.slug}`,
  };
}

export const Route = createFileRoute("/shop")({
  validateSearch: zodValidator(shopSearchSchema),
  loaderDeps: ({ search }) => ({ shade: search.shade }),
  loader: ({ deps }) => ({ shade: deps.shade }),
  head: ({ loaderData }) => {
    const shade = loaderData?.shade;
    const m = shadeMeta(shade);
    const products = shade ? PRODUCTS.filter((p) => p.shade === shade) : PRODUCTS;
    const items = products.map((p) => ({ name: p.name, url: `/product/${p.slug}` }));
    return {
      meta: [
        { title: m.title },
        { name: "description", content: m.description },
        ...ogMeta({ title: m.title, description: m.description, url: m.url, type: "website" }),
      ],
      links: [{ rel: "canonical", href: m.url }],
      scripts: [
        jsonLd(breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Shop", url: "/shop" },
          ...(shade ? [{ name: SHADES.find((s) => s.slug === shade)?.name ?? shade, url: m.url }] : []),
        ])),
        jsonLd(collectionPageLd({ name: m.title, description: m.description, url: m.url, items })),
        jsonLd(itemListLd(items)),
      ],
    };
  },
  component: ShopPage,
});

function ShopPage() {
  const { shade } = Route.useSearch();
  const activeShade = shade ? SHADES.find((s) => s.slug === shade) : undefined;
  const products = activeShade
    ? PRODUCTS.filter((p) => p.shade === activeShade.slug)
    : PRODUCTS;

  return (
    <>
      <SiteHeader />
      <main className="pt-32">
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10">
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">The Catalogue</p>
          <h1 className="font-display text-5xl md:text-7xl tracking-tight mb-10">
            {activeShade ? `${activeShade.name} wigs` : "Every silhouette, in one place."}
          </h1>
          <nav className="flex flex-wrap gap-x-8 gap-y-3 border-b border-taupe/15 pb-6 mb-8 text-[0.7rem] tracking-[0.35em] uppercase">
            <Link to="/shop" className={!activeShade ? "text-cream border-b border-taupe pb-1" : "text-taupe/70 hover:text-cream transition-colors"}>All</Link>
            {CATEGORIES.map((c) => (
              <Link key={c.slug} to="/shop/$category" params={{ category: c.slug }} className="text-taupe/70 hover:text-cream transition-colors">{c.label}</Link>
            ))}
            <Link to="/bundles" className="text-taupe/70 hover:text-cream transition-colors">Bundles</Link>
          </nav>

          {activeShade && (
            <div className="flex items-center gap-4 mb-10">
              <span
                className="w-9 h-9 rounded-full border border-taupe/30"
                style={{ background: activeShade.swatch }}
                aria-hidden
              />
              <p className="text-caption text-cream/80">
                Filtered by shade · <span className="text-cream">{activeShade.name}</span>
              </p>
              <Link
                to="/shop"
                className="text-caption text-rose border-b border-rose/50 pb-0.5 hover:text-cream hover:border-cream/60 transition-colors"
              >
                Clear ×
              </Link>
            </div>
          )}

          {products.length === 0 ? (
            <p className="text-cream/70 py-20 text-center">
              No pieces in this shade yet. <Link to="/shop" className="text-rose border-b border-rose/50 hover:text-cream">Browse the full catalogue →</Link>
            </p>
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
