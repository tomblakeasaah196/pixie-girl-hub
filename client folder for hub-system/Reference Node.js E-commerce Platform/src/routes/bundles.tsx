import { createFileRoute, Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { BundleCard } from "@/components/shop/BundleCard";
import { BUNDLES } from "@/lib/bundles";
import { ogMeta, jsonLd, breadcrumbLd, itemListLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/bundles")({
  head: () => {
    const title = "Bundles — Better Together | Faitlyn Hair";
    const description = clamp("Curated wig sets from Faitlyn. Save up to 15% when you buy our signature trios and essential duos together.", 158);
    const url = "/bundles";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        jsonLd(breadcrumbLd([{ name: "Home", url: "/" }, { name: "Bundles", url }])),
        jsonLd(itemListLd(BUNDLES.map((b) => ({ name: b.name, url: `/bundles/${b.slug}` })))),
      ],
    };
  },
  component: BundlesPage,
});

function BundlesPage() {
  return (
    <>
      <SiteHeader />
      <main className="pt-32 pb-24">
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10">
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Bundles · ensembles</p>
          <h1 className="font-display text-5xl md:text-7xl tracking-tight mb-3">Better together.</h1>
          <p className="text-cream/70 max-w-2xl mb-16">
            Curated sets at a couture discount. Three pieces. Two pieces. One opportunity to save.
          </p>
          <div className="space-y-12">
            {BUNDLES.map((b) => <BundleCard key={b.slug} bundle={b} />)}
          </div>
          <div className="mt-20">
            <Link to="/shop" className="text-[0.7rem] tracking-[0.4em] uppercase text-taupe border-b border-taupe/40 pb-1 hover:text-cream">← Back to the catalogue</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
