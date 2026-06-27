import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { EditorialSplit } from "@/components/site/EditorialSplit";
import { FounderNote } from "@/components/site/FounderNote";
import { PressStrip } from "@/components/site/PressStrip";
import models from "@/assets/faitlyn-models.jpg.asset.json";
import { ogMeta, jsonLd, breadcrumbLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/about")({
  head: () => {
    const title = "The Maison — Our Story | Faitlyn Hair";
    const description = clamp("Inside Faitlyn: the Lagos atelier crafting hand-finished pixies, bobs and curls for women of colour worldwide.", 158);
    const url = "/about";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, image: models.url, type: "article" }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [jsonLd(breadcrumbLd([{ name: "Home", url: "/" }, { name: "About", url }]))],
    };
  },
  component: AboutPage,
});

function AboutPage() {
  return (
    <>
      <SiteHeader />
      <main className="pt-28">
        <section className="relative h-[80vh] overflow-hidden">
          <img src={models.url} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/30 to-ink" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
            <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-6">Est. Lagos · 2021</p>
            <h1 className="font-display text-5xl md:text-8xl leading-[0.95] tracking-tight max-w-4xl text-balance">
              The hair we always wished we could buy.
            </h1>
          </div>
        </section>
        <EditorialSplit />
        <PressStrip />
        <FounderNote />
      </main>
      <SiteFooter />
    </>
  );
}
