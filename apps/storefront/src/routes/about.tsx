import { createFileRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import { EditorialSplit } from "@/components/site/EditorialSplit";
import { PressStrip } from "@/components/site/PressStrip";
import { FounderNote } from "@/components/site/FounderNote";
import { SITE_IMAGES } from "@/lib/site-assets";

export const Route = createFileRoute("/about")({
  head: () => ({ meta: [{ title: "The Maison — Our Story · Faitlyn Hair" }] }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="bg-ink text-cream pt-32 md:pt-28">
      <section className="relative h-[80vh] overflow-hidden">
        <img src={SITE_IMAGES.models} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/30 to-ink" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-6"
          >
            Est. Lagos · 2021
          </motion.p>
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="font-display text-5xl md:text-8xl leading-[0.95] tracking-tight max-w-4xl text-balance"
          >
            The hair we always wished we could <em className="font-couture text-taupe">buy</em>.
          </motion.h1>
        </div>
      </section>

      <EditorialSplit />
      <PressStrip />
      <FounderNote />
    </main>
  );
}
