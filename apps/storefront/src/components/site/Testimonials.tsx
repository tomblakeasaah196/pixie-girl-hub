import { motion } from "motion/react";
import { DEFAULT_HOME, type Testimonial } from "@/lib/home-content";

export function Testimonials({
  eyebrow = DEFAULT_HOME.testimonials.eyebrow,
  items = DEFAULT_HOME.testimonials.items,
}: {
  eyebrow?: string;
  items?: Testimonial[];
}) {
  return (
    <section className="mx-auto max-w-[1400px] px-6 lg:px-10 py-28 md:py-40">
      <p className="text-center text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-14">{eyebrow}</p>
      <div className="grid md:grid-cols-3 gap-6">
        {items.map((t, i) => (
          <motion.figure
            key={t.a}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="border border-taupe/20 p-8 md:p-10 bg-card hover:border-taupe/50 transition-colors"
          >
            <span className="font-display text-5xl text-taupe leading-none block">"</span>
            <blockquote className="mt-4 font-display text-xl md:text-2xl leading-snug text-cream text-balance">
              {t.q}
            </blockquote>
            <figcaption className="mt-8 pt-6 border-t border-taupe/15">
              <div className="text-sm text-cream">{t.a}</div>
              <div className="text-[0.65rem] tracking-[0.35em] uppercase text-taupe mt-1">{t.r}</div>
            </figcaption>
          </motion.figure>
        ))}
      </div>
    </section>
  );
}
