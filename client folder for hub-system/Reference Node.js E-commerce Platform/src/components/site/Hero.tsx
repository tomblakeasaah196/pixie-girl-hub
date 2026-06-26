import { motion } from "motion/react";
import heroModel from "@/assets/hero-model.webp.asset.json";

export function Hero() {
  return (
    <section className="relative min-h-[100dvh] overflow-hidden bg-ink">
      {/* Background image */}
      <motion.div
        initial={{ scale: 1.15, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
        className="absolute inset-0"
      >
        <img src={heroModel.url} alt="Faitlyn signature pixie" className="w-full h-full object-cover object-center opacity-80" />
        {/* Dark wash so headline copy reads cleanly on any image */}
        <div className="absolute inset-0 bg-ink/45" />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/90 via-ink/55 to-ink" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/20 to-transparent" />
      </motion.div>

      {/* Copy */}
      <div className="relative z-10 mx-auto max-w-[1400px] px-6 lg:px-10 pt-40 md:pt-48 pb-24 min-h-[100dvh] flex flex-col justify-center">
        <motion.span
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.6 }}
          className="text-[0.7rem] tracking-[0.5em] uppercase text-taupe/90"
        >
          The Autumn Edit · 2026 · <span className="font-couture italic normal-case tracking-normal text-taupe">nouveauté</span>
        </motion.span>

        <motion.h1
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 font-display text-[clamp(3rem,9vw,8rem)] leading-[0.95] tracking-[-0.02em] text-cream max-w-5xl text-balance"
        >
          Hair, <em className="gold-shimmer not-italic">sculptée</em><br />
          like couture.
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.1 }}
          className="mt-8 max-w-md text-base md:text-lg text-cream/75 leading-relaxed"
        >
          A Lagos studio crafting the world's most coveted pixies, bobs and curls.
          Hand-finished. Lace-perfect. <span className="font-couture italic text-taupe">Fait avec amour</span> — worn by the women who set the standard.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 1.3 }}
          className="mt-10 flex flex-wrap gap-4"
        >
          <button className="group relative overflow-hidden px-9 py-4 bg-taupe text-ink text-[0.7rem] tracking-[0.4em] uppercase font-medium hover:bg-cream transition-colors">
            Shop the Catalogue
          </button>
          <button className="px-9 py-4 border border-taupe/40 text-taupe text-[0.7rem] tracking-[0.4em] uppercase hover:bg-taupe/10 transition-colors">
            Our Story
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2, duration: 1 }}
          className="absolute bottom-10 left-6 lg:left-10 flex items-center gap-4 text-[0.6rem] tracking-[0.4em] uppercase text-taupe/70"
        >
          <span className="w-12 h-px bg-taupe/50" /> Scroll
        </motion.div>
      </div>
    </section>
  );
}
