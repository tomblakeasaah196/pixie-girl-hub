import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { SITE_IMAGES } from "@/lib/site-assets";

const SESSION_KEY = "faitlyn:preloaded";
const TOTAL_MS = 2000;

/**
 * 2-second cinematic reveal:
 *  1. Logo fades up + gold shimmer sweeps across the wordmark
 *  2. A circular gold "iris" expands from the logo centre, wiping the page in
 */
export function CinematicPreloader() {
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem(SESSION_KEY) !== "1";
  });
  const [phase, setPhase] = useState<0 | 1 | 2>(0);

  useEffect(() => {
    if (!visible) {
      document.body.style.overflow = "";
      return;
    }
    document.body.style.overflow = "hidden";
    const total = reduceMotion ? 600 : TOTAL_MS;
    const t1 = setTimeout(() => setPhase(1), reduceMotion ? 100 : 700);
    const t2 = setTimeout(() => setPhase(2), reduceMotion ? 250 : 1300);
    const t3 = setTimeout(dismiss, total);
    const safety = setTimeout(() => { document.body.style.overflow = ""; }, 4000);
    return () => {
      [t1, t2, t3, safety].forEach(clearTimeout);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, "1");
    document.body.style.overflow = "";
    setVisible(false);
  }

  const logo = SITE_IMAGES.logoCream;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="preloader"
          className="fixed inset-0 z-[100] bg-ink text-cream cursor-pointer select-none overflow-hidden"
          onClick={dismiss}
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: "easeOut" } }}
          role="button"
          aria-label="Loading Faitlyn Hair. Tap to skip."
        >
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(circle at 50% 50%, rgba(212,181,158,0.18) 0%, transparent 55%)" }}
          />

          {/* Iris wipe */}
          <motion.div
            className="absolute left-1/2 top-1/2 z-30 rounded-full bg-cream"
            style={{ width: 40, height: 40, x: "-50%", y: "-50%" }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: phase === 2 ? 80 : 0, opacity: phase === 2 ? 1 : 0 }}
            transition={{ duration: 0.75, ease: [0.76, 0, 0.24, 1] }}
          />

          {/* Logo + shimmer (or a shimmering text wordmark until a logo is uploaded) */}
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 14, filter: "blur(10px)" }}
              animate={{ opacity: phase < 2 ? 1 : 0, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-[min(74vw,420px)] text-center"
            >
              {logo ? (
                <>
                  <img src={logo} alt="Faitlyn Hair" className="w-full h-auto" draggable={false} />
                  {!reduceMotion && (
                    <motion.div
                      aria-hidden
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        WebkitMaskImage: `url(${logo})`,
                        maskImage: `url(${logo})`,
                        WebkitMaskSize: "100% 100%",
                        maskSize: "100% 100%",
                        WebkitMaskRepeat: "no-repeat",
                        maskRepeat: "no-repeat",
                        background: "linear-gradient(110deg, transparent 30%, rgba(247,230,200,0.95) 50%, transparent 70%)",
                        mixBlendMode: "screen",
                      }}
                      initial={{ x: "-120%" }}
                      animate={{ x: phase >= 1 ? "120%" : "-120%" }}
                      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    />
                  )}
                </>
              ) : (
                <span className="gold-shimmer font-display text-3xl md:text-5xl tracking-[0.15em] uppercase">
                  Faitlyn Hair
                </span>
              )}
            </motion.div>
          </div>

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            className="absolute bottom-6 right-6 z-40 text-[0.65rem] tracking-[0.4em] uppercase text-taupe/70 hover:text-taupe transition-colors"
          >
            Skip →
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
