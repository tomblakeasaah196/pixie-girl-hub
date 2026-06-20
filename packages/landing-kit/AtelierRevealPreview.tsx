// @ts-nocheck
// This file is consumed as out-of-root source by BOTH apps. Their bundlers
// (Vite / Next webpack) resolve react/three/framer-motion from each app's own
// node_modules at build time, but `tsc` run from each app can't resolve them
// from packages/. Type-checking is skipped here; the config contract in
// ./config remains fully type-checked, as does every consumer of this module.
"use client";

/**
 * AtelierRevealPreview — the cinematic "velvet drapes" intro, config-driven.
 *
 * Two drapes meet at a seam of light, the welcome headline holds, then the
 * drapes part to reveal the page beneath. Colours come from the LandingConfig
 * (theme.three hex values). Supports 3D brand reveals via Three.js when enabled.
 *
 * Positioned `absolute inset-0`, so the host renders it inside a positioned,
 * full-bleed parent (the studio preview pane, or a `fixed inset-0` wrapper on
 * the public page). 3D is lazy-loaded with React.lazy so it works identically
 * under Vite (admin) and the Next.js App Router (public).
 *
 * Resilience: the lazy 3D chunk is retried on a transient failure and wrapped
 * in an error boundary. If the chunk can't load (e.g. a stale hashed chunk
 * after a redeploy — the classic "error loading dynamically imported module")
 * or WebGL throws, the reveal degrades to the cinematic text headline instead
 * of crashing the page. The intro is never allowed to take the site down.
 */

import { AnimatePresence, motion, useReducedMotion, useMotionValue } from "framer-motion";
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from "react";
import type { LandingConfig } from "./config";

const DISPLAY_FONT = '"Fraunces", "Playfair Display", Georgia, serif';

/** Retry a dynamic import a couple of times before giving up — smooths over a
 *  transient network blip or a chunk that's momentarily unavailable mid-deploy. */
function retryImport<T>(factory: () => Promise<T>, retries = 2, delay = 400): Promise<T> {
  return factory().catch((err) => {
    if (retries <= 0) throw err;
    return new Promise<T>((resolve) => setTimeout(resolve, delay)).then(() =>
      retryImport(factory, retries - 1, delay * 2),
    );
  });
}

const ThreeDTextReveal = lazy(() =>
  retryImport(() => import("./ThreeDTextReveal")).then((m) => ({ default: m.ThreeDTextReveal })),
);
const ThreeDLogoReveal = lazy(() =>
  retryImport(() => import("./ThreeDLogoReveal")).then((m) => ({ default: m.ThreeDLogoReveal })),
);

/** Never let a failed 3D chunk (or a WebGL init error) crash the page — fall
 *  back to the text headline. This kills the "Unexpected Application Error /
 *  error loading dynamically imported module" class for the reveal. */
class Reveal3DBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    // Degraded reveal is acceptable; log for diagnostics, don't rethrow.
    if (typeof console !== "undefined") console.warn("3D reveal unavailable, using text fallback:", error);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type Phase = "seam" | "part" | "hold" | "exit" | "done";

/** The cinematic text headline — used as the non-3D reveal AND as the 3D
 *  fallback, so a 3D failure still looks intentional. */
function RevealHeadline({
  show,
  tagline,
  headline,
  accent,
}: {
  show: boolean;
  tagline: string;
  headline: string;
  accent: string;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="text-[10px] tracking-[0.5em] uppercase mb-4" style={{ color: accent, opacity: 0.7 }}>
            {tagline}
          </div>
          <h1 className="text-3xl md:text-5xl lg:text-6xl font-light tracking-tight" style={{ color: accent, fontFamily: DISPLAY_FONT }}>
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
  );
}

export function AtelierRevealPreview({
  config,
  campaignName,
  replayKey,
  onComplete,
}: {
  config: LandingConfig;
  campaignName?: string | null;
  /** change this to replay the reveal (e.g. studio "Replay" button) */
  replayKey: string | number;
  onComplete?: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("seam");
  const phaseMotion = useMotionValue<"seam" | "part" | "untie" | "reveal" | "done">("seam");

  useEffect(() => {
    setPhase("seam");
    phaseMotion.set("seam");
    if (reduceMotion) {
      const t = setTimeout(() => {
        setPhase("done");
        phaseMotion.set("done");
      }, 500);
      return () => clearTimeout(t);
    }
    const timers = [
      setTimeout(() => {
        setPhase("part");
        phaseMotion.set("reveal");
      }, 800),
      setTimeout(() => setPhase("hold"), 2200),
      setTimeout(() => setPhase("exit"), 3600),
      setTimeout(() => {
        setPhase("done");
        phaseMotion.set("done");
      }, 4400),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduceMotion, replayKey, phaseMotion]);

  useEffect(() => {
    if (phase === "done") onComplete?.();
  }, [phase, onComplete]);

  const { ink, primary, accent, metal } = config.three;
  const headline = campaignName ? `Welcome to ${campaignName}` : config.welcomeLine;
  const headlineShown = phase === "hold" || phase === "exit";
  const skip = () => setPhase("done");

  return (
    <AnimatePresence>
      {phase !== "done" && (
        <motion.div
          key={replayKey}
          className="absolute inset-0 z-[60] overflow-hidden cursor-pointer"
          style={{ backgroundColor: ink }}
          onClick={skip}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] } }}
        >
          {/* Vignette */}
          <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent 30%, ${ink} 90%)` }} />

          {/* Left drape */}
          <motion.div
            className="absolute inset-y-0 left-0 w-1/2 origin-right"
            initial={{ x: 0 }}
            animate={{ x: phase === "seam" ? 0 : "-105%" }}
            transition={{ duration: 1.6, ease: [0.76, 0, 0.24, 1] }}
            style={{
              background: `linear-gradient(90deg, ${ink} 0%, ${primary} 70%, ${metal} 100%), repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 2px, transparent 2px, transparent 8px)`,
              backgroundBlendMode: "multiply",
              boxShadow: `inset -40px 0 80px ${ink}, inset 0 0 200px rgba(0,0,0,0.6)`,
            }}
          />
          {/* Right drape */}
          <motion.div
            className="absolute inset-y-0 right-0 w-1/2 origin-left"
            initial={{ x: 0 }}
            animate={{ x: phase === "seam" ? 0 : "105%" }}
            transition={{ duration: 1.6, ease: [0.76, 0, 0.24, 1] }}
            style={{
              background: `linear-gradient(270deg, ${ink} 0%, ${primary} 70%, ${metal} 100%), repeating-linear-gradient(90deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 2px, transparent 2px, transparent 8px)`,
              backgroundBlendMode: "multiply",
              boxShadow: `inset 40px 0 80px ${ink}, inset 0 0 200px rgba(0,0,0,0.6)`,
            }}
          />

          {/* Seam of light */}
          <motion.div
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
            initial={{ scaleY: 0, opacity: 0 }}
            animate={{ scaleY: phase === "seam" ? 1 : 0, opacity: phase === "seam" ? 1 : 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            style={{ background: `linear-gradient(to bottom, transparent, ${accent}, transparent)`, boxShadow: `0 0 24px ${accent}, 0 0 60px ${accent}` }}
          />

          {/* Headline / 3D Reveal */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            {config.reveal.threeD?.enabled ? (
              <AnimatePresence>
                {headlineShown && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6 }}
                    className="w-full h-[400px] flex items-center justify-center"
                  >
                    {/* 3D, with graceful fallback to the text headline. */}
                    <Reveal3DBoundary
                      fallback={
                        <RevealHeadline show tagline={config.reveal.tagline} headline={headline} accent={accent} />
                      }
                    >
                      <Suspense fallback={null}>
                        {config.reveal.threeD.variant === "text-dual" ? (
                          <ThreeDTextReveal
                            text1="Pixie Girl"
                            text2="Global"
                            phase={phaseMotion}
                            glowIntensity={config.reveal.threeD.glowIntensity}
                            rotationSpeed={config.reveal.threeD.rotationSpeed}
                            primaryColor={config.three.primary}
                            accentColor={config.three.accent}
                          />
                        ) : (
                          <ThreeDLogoReveal
                            rotationSpeed={config.reveal.threeD.rotationSpeed}
                            glowIntensity={config.reveal.threeD.glowIntensity}
                            primaryColor={config.three.primary}
                            accentColor={config.three.accent}
                            phase={phaseMotion}
                          />
                        )}
                      </Suspense>
                    </Reveal3DBoundary>
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <div className="absolute bottom-[18vh] text-center px-6">
                <RevealHeadline show={headlineShown} tagline={config.reveal.tagline} headline={headline} accent={accent} />
              </div>
            )}
          </div>

          {/* Skip */}
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
