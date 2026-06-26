import { createFileRoute } from "@tanstack/react-router";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { RevealGroup, RevealItem } from "@/components/site/Reveal";
import atelier from "@/assets/editorial-atelier.jpg";
import curls from "@/assets/product-curls.jpg";
import bob from "@/assets/product-bob.jpg";

const POSTS = [
  { img: atelier, cat: "Atelier", title: "Eleven hands, one wig: inside our Lagos workroom", excerpt: "A day with the women who hand-tie every Faitlyn piece." },
  { img: curls, cat: "Care", title: "How to wash a raw curl without losing the pattern", excerpt: "Our master stylist's exact wash-day ritual." },
  { img: bob, cat: "Edit", title: "The case for the blunt bob, in 2026", excerpt: "Why the sharpest cut in the room never goes out of season." },
];

import { ogMeta, jsonLd, breadcrumbLd, clamp } from "@/lib/seo";

export const Route = createFileRoute("/journal")({
  head: () => {
    const title = "Journal — Notes from the Faitlyn Maison";
    const description = clamp("Craft, care and the women we dress — notes from inside the Faitlyn Lagos atelier.", 158);
    const url = "/journal";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        ...ogMeta({ title, description, url, image: atelier, type: "article" }),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [jsonLd(breadcrumbLd([{ name: "Home", url: "/" }, { name: "Journal", url }]))],
    };
  },
  component: JournalPage,
});

function JournalPage() {
  return (
    <>
      <SiteHeader />
      <main className="pt-32 pb-20">
        <section className="mx-auto max-w-[1400px] px-6 lg:px-10">
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-4">Journal</p>
          <h1 className="font-display text-5xl md:text-7xl tracking-tight mb-16 max-w-3xl">Notes from the atelier.</h1>
          <RevealGroup className="grid md:grid-cols-3 gap-8" stagger={0.12}>
            {POSTS.map((p) => (
              <RevealItem key={p.title} as="article" className="group cursor-pointer">
                <div className="aspect-[4/5] overflow-hidden bg-card mb-5">
                  <img src={p.img} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                </div>
                <p className="text-[0.65rem] tracking-[0.4em] uppercase text-taupe">{p.cat}</p>
                <h2 className="font-display text-2xl md:text-3xl mt-3 group-hover:text-taupe transition-colors">{p.title}</h2>
                <p className="text-sm text-cream/70 mt-3">{p.excerpt}</p>
              </RevealItem>
            ))}
          </RevealGroup>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
