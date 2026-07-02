import { motion } from "motion/react";
import { SmartLink } from "@/components/site/SmartLink";
import { DEFAULT_HOME, type EditorialContent } from "@/lib/home-content";

export function EditorialSplit({
  content = DEFAULT_HOME.editorial,
}: {
  content?: EditorialContent;
}) {
  return (
    <section className="bg-card">
      <div className="mx-auto max-w-[1400px] grid lg:grid-cols-2 gap-0 items-stretch">
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-150px" }}
          transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-h-[60vh] lg:min-h-[80vh] overflow-hidden"
        >
          <img src={content.imageUrl} alt="Inside the Faitlyn atelier" loading="lazy" className="w-full h-full object-cover" />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: "-150px" }}
          transition={{ duration: 1, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="p-10 md:p-20 flex flex-col justify-center"
        >
          <p className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe mb-6">{content.eyebrow}</p>
          <h2 className="font-display text-4xl md:text-6xl leading-[1.05] tracking-tight text-balance">
            {content.heading}
            {content.headingAccent ? <em className="gold-shimmer not-italic">{content.headingAccent}</em> : null}
            {content.headingAfter}
          </h2>
          <p className="mt-8 text-cream/70 leading-relaxed max-w-md">{content.body}</p>
          <SmartLink to={content.ctaHref} className="mt-10 self-start px-9 py-4 border border-taupe/40 text-taupe text-[0.7rem] tracking-[0.4em] uppercase hover:bg-taupe hover:text-ink transition-colors">
            {content.ctaLabel}
          </SmartLink>
        </motion.div>
      </div>
    </section>
  );
}
