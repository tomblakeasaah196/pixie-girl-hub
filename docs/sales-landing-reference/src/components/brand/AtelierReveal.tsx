import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useBrand } from "./BrandProvider";
import { AtelierStage } from "./AtelierStage";

interface Props {
  campaignName?: string | null;
  onComplete?: () => void;
  /** key to retrigger when brand changes */
  brandKey: string;
}

export function AtelierReveal({ campaignName, onComplete, brandKey }: Props) {
  const { brand } = useBrand();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<"seam" | "part" | "hold" | "exit" | "done">("seam");

  // Dismiss the SSR pre-hydration veil now that the reveal is mounted on top of the page.
  useEffect(() => {
    const v = document.getElementById("prehydration-veil");
    if (!v) return;
    v.classList.add("is-hidden");
    const t = setTimeout(() => v.remove(), 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      const t = setTimeout(() => setPhase("done"), 600);
      return () => clearTimeout(t);
    }
    const timers = [
      setTimeout(() => setPhase("part"), 800),
      setTimeout(() => setPhase("hold"), 2200),
      setTimeout(() => setPhase("exit"), 3600),
      setTimeout(() => setPhase("done"), 4400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, brandKey]);

  useEffect(() => {
    if (phase === "done") onComplete?.();
  }, [phase, onComplete]);

  const skip = () => setPhase("done");
  const headline = campaignName ? `Welcome to ${campaignName}` : brand.welcomeLine;

  return (
    <AnimatePresence>
      {phase !== "done" && (
        <motion.div
          key={brandKey}
          className="fixed inset-0 z-[100] overflow-hidden cursor-pointer"
          style={{ backgroundColor: brand.three.ink }}
          onClick={skip}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }}
        >
          {/* 3D stage underneath */}
          <motion.div
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 1.05 }}
            animate={{
              opacity: phase === "seam" ? 0 : 1,
              scale: phase === "exit" ? 1.15 : 1,
            }}
            transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <AtelierStage />
          </motion.div>

          {/* Vignette */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background: `radial-gradient(ellipse at center, transparent 30%, ${brand.three.ink} 90%)`,
            }}
          />

          {/* Velvet drapes — left */}
          <motion.div
            className="absolute inset-y-0 left-0 w-1/2 origin-right"
            initial={{ x: 0 }}
            animate={{ x: phase === "seam" ? 0 : "-105%" }}
            transition={{ duration: 1.6, ease: [0.76, 0, 0.24, 1], delay: phase === "part" ? 0 : 0 }}
            style={{
              background: `
                linear-gradient(90deg, ${brand.three.ink} 0%, ${brand.three.primary} 70%, ${brand.three.metal} 100%),
                repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 2px, transparent 2px, transparent 8px)
              `,
              backgroundBlendMode: "multiply",
              boxShadow: `inset -40px 0 80px ${brand.three.ink}, inset 0 0 200px rgba(0,0,0,0.6)`,
            }}
          />
          <motion.div
            className="absolute inset-y-0 right-0 w-1/2 origin-left"
            initial={{ x: 0 }}
            animate={{ x: phase === "seam" ? 0 : "105%" }}
            transition={{ duration: 1.6, ease: [0.76, 0, 0.24, 1] }}
            style={{
              background: `
                linear-gradient(270deg, ${brand.three.ink} 0%, ${brand.three.primary} 70%, ${brand.three.metal} 100%),
                repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 2px, transparent 2px, transparent 8px)
              `,
              backgroundBlendMode: "multiply",
              boxShadow: `inset 40px 0 80px ${brand.three.ink}, inset 0 0 200px rgba(0,0,0,0.6)`,
            }}
          />

          {/* Seam of light */}
          <motion.div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{
              scaleY: phase === "seam" ? 1 : 0,
              opacity: phase === "seam" ? 1 : 0,
            }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background: `linear-gradient(to bottom, transparent, ${brand.three.accent}, transparent)`,
              boxShadow: `0 0 24px ${brand.three.accent}, 0 0 60px ${brand.three.accent}`,
            }}
          />

          {/* Headline */}
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-[18vh] pointer-events-none">
            <AnimatePresence>
              {(phase === "hold" || phase === "exit") && (
                <motion.div
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="text-center px-6"
                >
                  <div
                    className="text-[10px] tracking-[0.5em] uppercase mb-4"
                    style={{ color: brand.three.accent, opacity: 0.7 }}
                  >
                    {brand.tagline}
                  </div>
                  <h1
                    className="font-display text-3xl md:text-5xl lg:text-6xl font-light tracking-tight"
                    style={{ color: brand.three.accent }}
                  >
                    {headline.split(" ").map((w, i) => (
                      <motion.span
                        key={i}
                        initial={{ opacity: 0, y: 20, filter: "blur(8px)" }}
                        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                        transition={{ delay: 0.1 + i * 0.08, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                        className="inline-block mr-[0.3em]"
                      >
                        {w}
                      </motion.span>
                    ))}
                  </h1>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Skip hint */}
          <motion.button
            onClick={(e) => { e.stopPropagation(); skip(); }}
            initial={{ opacity: 0 }}
            animate={{ opacity: phase === "hold" ? 0.5 : 0 }}
            className="absolute bottom-6 right-6 text-[10px] tracking-[0.3em] uppercase text-white/70 hover:text-white transition-colors"
          >
            Skip →
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
