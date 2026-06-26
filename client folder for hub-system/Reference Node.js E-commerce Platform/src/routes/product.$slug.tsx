import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { getProduct, getRelated, type Product, type HeadSize } from "@/lib/products";
import { getBundlesIncluding, bundleSavingsUsd, bundleSavingsPct } from "@/lib/bundles";
import { useCart } from "@/lib/cart";
import { ProductCard } from "@/components/shop/ProductCard";
import { BundleCard } from "@/components/shop/BundleCard";
import { LuxuryGallery } from "@/components/shop/LuxuryGallery";
import { ProductArtistry } from "@/components/shop/ProductArtistry";
import { ProductFAQ } from "@/components/shop/ProductFAQ";
import { CustomerReviews } from "@/components/shop/CustomerReviews";
import { SizeGuideModal } from "@/components/site/SizeGuideModal";
import { Price } from "@/components/site/Price";
import { ogMeta, jsonLd, productLd, breadcrumbLd, faqLd, clamp } from "@/lib/seo";
import { DEFAULT_FAQ } from "@/lib/site-content";

export const Route = createFileRoute("/product/$slug")({
  loader: ({ params }) => {
    const product = getProduct(params.slug);
    if (!product) throw notFound();
    return { product };
  },
  head: ({ params, loaderData }) => {
    const p = loaderData?.product;
    if (!p) return { meta: [{ title: "Product — Faitlyn Hair" }] };
    const url = `/product/${params.slug}`;
    const title = `${p.name} — ${p.tagline} | Faitlyn Hair`;
    const description = clamp(p.description, 158);
    const faq = p.faq ?? DEFAULT_FAQ;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, image: p.images[0], type: "product" }),
        { property: "product:price:amount", content: String(p.price) },
        { property: "product:price:currency", content: "USD" },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(productLd({
          name: p.name,
          description: p.description,
          image: p.images,
          sku: p.slug,
          url,
          priceUsd: p.price,
        })),
        jsonLd(breadcrumbLd([
          { name: "Home", url: "/" },
          { name: "Shop", url: "/shop" },
          { name: p.category[0].toUpperCase() + p.category.slice(1), url: `/shop/${p.category}` },
          { name: p.name, url },
        ])),
        jsonLd(faqLd(faq.items)),
      ],
    };
  },
  errorComponent: () => <div className="p-20 text-center">Something went wrong.</div>,
  notFoundComponent: () => <div className="p-20 text-center">Piece not found.</div>,
  component: ProductPage,
});

function ProductPage() {
  const { product } = Route.useLoaderData() as { product: Product };
  const { add } = useCart();
  const [length, setLength] = useState(product.lengths[0]);
  const [lace, setLace] = useState(product.lace[0]);
  const [headSize, setHeadSize] = useState<HeadSize>(product.headSizes[0]);
  const [guideOpen, setGuideOpen] = useState(false);

  const includingBundles = getBundlesIncluding(product.slug);
  const featuredBundle = includingBundles[0];
  // Same-collection products first, then category — bundle is shown above the grid.
  const related = getRelated(product, 3);

  return (
    <>
      <SiteHeader />
      <main className="pt-28">
        <div className="mx-auto max-w-[1400px] px-6 lg:px-10 grid lg:grid-cols-[1.2fr_1fr] gap-12 lg:gap-20">
          <LuxuryGallery images={product.images} alt={product.name} />

          {/* Detail */}
          <div className="lg:sticky lg:top-32 self-start py-4">
            <p className="text-[0.65rem] tracking-[0.5em] uppercase text-taupe">{product.category}</p>
            <h1 className="font-display text-5xl md:text-6xl leading-[1.05] mt-3">{product.name}</h1>
            <p className="text-cream/70 mt-3">{product.tagline}</p>
            <Price usd={product.price} slug={product.slug} className="mt-6 block text-2xl font-display text-taupe" />

            {featuredBundle && (
              <Link
                to="/bundles/$slug"
                params={{ slug: featuredBundle.slug }}
                className="mt-4 inline-flex items-center gap-3 border border-rose/40 bg-rose/5 px-4 py-2.5 text-[0.65rem] tracking-[0.32em] uppercase text-cream hover:bg-rose/10 transition-colors"
              >
                <span className="text-rose">●</span>
                Part of the <span className="text-taupe">{featuredBundle.name}</span>
                <span className="text-rose">· save <Price usd={bundleSavingsUsd(featuredBundle)} forceUsd /> ({bundleSavingsPct(featuredBundle)}%)</span>
              </Link>
            )}

            <p className="mt-8 text-sm leading-relaxed text-cream/75">{product.description}</p>

            <Selector label="Length" value={length} options={product.lengths} onChange={setLength} />
            <Selector label="Lace" value={lace} options={product.lace} onChange={setLace} />

            <div className="mt-6">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe">
                  Head size · <span className="text-cream/80">{headSize}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setGuideOpen(true)}
                  className="text-[0.6rem] tracking-[0.3em] uppercase text-rose border-b border-rose/50 pb-0.5 hover:text-cream hover:border-cream/60 transition-colors"
                >
                  How to know your size →
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {product.headSizes.map((o) => (
                  <button
                    key={o}
                    onClick={() => setHeadSize(o)}
                    className={`px-4 py-2 text-xs tracking-widest border transition-colors ${
                      o === headSize ? "border-taupe bg-taupe/10 text-cream" : "border-taupe/30 text-cream/70 hover:border-taupe"
                    }`}
                  >
                    {o}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => add({
                slug: product.slug,
                name: product.name,
                image: product.images[0],
                price: product.price,
                variant: `${length} · ${lace} · Size ${headSize}`,
              })}
              className="mt-10 w-full py-5 bg-taupe text-ink text-[0.7rem] tracking-[0.5em] uppercase hover:bg-cream transition-colors"
            >
              Add to bag — <Price usd={product.price} slug={product.slug} />
            </button>

            <div className="mt-10 border-t border-taupe/15 pt-6 space-y-3">
              {product.details.map((d) => (
                <div key={d} className="flex gap-3 text-sm text-cream/70">
                  <span className="text-taupe">—</span>{d}
                </div>
              ))}
            </div>

            <p className="mt-8 text-[0.65rem] tracking-[0.4em] uppercase text-muted-foreground">
              Complimentary worldwide shipping over $2000 · $1000 within Nigeria
            </p>
          </div>
        </div>

        <ProductArtistry productName={product.name} productSlug={product.slug} content={product.artistry} />

        {/* You may also love — bundles first when applicable, then related products */}
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10 mt-24 mb-20">
          <div className="flex items-end justify-between flex-wrap gap-4 mb-10">
            <div>
              <p className="text-caption text-rose mb-2">From the same collection · vous aimerez aussi</p>
              <h2 className="text-h2">You may also <em className="font-couture text-taupe">love</em></h2>
            </div>
            <Link to="/shop" className="text-caption text-taupe border-b border-taupe/40 pb-1 hover:text-cream">Back to shop →</Link>
          </div>

          {featuredBundle && (
            <div className="mb-12">
              <BundleCard bundle={featuredBundle} highlighted />
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-14">
            {related.map((p, i) => <ProductCard key={p.slug} product={p} index={i} />)}
          </div>
        </section>

        <ProductFAQ content={product.faq} productSlug={product.slug} />
        <CustomerReviews productSlug={product.slug} />
      </main>
      <SiteFooter />

      <SizeGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}

function Selector({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div className="mt-6">
      <p className="text-[0.6rem] tracking-[0.4em] uppercase text-taupe mb-3">{label} · <span className="text-cream/80">{value}</span></p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`px-4 py-2 text-xs tracking-widest border transition-colors ${o === value ? "border-taupe bg-taupe/10 text-cream" : "border-taupe/30 text-cream/70 hover:border-taupe"}`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
