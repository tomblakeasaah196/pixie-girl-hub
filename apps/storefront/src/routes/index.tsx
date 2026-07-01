import { createFileRoute } from "@tanstack/react-router";
import { CinematicPreloader } from "@/components/preloader/CinematicPreloader";
import { Hero } from "@/components/site/Hero";
import { Marquee } from "@/components/site/Marquee";
import { BentoGrid } from "@/components/site/BentoGrid";
import { ShopByShade } from "@/components/site/ShopByShade";
import { SignatureCarousel } from "@/components/site/SignatureCarousel";
import { WhyChooseFaitlyn } from "@/components/site/WhyChooseFaitlyn";
import { EditorialSplit } from "@/components/site/EditorialSplit";
import { PressStrip } from "@/components/site/PressStrip";
import { Testimonials } from "@/components/site/Testimonials";
import { Gallery } from "@/components/site/Gallery";
import { FounderNote } from "@/components/site/FounderNote";
import { ssrHome } from "@/lib/server";
import type { ProductCard } from "@/lib/storefront";
import {
  resolveHomeContent,
  mapProducts,
  mapShades,
  mapBundles,
} from "@/lib/home-content";

/**
 * Home — the Faitlyn maison template.
 * Marketing copy/images resolve from the Studio 'home' page slots (/site);
 * catalogue sections (products/bundles/shades + images) resolve from the Hub.
 * Both fall back to the ported defaults so the page is identical before Studio
 * or the catalogue is populated. Header/footer are global chrome in __root.tsx.
 */
export const Route = createFileRoute("/")({
  loader: async () => ssrHome(),
  head: () => ({
    meta: [
      { title: "Faitlyn Hair — Luxury Natural Hair, Crafted in Lagos" },
      {
        name: "description",
        content:
          "Faitlyn Hair: a Lagos maison crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury — shipped worldwide.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const { homeSlots, products, shades, bundles } = Route.useLoaderData();
  const c = resolveHomeContent(homeSlots);

  const signatureItems = products.length
    ? mapProducts(products as ProductCard[])
    : undefined;
  const shadeItems = shades.length
    ? mapShades(shades as Parameters<typeof mapShades>[0])
    : undefined;
  const bundleItems = bundles.length
    ? mapBundles(bundles as Parameters<typeof mapBundles>[0])
    : undefined;

  return (
    <>
      <CinematicPreloader />
      <main>
        <Hero content={c.hero} />
        <Marquee items={c.marquee} />
        <BentoGrid head={c.bundlesHead} items={bundleItems} />
        <ShopByShade head={c.shadesHead} items={shadeItems} />
        <SignatureCarousel head={c.signatureHead} items={signatureItems} />
        <WhyChooseFaitlyn content={c.whyChoose} />
        <EditorialSplit content={c.editorial} />
        <PressStrip eyebrow={c.press.eyebrow} items={c.press.items} />
        <Testimonials eyebrow={c.testimonials.eyebrow} items={c.testimonials.items} />
        <Gallery eyebrow={c.gallery.eyebrow} heading={c.gallery.heading} images={c.gallery.images} />
        <FounderNote content={c.founder} />
      </main>
    </>
  );
}
