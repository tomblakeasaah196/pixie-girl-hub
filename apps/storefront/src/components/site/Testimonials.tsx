import type { CSSProperties } from "react";
import { motion } from "motion/react";
import { DEFAULT_HOME, type Testimonial } from "@/lib/home-content";

/**
 * Testimonials. On desktop it's a three-column editorial grid that reveals on
 * scroll. On mobile the cards become a single horizontal ribbon that
 * auto-scrolls (duplicated once, track slides -50% on a loop); touching/hovering
 * pauses it and the global reduced-motion rule stops it entirely.
 */
export function Testimonials({
  eyebrow = DEFAULT_HOME.testimonials.eyebrow,
  items = DEFAULT_HOME.testimonials.items,
}: {
  eyebrow?: string;
  items?: Testimonial[];
}) {
  const duration = Math.max(24, items.length * 9);
  const track = [...items, ...items];

  return (
    <section className="py-28 md:py-40">
      <p className="text-center text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-14 px-6">
        {eyebrow}
      </p>

      {/* Desktop: three-column grid */}
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 hidden md:grid md:grid-cols-3 gap-6">
        {items.map((t, i) => (
          <motion.div
            key={t.a}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.8, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="h-full"
          >
            <TestimonialCard t={t} />
          </motion.div>
        ))}
      </div>

      {/* Mobile: auto-scrolling ribbon */}
      <div className="md:hidden relative overflow-hidden">
        <div
          className="flex w-max marquee-track px-6"
          style={{ "--marquee-duration": `${duration}s` } as CSSProperties}
        >
          {track.map((t, i) => (
            <div
              key={`${t.a}-${i}`}
              aria-hidden={i >= items.length}
              className="w-[78vw] max-w-[340px] shrink-0 mr-4"
            >
              <TestimonialCard t={t} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <figure className="h-full border border-taupe/20 p-8 md:p-10 bg-card">
      <span className="font-display text-5xl text-taupe leading-none block">&ldquo;</span>
      <blockquote className="mt-4 font-display text-xl md:text-2xl leading-snug text-cream text-balance">
        {t.q}
      </blockquote>
      <figcaption className="mt-8 pt-6 border-t border-taupe/15">
        <div className="text-sm text-cream">{t.a}</div>
        <div className="text-[0.65rem] tracking-[0.35em] uppercase text-taupe mt-1">{t.r}</div>
      </figcaption>
    </figure>
  );
}
