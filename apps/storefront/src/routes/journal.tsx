import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { getContentList } from "@/lib/storefront";
import { SITE_IMAGES as I } from "@/lib/site-assets";
import { usePageSlots, withSlots } from "@/lib/site-config";

export const Route = createFileRoute("/journal")({
  head: () => ({ meta: [{ title: "Journal — Notes from the Atelier · Faitlyn Hair" }] }),
  component: Journal,
});

interface Post {
  slug: string;
  title: string;
  excerpt?: string;
  cover_image_url?: string;
  category?: string;
}

// Fallback so the journal reads like the reference before posts are published.
const DEMO: Post[] = [
  { slug: "eleven-hands", title: "Eleven hands, one wig: inside our Lagos workroom", category: "Atelier", cover_image_url: I.editorialAtelier, excerpt: "A day on the studio floor, from raw bundle to steam-set finish." },
  { slug: "wash-raw-curl", title: "How to wash a raw curl without losing the pattern", category: "Care", cover_image_url: I.productCurls, excerpt: "The founder's exact routine for keeping coils defined, wash after wash." },
  { slug: "blunt-bob-2026", title: "The case for the blunt bob, in 2026", category: "Edit", cover_image_url: I.productBob, excerpt: "Why the sharpest silhouette of the year is also the easiest to wear." },
];

function Journal() {
  const { data } = useQuery({ queryKey: ["journal"], queryFn: () => getContentList("journal") });
  const live = (data ?? []) as Post[];
  const posts = live.length ? live : DEMO;
  const s = withSlots(
    { eyebrow: "Journal", heading: "Notes from the ", headingAccent: "atelier", headingAfter: "." },
    usePageSlots("journal"),
  );

  return (
    <main className="bg-ink text-cream">
      <section className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-32 md:pt-28 pb-28">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe">{s.eyebrow}</p>
          <h1 className="mt-5 font-display text-5xl md:text-7xl leading-[0.95] tracking-tight">
            {s.heading}<em className="font-couture text-taupe">{s.headingAccent}</em>{s.headingAfter}
          </h1>
        </motion.div>

        <div className="mt-16 grid gap-x-8 gap-y-14 md:grid-cols-3">
          {posts.map((p, i) => (
            <motion.div
              key={p.slug}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.7, delay: (i % 3) * 0.08, ease: [0.22, 1, 0.36, 1] }}
            >
              <Link to="/journal/$slug" params={{ slug: p.slug }} className="group block">
                <div className="aspect-[4/5] overflow-hidden bg-card">
                  {p.cover_image_url ? (
                    <img src={p.cover_image_url} alt={p.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105" />
                  ) : null}
                </div>
                {p.category ? <p className="mt-5 text-[0.6rem] tracking-[0.4em] uppercase text-rose">{p.category}</p> : null}
                <h3 className="mt-3 font-display text-2xl md:text-3xl leading-tight group-hover:text-taupe transition-colors">{p.title}</h3>
                {p.excerpt ? <p className="mt-2 text-cream/60 text-body-sm leading-relaxed">{p.excerpt}</p> : null}
              </Link>
            </motion.div>
          ))}
        </div>
      </section>
    </main>
  );
}
