import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Price } from "@/components/site/Price";
import { ProductCard } from "@/components/shop/ProductCard";
import {
  getBundle, getBundleProducts, bundleCompareAtUsd,
  bundleCompareAtNgn, bundleSavingsUsd, bundleSavingsPct,
} from "@/lib/bundles";
import { useCart } from "@/lib/cart";
import { ogMeta, jsonLd, breadcrumbLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/bundles/$slug")({
  loader: ({ params }) => {
    const bundle = getBundle(params.slug);
    if (!bundle) throw notFound();
    return { bundle };
  },
  head: ({ params, loaderData }) => {
    const b = loaderData?.bundle;
    if (!b) return { meta: [{ title: "Bundle — Faitlyn Hair" }] };
    const url = `/bundles/${params.slug}`;
    const title = `${b.name} — Save ${bundleSavingsPct(b)}% | Faitlyn Hair`;
    const description = clamp(`${b.tagline} ${getBundleProducts(b).map((p) => p.name).join(", ")}. Save up to ${bundleSavingsPct(b)}% when bought together.`, 158);
    const image = b.image ?? getBundleProducts(b)[0]?.images[0];
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, image, type: "product" }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Bundles", url: "/bundles" },
          { name: b.name, url },
        ])),
        jsonLd({
          "@context": "https://schema.org",
          "@type": "Product",
          name: b.name,
          description: b.tagline,
          image: image ? [image] : [],
          sku: `bundle-${b.slug}`,
          brand: { "@type": "Brand", name: "Faitlyn Hair" },
          offers: {
            "@type": "Offer",
            url,
            priceCurrency: "USD",
            price: b.priceUsd.toFixed(2),
            availability: "https://schema.org/InStock",
          },
        }),
      ],
    };
  },
  errorComponent: () => <div className="p-20 text-center">Something went wrong.</div>,
  notFoundComponent: () => <div className="p-20 text-center">Bundle not found.</div>,
  component: BundlePage,
});

function BundlePage() {
  const { bundle } = Route.useLoaderData();
  const products = getBundleProducts(bundle);
  const { add } = useCart();

  const addBundle = () => {
    // Single line item priced at the bundle total — keeps the saving visible.
    add({
      slug: `bundle:${bundle.slug}`,
      name: bundle.name,
      image: bundle.image ?? products[0]?.images[0] ?? "",
      price: bundle.priceUsd,
      variant: `${products.length}-piece bundle`,
    });
  };

  return (
    <>
      <SiteHeader />
      <main className="pt-32 pb-24">
        <section className="mx-auto max-w-[1300px] px-6 lg:px-10">
          <Link to="/bundles" className="text-[0.65rem] tracking-[0.4em] uppercase text-taupe hover:text-cream">← All bundles</Link>
          <div className="grid md:grid-cols-[1fr_1fr] gap-12 mt-8 items-start">
            <div className="aspect-[4/5] bg-ink relative overflow-hidden">
              {(bundle.image ?? products[0]?.images[0]) && (
                <img
                  src={bundle.image ?? products[0]?.images[0]}
                  alt={bundle.name}
                  className="absolute inset-0 w-full h-full object-cover"
                />
              )}
              <span className="absolute top-5 left-5 bg-rose text-ink text-[0.65rem] tracking-[0.4em] uppercase px-3 py-1.5">
                Save {bundleSavingsPct(bundle)}%
              </span>
            </div>

            <div>
              <p className="text-[0.65rem] tracking-[0.5em] uppercase text-rose">Bundle</p>
              <h1 className="font-display text-5xl md:text-6xl mt-3">{bundle.name}</h1>
              <p className="text-cream/70 mt-4">{bundle.tagline}</p>

              <div className="mt-7 flex items-baseline gap-4">
                <Price usd={bundle.priceUsd} ngnOverride={bundle.priceNgn} className="text-3xl font-display text-taupe" />
                <Price usd={bundleCompareAtUsd(bundle)} ngnOverride={bundleCompareAtNgn(bundle)} className="text-base text-cream/40 line-through" />
              </div>
              <p className="text-[0.65rem] tracking-[0.4em] uppercase text-rose mt-2">
                You save <Price usd={bundleSavingsUsd(bundle)} forceUsd />
              </p>

              <h2 className="mt-10 text-[0.7rem] tracking-[0.4em] uppercase text-taupe">Includes</h2>
              <div className="mt-4 grid sm:grid-cols-2 gap-4">
                {products.map((p) => (
                  <Link key={p.slug} to="/product/$slug" params={{ slug: p.slug }} className="group flex gap-3 border border-taupe/15 p-3 hover:border-taupe/40 transition-colors">
                    <img src={p.images[0]} alt={p.name} className="w-16 h-20 object-cover" />
                    <div>
                      <p className="text-sm text-cream">{p.name}</p>
                      <p className="text-[0.65rem] tracking-[0.3em] uppercase text-taupe mt-1">View piece →</p>
                    </div>
                  </Link>
                ))}
              </div>

              <button
                onClick={addBundle}
                className="mt-10 w-full py-5 bg-taupe text-ink text-[0.7rem] tracking-[0.5em] uppercase hover:bg-cream transition-colors"
              >
                Add the bundle — <Price usd={bundle.priceUsd} ngnOverride={bundle.priceNgn} />
              </button>
            </div>
          </div>

          <section className="mt-24">
            <p className="text-caption text-rose mb-3">Each piece on its own</p>
            <h2 className="text-h3 mb-10">Pick up just one if you'd rather</h2>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-14">
              {products.map((p, i) => <ProductCard key={p.slug} product={p} index={i} />)}
            </div>
          </section>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
