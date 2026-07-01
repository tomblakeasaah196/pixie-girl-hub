import { motion } from "motion/react";
import { DEFAULT_HOME, type FounderContent } from "@/lib/home-content";

export function FounderNote({
  content = DEFAULT_HOME.founder,
}: {
  content?: FounderContent;
}) {
  return (
    <section className="mx-auto max-w-3xl px-6 py-28 md:py-40 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1 }}
      >
        <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-8">{content.eyebrow}</p>
        <p className="font-display text-2xl md:text-4xl leading-snug text-balance text-cream/90">
          {content.body}
        </p>
        <p className="mt-10 text-[0.7rem] tracking-[0.4em] uppercase text-taupe">{content.attribution}</p>
      </motion.div>
    </section>
  );
}
