import { motion } from "motion/react";

export function FounderNote() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-28 md:py-40 text-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 1 }}
      >
        <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-8">A note from Faitlyn</p>
        <p className="font-display text-2xl md:text-4xl leading-snug text-balance text-cream/90">
          I started Faitlyn because the hair I wanted didn't exist. So I built it — slowly, by hand, with women who care
          about the craft as much as I do. Everything you see here is the version of luxury I always wished I could buy.
        </p>
        <p className="mt-10 text-[0.7rem] tracking-[0.4em] uppercase text-taupe">— Faitlyn, Founder</p>
      </motion.div>
    </section>
  );
}
