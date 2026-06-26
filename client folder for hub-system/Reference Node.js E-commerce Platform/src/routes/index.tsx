import { createFileRoute } from "@tanstack/react-router";
import { CinematicPreloader } from "@/components/preloader/CinematicPreloader";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { Hero } from "@/components/site/Hero";
import { Marquee } from "@/components/site/Marquee";
import { BentoGrid } from "@/components/site/BentoGrid";
import { ShopByShade } from "@/components/site/ShopByShade";
import { WhyChooseFaitlyn } from "@/components/site/WhyChooseFaitlyn";
import { SignatureCarousel } from "@/components/site/SignatureCarousel";
import { EditorialSplit } from "@/components/site/EditorialSplit";
import { PressStrip } from "@/components/site/PressStrip";
import { Testimonials } from "@/components/site/Testimonials";
import { Gallery } from "@/components/site/Gallery";
import { FounderNote } from "@/components/site/FounderNote";

import heroModel from "@/assets/hero-model.webp.asset.json";
import { ogMeta, jsonLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/")({
  head: () => {
    const title = "Faitlyn Hair — Luxury Natural Hair, Crafted in Lagos";
    const description = clamp("Faitlyn Hair: a Lagos maison crafting the world's most coveted pixies, bobs and curls. Hand-finished, lace-perfect luxury — shipped worldwide.", 158);
    const url = "/";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, image: heroModel.url, type: "website" }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [jsonLd({
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: "Faitlyn Hair",
        url: "/",
        potentialAction: {
          "@type": "SearchAction",
          target: "/shop?shade={search_term_string}",
          "query-input": "required name=search_term_string",
        },
      })],
    };
  },
  component: Index,
});

function Index() {
  return (
    <>
      <CinematicPreloader />
      <SiteHeader />
      <main>
        <Hero />
        <Marquee />
        <BentoGrid />
        <ShopByShade />
        <SignatureCarousel />
        <WhyChooseFaitlyn />
        <EditorialSplit />
        <PressStrip />
        <Testimonials />
        <Gallery />
        <FounderNote />
      </main>
      <SiteFooter />
    </>
  );
}
